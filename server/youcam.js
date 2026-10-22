// Thin YouCam API client: File API upload, async task start + poll, templates,
// unit balance. Server-side only; the API key never reaches the browser.
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
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createYouCamClient({ apiKey, baseUrl = BASE_URL, fetchImpl = fetch, sleep = wait, pollTimeoutMs = 150_000 } = {}) {
  if (!apiKey) throw new Error('createYouCamClient needs an apiKey');

  async function call(path, init = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
      });
    } catch (err) {
      throw new YouCamError(`Could not reach YouCam: ${err.message}`, 'NetworkError', 502);
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || (body && body.status >= 400)) {
      const code = body?.error_code || body?.error || `HTTP_${res.status}`;
      throw new YouCamError(body?.error || body?.message || res.statusText || 'YouCam request failed', code, res.status >= 400 ? res.status : 502);
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
    const res = await fetchImpl(put.url, { method: put.method || 'PUT', headers: put.headers || { 'Content-Type': contentType }, body: buffer });
    if (!res.ok) throw new YouCamError(`Uploading to storage failed (${res.status})`, 'UploadFailed');
    return file.file_id;
  }

  async function startTask(feature, body) {
    const v = VERSIONS[feature] || 'v2.0';
    const data = await call(`/s2s/${v}/task/${feature}`, { method: 'POST', body: JSON.stringify(body) });
    if (!data?.task_id) throw new YouCamError('Task did not start', 'TaskNotStarted');
    return data.task_id;
  }

  // Polling is mandatory: an abandoned task still consumes units and later
  // reads as InvalidTaskId. Back off gently; results stay available 24h.
  async function pollTask(feature, taskId) {
    const v = VERSIONS[feature] || 'v2.0';
    const deadline = Date.now() + pollTimeoutMs;
    let delay = 1500;
    while (Date.now() < deadline) {
      const data = await call(`/s2s/${v}/task/${feature}/${encodeURIComponent(taskId)}`);
      if (data?.task_status === 'success') return data.results;
      if (data?.task_status === 'error') {
        const code = data.error || 'TaskFailed';
        throw new YouCamError(data.error_message || code, code, 422);
      }
      const hinted = Number(data?.polling_interval);
      await sleep(hinted > 0 ? Math.min(Math.max(hinted * 1000, 1000), 10_000) : delay);
      delay = Math.min(delay * 1.4, 6000);
    }
    throw new YouCamError('Timed out waiting for YouCam', 'Timeout', 504);
  }

  async function runTask(feature, body) {
    const taskId = await startTask(feature, body);
    return pollTask(feature, taskId);
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
    return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }

  return { call, uploadImage, startTask, pollTask, runTask, listTemplates, unitBalance };
}

/** Downloads a (short-lived, signed) result URL so it can be handed to the browser. */
export async function downloadAsDataUrl(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new YouCamError(`Could not download result (${res.status})`, 'DownloadFailed');
  const buf = Buffer.from(await res.arrayBuffer());
  let type = (res.headers.get('content-type') || '').split(';')[0];
  if (!type.startsWith('image/')) type = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${buf.toString('base64')}`;
}
