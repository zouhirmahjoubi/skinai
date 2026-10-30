// Thin YouCam API client: File API upload, async task start + poll, task
// deletion, templates, unit balance. Server-side only; the API key never
// reaches the browser.
//
// Request/response shapes follow the published OpenAPI documents
// (docs.perfectcorp.com/reference/*) for the versions listed in VERSIONS.

import { YouCamError } from './errors.js';

export const BASE_URL = 'https://yce-api-01.makeupar.com';

// Latest documented engine version per feature path.
export const VERSIONS = {
  'skin-analysis': 'v2.1',
  'hair-transfer': 'v2.1',
  'skin-tone-analysis': 'v2.0',
  'face-attr-analysis': 'v2.0',
  'makeup-vto': 'v2.0',
  hat: 'v2.0',
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-request cap. Node's fetch otherwise waits minutes for a stalled socket.
const REQUEST_TIMEOUT_MS = 30_000;
const withTimeout = (init = {}) => ({ ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

// Most documented 401/429 bodies carry only prose in `error`.
const CODE_BY_STATUS = { 401: 'InvalidApiKey', 429: 'RateLimitExceeded' };

// Worth another poll: the task is still alive on YouCam and is billed even if we stop.
const isTransient = (err) => err?.code === 'NetworkError' || [502, 503, 504].includes(err?.status);
// The rate limit is 250 requests per 300 s per key and per IP, polls included.
const isRateLimited = (err) => err?.status === 429;

export function createYouCamClient({ apiKey, baseUrl = BASE_URL, fetchImpl = fetch, sleep = wait, pollTimeoutMs = 150_000 } = {}) {
  if (!apiKey) throw new Error('createYouCamClient needs an apiKey');

  async function call(path, init = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...withTimeout(init),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
      });
    } catch (err) {
      throw new YouCamError(`Could not reach YouCam: ${err.message}`, 'NetworkError', 502);
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || (body && body.status >= 400)) {
      const st = body?.status >= 400 ? body.status : res.status;
      const code = body?.error_code || CODE_BY_STATUS[st] || body?.error || `HTTP_${res.status}`;
      throw new YouCamError(body?.error || body?.message || res.statusText || 'YouCam request failed', code, st >= 400 ? st : 502);
    }
    return body?.data ?? body;
  }

  /** Registers the file, PUTs the bytes to the presigned URL, returns file_id. Both legs are required. */
  async function uploadImage(buffer, { contentType = 'image/jpeg', fileName = 'photo.jpg' } = {}) {
    const data = await call('/s2s/v2.0/file', {
      method: 'POST',
      body: JSON.stringify({ files: [{ content_type: contentType, file_name: fileName, file_size: buffer.length }] }),
    });
    const file = data?.files?.[0];
    const put = file?.requests?.[0];
    if (!file?.file_id || !put?.url) throw new YouCamError('File API returned no upload URL', 'UploadFailed');
    let res;
    try {
      res = await fetchImpl(put.url, withTimeout({ method: put.method || 'PUT', headers: put.headers || { 'Content-Type': contentType }, body: buffer }));
    } catch (err) {
      throw new YouCamError(`Uploading to storage failed: ${err.message}`, 'UploadFailed');
    }
    if (!res.ok) throw new YouCamError(`Uploading to storage failed (${res.status})`, 'UploadFailed');
    return file.file_id;
  }

  // Never retried: a second POST would start (and bill) a second task.
  async function startTask(feature, body) {
    const v = VERSIONS[feature] || 'v2.0';
    const data = await call(`/s2s/${v}/task/${feature}`, { method: 'POST', body: JSON.stringify(body) });
    if (!data?.task_id) throw new YouCamError('Task did not start', 'TaskNotStarted');
    return data.task_id;
  }

  // Polling is mandatory: an abandoned task still consumes units and later
  // reads as InvalidTaskId. Back off gently; a failed poll is retried, since
  // it does not cancel the task. Rate-limited polls back off until the
  // deadline; network and 502-504 errors get four retries in a row. No task
  // finishes the instant it starts, so the first poll waits too, and YouCam's
  // own polling_interval, when it sends one, replaces this schedule.
  async function pollTask(feature, taskId) {
    const v = VERSIONS[feature] || 'v2.0';
    const deadline = Date.now() + pollTimeoutMs;
    let delay = 2500;
    let strikes = 0;
    let limited = 0;
    let lastLimit = null;
    await sleep(2000);
    while (Date.now() < deadline) {
      let data;
      try {
        data = await call(`/s2s/${v}/task/${feature}/${encodeURIComponent(taskId)}`);
        strikes = 0;
        limited = 0;
      } catch (err) {
        if (isRateLimited(err)) {
          lastLimit = err;
          await sleep(Math.min(2000 * 2 ** limited++, 15_000, Math.max(0, deadline - Date.now())));
          continue;
        }
        if (!isTransient(err) || ++strikes > 4) {
          err.billed = true; // the task started and may still be charged
          throw err;
        }
        await sleep(1000 * strikes);
        continue;
      }
      if (data?.task_status === 'success') return data.results;
      if (data?.task_status === 'error') {
        const code = data.error || 'TaskFailed';
        const err = new YouCamError(data.error_message || code, code, 422);
        err.taskId = taskId;
        throw err;
      }
      const hinted = Number(data?.polling_interval);
      await sleep(hinted > 0 ? Math.min(Math.max(hinted * 1000, 1000), 10_000) : delay);
      delay = Math.min(delay * 1.4, 8000);
    }
    const timeout = limited ? lastLimit : new YouCamError('Timed out waiting for YouCam', 'Timeout', 504);
    timeout.billed = true;
    throw timeout;
  }

  async function runTask(feature, body) {
    const taskId = await startTask(feature, body);
    return pollTask(feature, taskId);
  }

  async function runTaskWithId(feature, body) {
    const taskId = await startTask(feature, body);
    return { taskId, results: await pollTask(feature, taskId) };
  }

  /** Deletes a finished task with its input files and outputs (POST /s2s/v2.0/task/delete). */
  async function deleteTask(taskId) {
    try {
      await call('/s2s/v2.0/task/delete', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
    } catch (err) {
      if (err.code !== 'InvalidTaskId') throw err;
    }
  }

  /** Pages through a template list (free GET). */
  async function listTemplates(feature, { maxPages = 10 } = {}) {
    const v = VERSIONS[feature] || 'v2.0';
    const all = [];
    let token = '';
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({ page_size: '20' });
      if (token) q.set('starting_token', token);
      const data = await call(`/s2s/${v}/task/template/${feature}?${q}`);
      all.push(...(data?.templates || []));
      token = data?.next_token;
      if (!token) break;
    }
    return all;
  }

  async function unitBalance() {
    const data = await call('/s2s/v1.0/client/credit');
    const rows = Array.isArray(data) ? data : data?.results || [];
    // amount_dec is the current field (two decimals); amount is a deprecated integer.
    const total = rows.reduce((sum, r) => sum + (Number(r.amount_dec ?? r.amount) || 0), 0);
    return Math.round(total * 100) / 100;
  }

  return { call, uploadImage, startTask, pollTask, runTask, runTaskWithId, deleteTask, listTemplates, unitBalance };
}

/** Downloads a (short-lived, signed) result URL so it can be handed to the browser. */
export async function downloadAsDataUrl(url, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(String(url))) throw new YouCamError('Unexpected result URL', 'DownloadFailed');
  let res;
  try {
    res = await fetchImpl(url, withTimeout());
  } catch (err) {
    throw new YouCamError(`Could not download result: ${err.message}`, 'DownloadFailed');
  }
  if (!res.ok) throw new YouCamError(`Could not download result (${res.status})`, 'DownloadFailed');
  const buf = Buffer.from(await res.arrayBuffer());
  let type = (res.headers.get('content-type') || '').split(';')[0];
  if (!type.startsWith('image/')) type = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${buf.toString('base64')}`;
}
