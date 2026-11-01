// A small client for YouCam's hosted MCP servers (beauty, fashion), spoken
// over streamable HTTP: JSON-RPC posts whose answers may arrive as an SSE
// stream. The MCP tools poll their own task until it finishes, so one
// tools/call returns the final result with its task id.
// Docs: https://docs.perfectcorp.com/develop/mcp

import { YouCamError } from './errors.js';

const BASE_URL = 'https://mcp-api-01.makeupar.com/mcp';
const PROTOCOL = '2025-06-18';
const COST_TTL_MS = 6 * 60 * 60 * 1000;

// SSE frames carry one JSON-RPC message per `data:` line; plain JSON is one message.
function messagesOf(text, contentType) {
  if (!contentType.includes('event-stream')) return text.trim() ? [JSON.parse(text)] : [];
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// A failed task comes back as tool text such as
// "YcoApiException - ... Polling failed: error_face_angle_invalid. The face ...".
function errorOf(text) {
  const code = text.match(/failed:\s*([A-Za-z_]+)/)?.[1] || text.match(/\b(error_[a-z_]+|CreditInsufficiency|InvalidFileId)\b/)?.[1] || 'TaskFailed';
  return new YouCamError(text.replace(/^YcoApiException - /, '').slice(0, 300), code, 422);
}

const withTask = (err, taskId) => {
  if (taskId) err.taskId = taskId;
  return err;
};

// Reads the answer as it arrives: a task's progress notifications carry its id
// in params.data.extra.task_id, and a timeout must not lose the ones already sent.
async function readBody(res, seen) {
  if (!res.body) return '';
  const decoder = new TextDecoder();
  let text = '';
  let pending = '';
  for await (const chunk of res.body) {
    const part = decoder.decode(chunk, { stream: true });
    text += part;
    const lines = (pending + part).split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        seen.taskId = JSON.parse(line.slice(5)).params?.data?.extra?.task_id || seen.taskId;
      } catch {
        /* not one whole message: messagesOf decides what that means */
      }
    }
  }
  return text;
}

export function createYouCamMcp({ apiKey, baseUrl = BASE_URL, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  if (!apiKey) throw new Error('createYouCamMcp needs an apiKey');
  const sessions = new Map(); // server -> Promise<session id | null>
  let nextId = 1;

  async function post(server, body, session, seen = {}) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${apiKey}` };
    if (session) headers['mcp-session-id'] = session;
    // A task that was running when the line dropped may still be charged.
    const running = body.method === 'tools/call';
    let res;
    let text;
    try {
      res = await fetchImpl(`${baseUrl}/${server}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      text = await readBody(res, seen);
    } catch (cause) {
      const err = new YouCamError(`YouCam MCP ${server} could not be reached: ${cause.message}`, 'McpUnavailable', 502);
      if (running) err.billed = true;
      throw err;
    }
    if (!res.ok) {
      const err = new YouCamError(`YouCam MCP ${server} answered ${res.status}`, res.status === 401 ? 'InvalidApiKey' : 'McpUnavailable', res.status === 401 ? 401 : 502);
      err.httpStatus = res.status;
      if (running && res.status >= 500) err.billed = true;
      throw err;
    }
    let messages;
    try {
      messages = messagesOf(text, res.headers.get('content-type') || '');
    } catch {
      const err = new YouCamError(`YouCam MCP ${server} sent an unreadable answer`, 'McpUnavailable', 502);
      if (running) err.billed = true;
      throw err;
    }
    return { session: res.headers.get('mcp-session-id'), messages };
  }

  function sessionFor(server) {
    if (!sessions.has(server)) {
      const pending = (async () => {
        const init = await post(server, { jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'still-me', version: '1.0' } } });
        await post(server, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, init.session);
        return init.session;
      })();
      sessions.set(server, pending);
      pending.catch(() => sessions.delete(server));
    }
    return sessions.get(server);
  }

  async function rpc(server, method, params, retried = false) {
    const session = await sessionFor(server);
    const id = nextId++;
    const seen = {};
    try {
      const { messages } = await post(server, { jsonrpc: '2.0', id, method, params }, session, seen);
      const reply = messages.find((m) => m.id === id);
      if (!reply) {
        const err = new YouCamError('YouCam MCP sent no answer', 'McpUnavailable', 502);
        if (method === 'tools/call') err.billed = true;
        throw err;
      }
      if (reply.error) throw new YouCamError(reply.error.message || 'YouCam MCP error', 'McpError', 502);
      return { result: reply.result, taskId: seen.taskId || null };
    } catch (err) {
      // An expired session answers 400/404: start a new one, once.
      if (!retried && (err.httpStatus === 400 || err.httpStatus === 404)) {
        sessions.delete(server);
        return rpc(server, method, params, true);
      }
      throw withTask(err, seen.taskId);
    }
  }

  async function invoke(server, name, args) {
    const { result, taskId } = await rpc(server, 'tools/call', { name, arguments: args });
    const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let payload = result?.structuredContent?.result ?? null;
    if (!payload) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (result?.isError || payload?.error_message || !payload) throw withTask(errorOf(payload?.error_message || text || 'TaskFailed'), taskId);
    return { payload, taskId };
  }

  /** Calls a tool and returns its parsed JSON payload, or throws the task's error code (with err.taskId when known). */
  async function callTool(server, name, args) {
    return (await invoke(server, name, args)).payload;
  }

  /** Runs a YouCam task through MCP: { taskId, results }. */
  async function runTool(server, name, request) {
    const { payload, taskId: streamed } = await invoke(server, name, { request });
    const data = payload.data || payload;
    const taskId = data.task_id || streamed;
    if (data.task_status && data.task_status !== 'success') throw withTask(errorOf(String(data.error || data.task_status)), taskId);
    return { taskId, results: data.results || {} };
  }

  // Live unit prices, read from YouCam rather than hard-coded: path -> units.
  let costCache = null;
  async function featureCosts() {
    if (costCache && Date.now() - costCache.at < COST_TTL_MS) return costCache.costs;
    const costs = {};
    let token = null;
    for (let page = 0; page < 15; page++) {
      const payload = await callTool('beauty', 'Get-Feature-Cost', { request: { page_size: 20, starting_token: token } });
      const d = payload.result || payload.data || payload;
      for (const sku of d.skus || []) {
        const path = String(sku.run_task_url || '').replace(/^https?:\/\/[^/]+/, '');
        // Some features list several tiers (an earring, or a stacked pair): keep the cheapest.
        if (path && (!(path in costs) || sku.amount < costs[path].units)) costs[path] = { units: sku.amount, per: sku.unit, name: sku.description };
      }
      token = d.next_token || null;
      if (!token) break;
    }
    costCache = { at: Date.now(), costs };
    return costs;
  }

  return { callTool, runTool, featureCosts };
}
