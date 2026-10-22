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
// Skin tone 20 + face attributes 10 make up the print.
export const UNIT_COST = { skinHd: 16, skinSd: 12, tone: 20, face: 10, print: 30, hair: 2, hat: 2, brows: 1 };

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

// Errors YouCam documents as about the person's own portrait (the source
// image) even when a wig or hat photo is sent as the reference: Hairstyle VTO
// error_insufficient_landmarks / error_face_pose / error_large_face_angle and
// Hat VTO error_no_face are all "in the source image".
const PORTRAIT_ERRORS = ['error_no_shoulder', 'error_hair_too_short', 'error_bald_image', 'InvalidFileId'];
const SOURCE_ONLY = {
  wig: new Set([...PORTRAIT_ERRORS, 'error_insufficient_landmarks', 'error_face_pose', 'error_large_face_angle']),
  'head-covering': new Set([...PORTRAIT_ERRORS, 'error_no_face']),
};
const isSourceError = (code, what) => SOURCE_ONLY[what]?.has(code) || /^error_(src|face_position)_/.test(code);
// Shared engine codes that can come from either photo (the official enum is the
// same for every task), so the message names both instead of guessing.
const EITHER_PHOTO = {
  error_no_face: (what) => `YouCam couldn’t find a face in your portrait or in the ${what} photo. Check your face is clearly in view${what === 'wig' ? ', and use a wig photo on a real model facing forward, not on a mannequin or laid flat' : ''}.`,
  error_pose: (what) => `YouCam couldn’t read the pose in your portrait or the ${what} photo. Use a portrait facing the camera with your head level, or try a different ${what} photo.`,
  error_face_parsing: (what) => `YouCam couldn’t read the face in your portrait or the ${what} photo. Try a sharper portrait in even light, or a different ${what} photo.`,
  error_decode_image: (what) => `YouCam couldn’t open your portrait or the ${what} photo. Try again, or try a different ${what} photo.`,
  error_download_image: (what) => `YouCam couldn’t open your portrait or the ${what} photo. Try again, or try a different ${what} photo.`,
  error_nsfw_content_detected: (what) => `YouCam’s safety filter stopped this preview. Try again, or try a different ${what} photo.`,
};

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
  // day. 4xx answers (validation errors, and tasks YouCam reports as failed,
  // which it doesn't charge) are refunded, unless a task may still be billed.
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

  // A route can hand back part of what it charged (res.locals.refund units) when
  // part of the work failed without being billed.
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
      if (chargedDay !== day) return;
      const failed = res.statusCode >= 400 && res.statusCode < 500 && !res.locals.billed;
      const back = failed ? cost : res.statusCode < 400 ? Math.min(cost, Number(res.locals.refund) || 0) : 0;
      if (!back) return;
      usage.set(key, Math.max(0, (usage.get(key) || 0) - back));
      serverUnits = Math.max(0, serverUnits - back);
    });
    next();
  };

  // Counts photo uploads and server-side link fetches per IP per day.
  const takeUploadSlot = (req) => {
    rollDay();
    const key = req.ip || 'unknown';
    const n = (uploads.get(key) || 0) + 1;
    if (perIpDailyUploads && n > perIpDailyUploads) return 'Too many photos from this device today. Please come back tomorrow.';
    if (!uploads.has(key) && uploads.size >= 20_000) return 'The demo is busy right now. Please try again later.';
    uploads.set(key, n);
    return null;
  };
  const uploadLimit = (req, res, next) => {
    const refused = takeUploadSlot(req);
    if (refused) return limited(res, 'DailyLimit', refused);
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
    const result = await features.print({ fileId: req.body.fileId });
    // A half that failed with a task error wasn't charged by YouCam.
    const { colors: toneErr, face: faceErr } = result.errors || {};
    res.locals.refund = (toneErr && !toneErr.billed ? UNIT_COST.tone : 0) + (faceErr && !faceErr.billed ? UNIT_COST.face : 0);
    const plain = (e) => (e ? { code: e.code, fix: e.fix, message: e.message } : null);
    res.json(result.errors ? { ...result, errors: { colors: plain(toneErr), face: plain(faceErr) } } : result);
  }));

  // A wig or hat photo from a shop: either already uploaded (refFileId, the
  // browser re-encodes it) or a pasted link that we fetch and check first.
  async function resolveRef(req, { refFileId, refUrl }, limits) {
    if (typeof refFileId === 'string' && refFileId && refFileId.length <= 512) return refFileId;
    if (!refUrl) return null;
    // Demo try-ons ignore the reference, so links are only shape-checked there, never fetched.
    if (features.mode !== 'live') {
      if (!isPublicHttpsUrl(refUrl)) throw badRequest('InvalidRefUrl', 'The photo link must be a public https:// address.', 'ref');
      return 'demo_ref';
    }
    const refused = takeUploadSlot(req);
    if (refused) {
      const err = badRequest('DailyLimit', refused, 'service');
      err.status = 429;
      throw err;
    }
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
      if (err instanceof YouCamError && !err.expose && !isSourceError(err.code, what) && explain(err.code).fix === 'photo') {
        const message = EITHER_PHOTO[err.code]
          ? EITHER_PHOTO[err.code](what)
          : `This ${what} photo didn’t work. Try a different, clearer product photo.${what === 'wig' ? ' If the styles above work on your portrait, your portrait is fine.' : ''}`;
        throw badRequest(err.code, message, 'ref');
      }
      throw err;
    }
  }

  api.post('/hair/try-on', quota(() => UNIT_COST.hair), wrap(async (req, res) => {
    const { fileId, templateId, refUrl, refFileId, keepColor } = req.body || {};
    requireFileId(fileId);
    const template = typeof templateId === 'string' ? templateId.trim().slice(0, 128) : '';
    if (template) return res.json(await features.hairTryOn({ fileId, templateId: template, keepColor: Boolean(keepColor) }));
    const ref = await resolveRef(req, { refFileId, refUrl }, { maxLongSide: 1024, types: ['image/jpeg'] });
    if (!ref) throw badRequest('MissingStyle', 'Choose a style or add a wig photo.', 'ref');
    res.json(await asRefErrors(() => features.hairTryOn({ fileId, refFileId: ref }), 'wig'));
  }));

  api.post('/hat/try-on', quota(() => UNIT_COST.hat), wrap(async (req, res) => {
    const { fileId, refUrl, refFileId, gender } = req.body || {};
    requireFileId(fileId);
    if (gender !== 'female' && gender !== 'male') throw badRequest('MissingGender', 'Choose how the preview should be styled.', 'service');
    const ref = await resolveRef(req, { refFileId, refUrl }, { minSide: 512, maxLongSide: 4096 });
    if (!ref) throw badRequest('MissingStyle', 'Add a photo of the hat, cap or headband.', 'ref');
    res.json(await asRefErrors(() => features.hatTryOn({ fileId, refFileId: ref, gender }), 'head-covering'));
  }));

  api.post('/brows/try-on', quota(() => UNIT_COST.brows), wrap(async (req, res) => {
    const { fileId, pattern, color, intensity, thickness, curvature } = req.body || {};
    requireFileId(fileId);
    res.json(await features.browTryOn({ fileId, pattern: String(pattern || 'Original2').slice(0, 64), color, intensity, thickness, curvature }));
  }));

  // Each balance read is a YouCam request against the key's shared rate limit,
  // so answers are reused for 15 s and concurrent reads share one request.
  let unitsMemo = null;
  api.get('/units', wrap(async (req, res) => {
    if (!unitsMemo || Date.now() - unitsMemo.at > 15_000) {
      const pending = Promise.resolve().then(() => features.units());
      unitsMemo = { at: Date.now(), pending };
      pending.catch(() => {
        if (unitsMemo?.pending === pending) unitsMemo = null;
      });
    }
    res.json({ units: await unitsMemo.pending });
  }));

  api.use((req, res) => res.status(404).json({ error: { code: 'NotFound', fix: 'service', message: 'Unknown API route.' } }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err?.billed) res.locals.billed = true;
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
