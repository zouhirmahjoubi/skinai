// HTTP API in front of YouCam. Stateless: photos pass through to YouCam and
// results go straight back to the browser, which keeps the journal on-device.

import crypto from 'node:crypto';
import express from 'express';
import { sniffImage, skinTierFor } from './image-info.js';
import { YouCamError, explain } from './errors.js';

const MAX_UPLOAD = 10 * 1024 * 1024;

export function createApp({ features, accessCode = '', perIpDailyLimit = 40, logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const api = express.Router();
  api.use(express.json({ limit: '64kb' }));

  api.get('/status', (req, res) => {
    res.json({ mode: features.mode, accessCodeRequired: Boolean(accessCode) });
  });

  api.use((req, res, next) => {
    if (!accessCode) return next();
    const given = Buffer.from(String(req.get('x-access-code') || ''));
    const want = Buffer.from(accessCode);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
    res.status(401).json({ error: { code: 'AccessCode', fix: 'setup', message: 'Enter the access code for this demo.' } });
  });

  // Paid YouCam tasks per IP per day, so a public demo can't drain the units.
  const usage = new Map();
  const quota = (req, res, next) => {
    if (features.mode !== 'live' || !perIpDailyLimit) return next();
    const day = new Date().toISOString().slice(0, 10);
    const key = `${day}:${req.ip}`;
    const used = usage.get(key) || 0;
    if (used >= perIpDailyLimit) {
      return res.status(429).json({ error: { code: 'DailyLimit', fix: 'service', message: 'Daily analysis limit reached for this demo. Please come back tomorrow.' } });
    }
    usage.set(key, used + 1);
    if (usage.size > 5000) usage.clear();
    next();
  };

  api.post('/upload', express.raw({ type: ['image/jpeg', 'image/png'], limit: MAX_UPLOAD }), wrap(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const info = buf && sniffImage(buf);
    if (!info) throw badRequest('NotAnImage', 'Please send a JPEG or PNG photo.');
    if (Math.min(info.width, info.height) < 320) throw badRequest('error_below_min_image_size', 'This photo is too small. Use at least 320 pixels on the short side.');
    const { fileId } = await features.upload(buf, info);
    res.json({ fileId, width: info.width, height: info.height, skinTier: skinTierFor(info) });
  }));

  api.post('/skin/analyze', quota, wrap(async (req, res) => {
    const { fileId, tier } = req.body || {};
    requireFileId(fileId);
    if (tier !== 'hd' && tier !== 'sd') throw badRequest('InvalidTier', 'tier must be "hd" or "sd".');
    res.json(await features.analyzeSkin({ fileId, tier }));
  }));

  api.post('/print', quota, wrap(async (req, res) => {
    requireFileId(req.body?.fileId);
    res.json(await features.print({ fileId: req.body.fileId }));
  }));

  api.post('/hair/try-on', quota, wrap(async (req, res) => {
    const { fileId, templateId, refUrl, keepColor } = req.body || {};
    requireFileId(fileId);
    if (!templateId && !refUrl) throw badRequest('MissingStyle', 'Choose a style or paste a wig photo link.');
    if (refUrl && !isPublicHttpsUrl(refUrl)) throw badRequest('InvalidRefUrl', 'The wig photo link must be a public https:// image URL.');
    res.json(await features.hairTryOn({ fileId, templateId: templateId ? String(templateId) : null, refUrl, keepColor: Boolean(keepColor) }));
  }));

  api.post('/brows/try-on', quota, wrap(async (req, res) => {
    const { fileId, pattern, color, intensity, thickness, curvature } = req.body || {};
    requireFileId(fileId);
    res.json(await features.browTryOn({ fileId, pattern: String(pattern || 'Original2'), color, intensity, thickness, curvature }));
  }));

  api.get('/hair/templates', wrap(async (req, res) => res.json({ templates: await features.hairTemplates() })));
  api.get('/brows/patterns', wrap(async (req, res) => res.json({ patterns: await features.browPatterns() })));
  api.get('/units', wrap(async (req, res) => res.json({ units: await features.units() })));

  api.use((req, res) => res.status(404).json({ error: { code: 'NotFound', fix: 'service', message: 'Unknown API route.' } }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'exceed_max_filesize', ...explain('exceed_max_filesize') } });
    }
    if (err instanceof YouCamError) {
      // Our own validation errors carry their message; YouCam codes get plain-language guidance.
      const { fix, message } = err.expose ? { fix: err.fix, message: err.message } : explain(err.code);
      if (fix !== 'photo') logger.warn?.(`[youcam] ${err.code}: ${err.message}`);
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
