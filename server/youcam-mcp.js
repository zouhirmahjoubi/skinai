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

export function createYouCamMcp({ apiKey, baseUrl = BASE_URL, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  if (!apiKey) throw new Error('createYouCamMcp needs an apiKey');
  const sessions = new Map(); // server -> Promise<session id | null>
  let nextId = 1;

  async function post(server, body, session) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${apiKey}` };
    if (session) headers['mcp-session-id'] = session;
    const res = await fetchImpl(`${baseUrl}/${server}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) {
      const err = new YouCamError(`YouCam MCP ${server} answered ${res.status}`, res.status === 401 ? 'InvalidApiKey' : 'McpUnavailable', res.status === 401 ? 401 : 502);
      err.httpStatus = res.status;
      throw err;
    }
    return { session: res.headers.get('mcp-session-id'), messages: messagesOf(text, res.headers.get('content-type') || '') };
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
    try {
      const { messages } = await post(server, { jsonrpc: '2.0', id, method, params }, session);
      const reply = messages.find((m) => m.id === id);
      if (!reply) throw new YouCamError('YouCam MCP sent no answer', 'McpUnavailable', 502);
      if (reply.error) throw new YouCamError(reply.error.message || 'YouCam MCP error', 'McpError', 502);
      return reply.result;
    } catch (err) {
      // An expired session answers 400/404: start a new one, once.
      if (!retried && (err.httpStatus === 400 || err.httpStatus === 404)) {
        sessions.delete(server);
        return rpc(server, method, params, true);
      }
      throw err;
    }
  }

  /** Calls a tool and returns its parsed JSON payload, or throws the task's error code. */
  async function callTool(server, name, args) {
    const result = await rpc(server, 'tools/call', { name, arguments: args });
    const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let payload = result?.structuredContent?.result ?? null;
    if (!payload) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (result?.isError || payload?.error_message || !payload) throw errorOf(payload?.error_message || text || 'TaskFailed');
    return payload;
  }

  /** Runs a YouCam task through MCP: { taskId, results }. */
  async function runTool(server, name, request) {
    const payload = await callTool(server, name, { request });
    const data = payload.data || payload;
    if (data.task_status && data.task_status !== 'success') throw errorOf(String(data.error || data.task_status));
    return { taskId: data.task_id || null, results: data.results || {} };
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
