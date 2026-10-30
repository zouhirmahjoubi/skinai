// Live smoke test: runs every YouCam feature Ahead uses, once, against the
// real API. Spends roughly 16 (HD skin) or 12 (SD) + 20 (colour tones)
// + 10 (face attributes) + 1 (brows) + 2 (hair) + 2 (hat) units.
//
//   npm run smoke -- face.jpg [portrait.jpg] [hat.jpg]
//
// The key comes from YOUCAM_API_KEY or, failing that, from .env.
//
// face.jpg:     front-facing JPEG selfie, face filling most of the width. A short
//               side >= 1080 px runs the HD skin tier. Makeup VTO needs the long
//               side < 1920 px; a larger face photo runs brows on the portrait.
// portrait.jpg: head and shoulders, JPEG, long side <= 1024 px (hair, hat, brows).
// hat.jpg:      a product photo of one hat or cap, at least 512 x 512 px.
//
// RECORD_DIR=test/fixtures also saves each successful response (signed URLs
// redacted), which test/live-shape.test.js then checks.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createYouCamClient } from '../server/youcam.js';
import { createLiveFeatures } from '../server/features.js';
import { sniffImage, skinTierFor } from '../server/image-info.js';
import { loadDotEnv } from '../server/env.js';

loadDotEnv(fileURLToPath(new URL('../.env', import.meta.url)));

const [facePath, portraitPath, hatPath] = process.argv.slice(2);
const apiKey = process.env.YOUCAM_API_KEY;
if (!apiKey || !facePath) {
  console.error('Usage: npm run smoke -- face.jpg [portrait.jpg] [hat.jpg]  (YOUCAM_API_KEY in .env or the environment)');
  process.exit(1);
}

const recordDir = process.env.RECORD_DIR;
const redact = (v) =>
  typeof v === 'string' && /^https?:\/\//.test(v) ? '<redacted-url>' : Array.isArray(v) ? v.map(redact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)])) : v;
const recordingFetch = async (url, init = {}) => {
  const res = await fetch(url, init);
  const m = String(url).match(/\/s2s\/v[\d.]+\/task\/(template\/)?([a-z-]+)(\/|\?|$)/);
  if (recordDir && m && (init.method || 'GET') === 'GET') {
    const body = await res.clone().json().catch(() => null);
    if (body?.data?.task_status === 'success' || m[1]) {
      fs.mkdirSync(recordDir, { recursive: true });
      fs.writeFileSync(`${recordDir}/live-${m[1] ? 'templates-' : ''}${m[2]}.json`, JSON.stringify(redact(body), null, 2));
    }
  }
  return res;
};

const client = createYouCamClient({ apiKey, fetchImpl: recordingFetch });
const f = createLiveFeatures(client, { fetchImpl: recordingFetch });
const ok = (label, extra = '') => console.log(`  ok  ${label}${extra ? `: ${extra}` : ''}`);
const step = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.log(`  FAIL ${label}: ${err.code || ''} ${err.message}`);
    process.exitCode = 1;
    return null;
  }
};
// Saves a result under its real type (makeup-vto returns PNG) and returns the file name.
const save = (base, dataUrl) => {
  const [head, body] = dataUrl.split(',');
  const name = `${base}.${head.includes('image/png') ? 'png' : 'jpg'}`;
  fs.writeFileSync(name, Buffer.from(body, 'base64'));
  return name;
};
const fitsMakeup = (i) => Math.max(i.width, i.height) < 1920; // Makeup VTO: long side < 1920
const fitsHair = (i) => i && i.type === 'image/jpeg' && Math.max(i.width, i.height) <= 1024; // Hairstyle: JPEG, long side <= 1024

console.log('YouCam smoke test');
const before = await step('unit balance', () => f.units());
if (before !== null) ok('unit balance', String(before));

const face = fs.readFileSync(facePath);
const info = sniffImage(face);
if (!info) throw new Error(`${facePath} is not a JPEG or PNG`);
const tier = skinTierFor(info);
ok('photo', `${info.width}x${info.height}, skin tier ${tier}`);

