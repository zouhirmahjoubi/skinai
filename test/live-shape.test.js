// Checks recorded live YouCam responses (from `RECORD_DIR=test/fixtures npm run
// smoke`) against Ahead's parsers. Skipped until fixtures have been recorded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSkinResult } from '../core/concerns.js';
import { normalizeFaceAttributes } from '../core/brows.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => {
  const file = new URL(name, dir);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

const skin = load('live-skin-analysis.json');
test('live skin-analysis response yields 8 scores', { skip: !skin && 'no recorded fixture' }, () => {
  const s = normalizeSkinResult(skin.data.results);
  assert.equal(Object.keys(s.scores).length, 8);
  for (const v of Object.values(s.scores)) assert.equal(typeof v.raw, 'number');
});

const face = load('live-face-attr-analysis.json');
test('live face-attr response yields face and brow shape', { skip: !face && 'no recorded fixture' }, () => {
  const f = normalizeFaceAttributes(face.data.results);
  assert.ok(f.faceShape && f.browShape && f.browThickness);
  assert.doesNotMatch(`${f.browShape} ${f.browThickness}`, /^(obscured|unknown)\b|\b(obscured|unknown)$/i, 'record fixtures with both brows visible');
});

const tone = load('live-skin-tone-analysis.json');
test('live skin-tone response has colours', { skip: !tone && 'no recorded fixture' }, () => {
  assert.ok(tone.data.results.color.eyebrow_color);
});
