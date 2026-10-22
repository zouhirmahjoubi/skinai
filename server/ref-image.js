// Fetches a product photo from a pasted shop link, safely, so it can be
// checked against YouCam's reference-image limits before any units are spent.
// Only public https hosts are fetched: every hop is resolved and private,
// loopback and link-local addresses are refused.

import dns from 'node:dns/promises';
import net from 'node:net';
import { sniffImage } from './image-info.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_HOPS = 3;

export class RefImageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

async function assertPublic(url, lookup) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new RefImageError('InvalidRefUrl', 'That doesn’t look like a web address.');
  }
  if (u.protocol !== 'https:' || u.username || u.password) throw new RefImageError('InvalidRefUrl', 'The photo link must be a public https:// address.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new RefImageError('InvalidRefUrl', 'That link can’t be opened. Use the public address of the photo.');
  }
  return u;
}

/**
 * @returns {Promise<{ buf: Buffer, info: { type, ext, width, height } }>}
 */
export async function fetchRefImage(url, { maxLongSide, minSide = 0, fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let target = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = await assertPublic(target, lookup);
    let res;
    try {
      res = await fetchImpl(u.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { accept: 'image/jpeg,image/png' } });
    } catch {
      throw new RefImageError('error_download_image', 'We couldn’t open that link. Copy the image address itself (long-press or right-click the picture), or save the photo and add it from your phone.');
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, u).href;
      continue;
    }
    if (!res.ok) throw new RefImageError('error_download_image', `That link answered with an error (${res.status}). Save the photo and add it from your phone instead.`);
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new RefImageError('exceed_max_filesize', 'That photo is over 10 MB. Save it and add it from your phone instead.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new RefImageError('exceed_max_filesize', 'That photo is over 10 MB. Save it and add it from your phone instead.');
    const info = sniffImage(buf);
    if (!info) throw new RefImageError('error_decode_image', 'That link isn’t a JPG or PNG photo (many shops serve WebP). Save the picture and add it from your phone; Ahead will convert it.');
    if (maxLongSide && Math.max(info.width, info.height) > maxLongSide) {
      throw new RefImageError('error_exceed_max_image_size', `That photo is ${info.width}×${info.height} px, and YouCam needs ${maxLongSide} px or less on the long side. Save it and add it from your phone; Ahead will shrink it for you.`);
    }
    if (minSide && Math.min(info.width, info.height) < minSide) {
      throw new RefImageError('error_below_min_image_size', `That photo is only ${info.width}×${info.height} px; at least ${minSide} px is needed. Try a larger product photo.`);
    }
    return { buf, info };
  }
  throw new RefImageError('error_download_image', 'That link redirects too many times.');
}
