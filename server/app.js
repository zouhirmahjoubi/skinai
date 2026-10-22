// HTTP API in front of YouCam. Stateless: photos pass through to YouCam and
// results go straight back to the browser, which keeps the journal on-device.

import crypto from 'node:crypto';
import express from 'express';
import { sniffImage, skinTierFor } from './image-info.js';
import { YouCamError, explain } from './errors.js';
import { fetchRefImage, RefImageError } from './ref-image.js';

const MAX_UPLOAD = 10 * 1024 * 1024;

// YouCam units per call (docs.perfectcorp.com unit tables): Skin Analysis
// 5-8 concerns = 12 SD / 16 HD; Facial Color Tones 20 + Face Attributes
// (1-5 features) 10; Hairstyle VTO v2.1 2; Hat VTO 2; Makeup VTO 1.
export const UNIT_COST = { skinHd: 16, skinSd: 12, print: 30, hair: 2, hat: 2, brows: 1 };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Errors YouCam reports about the person's own portrait even in reference mode.
const SOURCE_ONLY = new Set(['error_no_shoulder', 'error_hair_too_short', 'error_bald_image', 'InvalidFileId']);

export function createApp({
  features,
  accessCode = '',
  perIpDailyUnits = 100,
  dailyUnitBudget = 300,
  perIpDailyUploads = 150,
  trustProxy = 1,
  csp = false,
  refFetch = fetchRefImage,
  logger = console,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Number of reverse proxies in front of the server (1 on Render); 0 when exposed directly.
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    });
    if (csp) res.set('Content-Security-Policy', CSP);
    if (csp && req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '64kb' }));

  // Free routes, no units spent: available without the access code.
  api.get('/status', (req, res) => {
    res.json({ mode: features.mode, accessCodeRequired: Boolean(accessCode) });
  });
  api.get('/hair/templates', wrap(async (req, res) => res.json({ templates: await features.hairTemplates() })));
  api.get('/brows/patterns', wrap(async (req, res) => res.json({ patterns: await features.browPatterns() })));

  api.use((req, res, next) => {
    if (!accessCode) return next();
    const given = Buffer.from(String(req.get('x-access-code') || ''));
    const want = Buffer.from(accessCode);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
    res.status(401).json({ error: { code: 'AccessCode', fix: 'setup', message: 'Enter the access code for this demo.' } });
  });

  // Budgets are kept in YouCam units, per IP and for the whole server, per UTC
  // day. YouCam doesn't charge failed tasks, so 4xx answers are refunded.
  let day = '';
  let serverUnits = 0;
  const usage = new Map();
  const uploads = new Map();
  const rollDay = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      serverUnits = 0;
      usage.clear();
      uploads.clear();
    }
  };
  const limited = (res, code, message) => res.status(429).json({ error: { code, fix: 'service', message } });

  const quota = (costOf) => (req, res, next) => {
    if (features.mode !== 'live') return next();
    rollDay();
    const cost = costOf(req.body || {});
    const key = req.ip || 'unknown';
    const used = usage.get(key) || 0;
    if (!usage.has(key) && usage.size >= 20_000) return limited(res, 'DailyLimit', 'The demo is busy right now. Please try again later.');
    if (perIpDailyUnits && used + cost > perIpDailyUnits) return limited(res, 'DailyLimit', 'Daily analysis limit reached for this demo. Please come back tomorrow, or explore the sample journey.');
    if (dailyUnitBudget && serverUnits + cost > dailyUnitBudget) return limited(res, 'DemoBudget', 'Today’s live analyses for this demo are used up. Please come back tomorrow, or explore the sample journey.');
    usage.set(key, used + cost);
    serverUnits += cost;
    const chargedDay = day;
    res.on('finish', () => {
      if (res.statusCode < 400 || res.statusCode >= 500 || chargedDay !== day) return;
      usage.set(key, Math.max(0, (usage.get(key) || 0) - cost));
      serverUnits = Math.max(0, serverUnits - cost);
    });
    next();
  };

  const uploadLimit = (req, res, next) => {
    rollDay();
    const key = req.ip || 'unknown';
    const n = (uploads.get(key) || 0) + 1;
    if (perIpDailyUploads && n > perIpDailyUploads) return limited(res, 'DailyLimit', 'Too many photos from this device today. Please come back tomorrow.');
    if (!uploads.has(key) && uploads.size >= 20_000) return limited(res, 'DailyLimit', 'The demo is busy right now. Please try again later.');
    uploads.set(key, n);
    next();
  };

  // Rejected before the body is buffered, so oversized uploads are cheap to refuse.
  api.post('/upload', uploadLimit, express.raw({ type: ['image/jpeg', 'image/png'], limit: MAX_UPLOAD }), wrap(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const info = buf && sniffImage(buf);
    if (!info) throw badRequest('NotAnImage', 'Please send a JPEG or PNG photo.');
    if (Math.min(info.width, info.height) < 320) throw badRequest('error_below_min_image_size', 'This photo is too small. Use at least 320 pixels on the short side.');
    const { fileId } = await features.upload(buf, info);
    res.json({ fileId, width: info.width, height: info.height, skinTier: skinTierFor(info) });
  }));

  api.post('/skin/analyze', quota((b) => (b.tier === 'sd' ? UNIT_COST.skinSd : UNIT_COST.skinHd)), wrap(async (req, res) => {
    const { fileId, tier } = req.body || {};
    requireFileId(fileId);
    if (tier !== 'hd' && tier !== 'sd') throw badRequest('InvalidTier', 'tier must be "hd" or "sd".', 'service');
    res.json(await features.analyzeSkin({ fileId, tier }));
  }));

  api.post('/print', quota(() => UNIT_COST.print), wrap(async (req, res) => {
    requireFileId(req.body?.fileId);
    res.json(await features.print({ fileId: req.body.fileId }));
  }));

  // A wig or hat photo from a shop: either already uploaded (refFileId, the
  // browser re-encodes it) or a pasted link that we fetch and check first.
  async function resolveRef({ refFileId, refUrl }, limits) {
    if (typeof refFileId === 'string' && refFileId && refFileId.length <= 512) return refFileId;
    if (!refUrl) return null;
    try {
      const { buf, info } = await refFetch(String(refUrl), limits);
      return (await features.upload(buf, info)).fileId;
    } catch (err) {
      if (err instanceof RefImageError) throw badRequest(err.code, err.message, 'ref');
      throw err;
    }
  }
  async function asRefErrors(fn, what) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof YouCamError && !err.expose && !SOURCE_ONLY.has(err.code) && explain(err.code).fix === 'photo') {
        const message = err.code === 'error_no_face' || err.code === 'error_insufficient_landmarks'
          ? `YouCam couldn’t read the ${what} photo. Use one photo of the item${what === 'wig' ? ' on a real model facing forward, not on a mannequin or laid flat' : ' on its own, filling a good part of the picture'}.`
          : `This ${what} photo didn’t work. Try a different, clearer product photo. If the styles above work on your portrait, your portrait is fine.`;
        throw badRequest(err.code, message, 'ref');
      }
      throw err;
    }
  }

  api.post('/hair/try-on', quota(() => UNIT_COST.hair), wrap(async (req, res) => {
    const { fileId, templateId, refUrl, refFileId, keepColor } = req.body || {};
    requireFileId(fileId);
    if (!templateId && !refUrl && !refFileId) throw badRequest('MissingStyle', 'Choose a style or add a wig photo.', 'ref');
    if (templateId) {
      return res.json(await features.hairTryOn({ fileId, templateId: String(templateId).slice(0, 128), keepColor: Boolean(keepColor) }));
    }
    const ref = await resolveRef({ refFileId, refUrl }, { maxLongSide: 1024 });
    res.json(await asRefErrors(() => features.hairTryOn({ fileId, refFileId: ref }), 'wig'));
  }));

  api.post('/hat/try-on', quota(() => UNIT_COST.hat), wrap(async (req, res) => {
    const { fileId, refUrl, refFileId, gender } = req.body || {};
    requireFileId(fileId);
    if (gender !== 'female' && gender !== 'male') throw badRequest('MissingGender', 'Choose how the preview should be styled.', 'service');
    if (!refUrl && !refFileId) throw badRequest('MissingStyle', 'Add a photo of the hat, cap or headband.', 'ref');
    const ref = await resolveRef({ refFileId, refUrl }, { minSide: 512 });
    res.json(await asRefErrors(() => features.hatTryOn({ fileId, refFileId: ref, gender }), 'head-covering'));
  }));

  api.post('/brows/try-on', quota(() => UNIT_COST.brows), wrap(async (req, res) => {
    const { fileId, pattern, color, intensity, thickness, curvature } = req.body || {};
    requireFileId(fileId);
    res.json(await features.browTryOn({ fileId, pattern: String(pattern || 'Original2').slice(0, 64), color, intensity, thickness, curvature }));
  }));

  api.get('/units', wrap(async (req, res) => res.json({ units: await features.units() })));

  api.use((req, res) => res.status(404).json({ error: { code: 'NotFound', fix: 'service', message: 'Unknown API route.' } }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'exceed_max_filesize', ...explain('exceed_max_filesize') } });
    }
    if (!(err instanceof YouCamError) && err?.expose && err.status >= 400 && err.status < 500) {
      // body-parser client errors: malformed JSON, bad encoding, aborted request.
      return res.status(err.status).json({ error: { code: 'BadRequest', fix: 'service', message: 'The request could not be read. Please try again.' } });
    }
    if (err instanceof YouCamError) {
      // Our own validation errors carry their message; YouCam codes get plain-language guidance.
      const { fix, message } = err.expose ? { fix: err.fix, message: err.message } : explain(err.code);
      if (fix !== 'photo' && fix !== 'ref') logger.warn?.(`[youcam] ${err.code}: ${err.message}`);
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return res.status(status).json({ error: { code: err.code, fix, message } });
    }
    logger.error?.(err);
    res.status(500).json({ error: { code: 'Internal', fix: 'service', message: 'Unexpected server error.' } });
  });

  app.use('/api', api);
  return app;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function badRequest(code, message, fix = 'photo') {
  const err = new YouCamError(message, code, 400);
  err.expose = true;
  err.fix = fix;
  return err;
}

function requireFileId(fileId) {
  if (typeof fileId !== 'string' || !fileId || fileId.length > 512) throw badRequest('MissingFileId', 'Upload a photo first.');
}

export function isPublicHttpsUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' || String(value).length > 2048) return false;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(u.hostname);
  } catch {
    return false;
  }
}
