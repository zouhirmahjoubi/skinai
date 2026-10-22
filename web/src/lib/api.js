// Browser side of the Ahead API. The server holds the YouCam key.

export class ApiError extends Error {
  constructor(message, code, fix) {
    super(message);
    this.code = code;
    this.fix = fix;
  }
}

// The access code can come from the link judges are given (?code=...), so
// nobody has to find Settings first.
let accessCode = '';
try {
  const fromUrl = (new URLSearchParams(window.location.search).get('code') || '').trim();
  if (fromUrl) {
    localStorage.setItem('ahead.accessCode', fromUrl);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  accessCode = fromUrl || localStorage.getItem('ahead.accessCode') || '';
} catch {
  /* storage blocked */
}

export const hasAccessCode = () => Boolean(accessCode);

export function setAccessCode(code) {
  accessCode = code;
  try {
    localStorage.setItem('ahead.accessCode', code);
  } catch {
    /* storage blocked */
  }
}

async function request(path, { method = 'GET', json, blob } = {}) {
  const headers = {};
  if (accessCode) headers['x-access-code'] = accessCode;
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (blob) {
    headers['content-type'] = blob.type || 'image/jpeg';
    body = blob;
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
  } catch {
    throw new ApiError('You seem to be offline. Check your connection and try again.', 'Offline', 'service');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    throw new ApiError(e.message || `Request failed (${res.status})`, e.code || `HTTP_${res.status}`, e.fix || 'service');
  }
  return data;
}

export const api = {
  status: () => request('/status'),
  upload: (blob) => request('/upload', { method: 'POST', blob }),
  analyzeSkin: (fileId, tier) => request('/skin/analyze', { method: 'POST', json: { fileId, tier } }),
  print: (fileId) => request('/print', { method: 'POST', json: { fileId } }),
  hairTemplates: () => request('/hair/templates'),
  hairTryOn: (opts) => request('/hair/try-on', { method: 'POST', json: opts }),
  hatTryOn: (opts) => request('/hat/try-on', { method: 'POST', json: opts }),
  browPatterns: () => request('/brows/patterns'),
  browTryOn: (opts) => request('/brows/try-on', { method: 'POST', json: opts }),
  units: () => request('/units'),
};
