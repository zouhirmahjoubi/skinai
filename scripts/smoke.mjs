// Live smoke test: runs every YouCam feature Ahead uses, once, against the
// real API. Spends roughly 16 (HD skin) or 12 (SD) + 20 (colour tones)
// + 10 (face attributes) + 1 (brows) + 2 (hair) + 2 (hat) units.
//
//   YOUCAM_API_KEY=... node scripts/smoke.mjs face.jpg [portrait.jpg] [hat.jpg]
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
import { createYouCamClient } from '../server/youcam.js';
import { createLiveFeatures } from '../server/features.js';
import { sniffImage, skinTierFor } from '../server/image-info.js';

const [facePath, portraitPath, hatPath] = process.argv.slice(2);
const apiKey = process.env.YOUCAM_API_KEY;
if (!apiKey || !facePath) {
  console.error('Usage: YOUCAM_API_KEY=... node scripts/smoke.mjs face.jpg [portrait.jpg] [hat.jpg]');
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
const save = (name, dataUrl) => fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
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

// Skin analysis deletes its task (and the uploaded photo) afterwards, so it gets its own upload.
const skinUp = await step('upload (skin)', () => f.upload(face, info));
if (skinUp && tier) {
  const skin = await step('skin-analysis', () => f.analyzeSkin({ fileId: skinUp.fileId, tier }));
  if (skin) ok('skin-analysis', `${Object.entries(skin.scores).map(([k, v]) => `${k} ${v.raw}/${v.ui}${v.mask ? '+mask' : ''}`).join(', ')}; task deleted: ${skin.deleted}`);
}

const up = await step('upload (print)', () => f.upload(face, info));
let browsDone = false;
if (up) {
  const print = await step('skin-tone + face-attr', () => f.print({ fileId: up.fileId }));
  if (print) ok('print', JSON.stringify(print));
  if (fitsMakeup(info)) {
    const brow = await step('makeup-vto eyebrows (face photo)', () => f.browTryOn({ fileId: up.fileId, pattern: 'SoftArch1', color: '#3b2a20', intensity: 55 }));
    if (brow) {
      save('smoke-brows.jpg', brow.image);
      ok('makeup-vto', 'saved smoke-brows.jpg');
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
    const pUp = await step('upload portrait', () => f.upload(portrait, pInfo));
    if (pUp && templates?.length) {
      const t = templates.find((x) => x.keepsColor) || templates[0];
      const hair = await step('hair-transfer', () => f.hairTryOn({ fileId: pUp.fileId, templateId: t.id, keepColor: t.keepsColor }));
      if (hair) {
        save('smoke-hair.jpg', hair.image);
        ok('hair-transfer', `saved smoke-hair.jpg (${t.id})`);
      }
    }
    if (pUp && !browsDone) {
      const brow = await step('makeup-vto eyebrows (portrait)', () => f.browTryOn({ fileId: pUp.fileId, pattern: 'SoftArch1', color: '#3b2a20', intensity: 55 }));
      if (brow) {
        save('smoke-brows.jpg', brow.image);
        ok('makeup-vto', 'saved smoke-brows.jpg from portrait');
      }
    }
    if (pUp && hatPath) {
      const hat = fs.readFileSync(hatPath);
      const hInfo = sniffImage(hat);
      const hUp = hInfo && (await step('upload hat', () => f.upload(hat, hInfo)));
      if (hUp) {
        const out = await step('hat', () => f.hatTryOn({ fileId: pUp.fileId, refFileId: hUp.fileId, gender: 'female' }));
        if (out) {
          save('smoke-hat.jpg', out.image);
          ok('hat', 'saved smoke-hat.jpg');
        }
      }
    }
  }
}

const after = await step('unit balance', () => f.units());
if (after !== null && before !== null) ok('units used', String(Math.round((before - after) * 100) / 100));