// Every task is deleted afterwards with its uploaded photos, so each one gets its own upload.
const skinUp = await step('upload (skin)', () => f.upload(face, info));
if (skinUp && tier) {
  const skin = await step('skin-analysis', () => f.analyzeSkin({ fileId: skinUp.fileId, tier }));
  if (skin) ok('skin-analysis', `${Object.entries(skin.scores).map(([k, v]) => `${k} ${v.raw}/${v.ui}${v.mask ? '+mask' : ''}`).join(', ')}; task deleted: ${skin.deleted}`);
}

const up = await step('upload (print)', () => f.upload(face, info));
let browsDone = false;
if (up) {
  // print() keeps one half when the other fails, so check both halves here.
  const print = await step('skin-tone + face-attr', async () => {
    const p = await f.print({ fileId: up.fileId });
    const missing = [!p.colors && `skin-tone (${p.errors?.colors?.code})`, !p.face && `face-attr (${p.errors?.face?.code})`].filter(Boolean);
    if (missing.length) throw Object.assign(new Error(`missing ${missing.join(' and ')}`), { code: 'Partial' });
    return p;
  });
  if (print) ok('print', JSON.stringify(print));
  if (fitsMakeup(info)) {
    const bUp = await step('upload (brows)', () => f.upload(face, info));
    const brow = bUp && (await step('makeup-vto eyebrows (face photo)', () => f.browTryOn({ fileId: bUp.fileId, pattern: 'SoftArch1', color: '#3b2a20', intensity: 55 })));
    if (brow) {
      ok('makeup-vto', `saved ${save('smoke-brows', brow.image)}; task deleted: ${brow.deleted}`);
      browsDone = true;
    }
  } else console.log(`  skip makeup-vto on face photo: long side must be < 1920px (got ${info.width}x${info.height}); will use portrait`);
}

const templates = await step('hair-transfer templates', () => f.hairTemplates());
if (templates) ok('templates', `${templates.length} styles, e.g. ${templates.slice(0, 3).map((t) => t.id).join(', ')}`);
const patterns = await step('eyebrow pattern catalog', () => f.browPatterns());
if (patterns) ok('eyebrow patterns', patterns.slice(0, 6).map((p) => p.label).join(', '));

if (portraitPath) {
  const portrait = fs.readFileSync(portraitPath);
  const pInfo = sniffImage(portrait);
  if (!fitsHair(pInfo)) {
    console.log(`  FAIL portrait: hair-transfer needs a JPEG with long side <= 1024px (got ${pInfo ? `${pInfo.type} ${pInfo.width}x${pInfo.height}` : 'unreadable file'})`);
    process.exitCode = 1;
  } else {
    const upPortrait = (why) => step(`upload portrait (${why})`, () => f.upload(portrait, pInfo));
    if (templates?.length) {
      const t = templates.find((x) => x.keepsColor) || templates[0];
      const pUp = await upPortrait('hair');
      const hair = pUp && (await step('hair-transfer', () => f.hairTryOn({ fileId: pUp.fileId, templateId: t.id, keepColor: t.keepsColor })));
      if (hair) ok('hair-transfer', `saved ${save('smoke-hair', hair.image)} (${t.id}); task deleted: ${hair.deleted}`);
    }
    if (!browsDone) {
      const pUp = await upPortrait('brows');
      const brow = pUp && (await step('makeup-vto eyebrows (portrait)', () => f.browTryOn({ fileId: pUp.fileId, pattern: 'SoftArch1', color: '#3b2a20', intensity: 55 })));
      if (brow) ok('makeup-vto', `saved ${save('smoke-brows', brow.image)} from portrait`);
    }
    const pUp = hatPath && (await upPortrait('hat'));
    if (pUp) {
      const hat = fs.readFileSync(hatPath);
      const hInfo = sniffImage(hat);
      const hUp = hInfo && (await step('upload hat', () => f.upload(hat, hInfo)));
      if (hUp) {
        const out = await step('hat', () => f.hatTryOn({ fileId: pUp.fileId, refFileId: hUp.fileId, gender: 'female' }));
        if (out) ok('hat', `saved ${save('smoke-hat', out.image)}; task deleted: ${out.deleted}`);
      }
    }
  }
}

const after = await step('unit balance', () => f.units());
if (after !== null && before !== null) ok('units used', String(Math.round((before - after) * 100) / 100));
