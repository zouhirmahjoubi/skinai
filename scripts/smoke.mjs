// Live smoke test: runs every YouCam feature Ahead uses, once, against the
// real API. Uses units (roughly 12-16 for skin + 10 face + tone + 2 hair + makeup).
//
//   YOUCAM_API_KEY=... node scripts/smoke.mjs path/to/face.jpg [path/to/portrait.jpg]
//
// face.jpg: a front-facing selfie where the face fills most of the width.
// portrait.jpg: head and shoulders, long side <= 1024px (hairstyle try-on).

import fs from 'node:fs';
import { createYouCamClient } from '../server/youcam.js';
import { createLiveFeatures } from '../server/features.js';
import { sniffImage, skinTierFor } from '../server/image-info.js';

const [facePath, portraitPath] = process.argv.slice(2);
const apiKey = process.env.YOUCAM_API_KEY;
if (!apiKey || !facePath) {
  console.error('Usage: YOUCAM_API_KEY=... node scripts/smoke.mjs face.jpg [portrait.jpg]');
  process.exit(1);
}

const client = createYouCamClient({ apiKey });
const f = createLiveFeatures(client);
const ok = (label, extra = '') => console.log(`  ok  ${label}${extra ? `: ${extra}` : ''}`);
const step = async (label, fn) => {
  try {
    const out = await fn();
    return out;
  } catch (err) {
    console.log(`  FAIL ${label}: ${err.code || ''} ${err.message}`);
    process.exitCode = 1;
    return null;
  }
};

console.log('YouCam smoke test');
const before = await step('unit balance', () => f.units());
if (before !== null) ok('unit balance', String(before));

const face = fs.readFileSync(facePath);
const info = sniffImage(face);
if (!info) throw new Error(`${facePath} is not a JPEG or PNG`);
const tier = skinTierFor(info);
ok('photo', `${info.width}x${info.height}, skin tier ${tier}`);

const { fileId } = (await step('upload', () => f.upload(face, info))) || {};
if (fileId) ok('upload', fileId.slice(0, 16) + '…');

if (fileId && tier) {
  const skin = await step('skin-analysis', () => f.analyzeSkin({ fileId, tier }));
  if (skin) ok('skin-analysis', Object.entries(skin.scores).map(([k, v]) => `${k} ${v.raw}/${v.ui}${v.mask ? '+mask' : ''}`).join(', '));
}
if (fileId) {
  const print = await step('skin-tone + face-attr', () => f.print({ fileId }));
  if (print) ok('print', JSON.stringify(print));
  const brow = await step('makeup-vto eyebrows', () => f.browTryOn({ fileId, pattern: 'SoftArch1', color: '#3b2a20', intensity: 55 }));
  if (brow) {
    fs.writeFileSync('smoke-brows.jpg', Buffer.from(brow.image.split(',')[1], 'base64'));
    ok('makeup-vto', 'saved smoke-brows.jpg');
  }
}

const templates = await step('hair-transfer templates', () => f.hairTemplates());
if (templates) ok('templates', `${templates.length} styles, e.g. ${templates.slice(0, 3).map((t) => t.id).join(', ')}`);
const patterns = await step('eyebrow pattern catalog', () => f.browPatterns());
if (patterns) ok('eyebrow patterns', patterns.slice(0, 6).map((p) => p.label).join(', '));

if (portraitPath && templates?.length) {
  const portrait = fs.readFileSync(portraitPath);
  const pInfo = sniffImage(portrait);
  const up = await step('upload portrait', () => f.upload(portrait, pInfo));
  if (up) {
    const hair = await step('hair-transfer', () => f.hairTryOn({ fileId: up.fileId, templateId: templates[0].id, keepColor: true }));
    if (hair) {
      fs.writeFileSync('smoke-hair.jpg', Buffer.from(hair.image.split(',')[1], 'base64'));
      ok('hair-transfer', 'saved smoke-hair.jpg');
    }
  }
}

const after = await step('unit balance', () => f.units());
if (after !== null && before !== null) ok('units used', String(before - after));
