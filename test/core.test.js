import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkinResult, dstActionsFor } from '../core/concerns.js';
import { compareCheckin, compareScore } from '../core/trends.js';
import { watchNotes, questionsFor } from '../core/insights.js';
import { parseInci, classify, shelfContext, rankShelf, evaluateProduct } from '../core/ingredients.js';
import { treatmentPhase, expectationsFor } from '../core/treatments.js';
import { browPatternFor, browEffects, normalizeFaceAttributes } from '../core/brows.js';
import { sampleJourney } from '../core/sample.js';
import { CATALOG } from '../core/catalog.js';

test('dst_actions never mix HD and SD', () => {
  assert.ok(dstActionsFor('hd').every((a) => a.startsWith('hd_')));
  assert.ok(dstActionsFor('sd').every((a) => !a.startsWith('hd_')));
  assert.throws(() => dstActionsFor('4k'));
});

test('normalizes the documented format=json output array', () => {
  const results = {
    output: [
      { type: 'hd_acne', region: 'whole', raw_score: 59.9, ui_score: 76, mask_urls: ['https://x/acne.png'] },
      { type: 'hd_pore', region: 'nose', raw_score: 29.1, ui_score: 58, mask_urls: [] },
      { type: 'hd_moisture', raw_score: 48.7, ui_score: 70, mask_urls: ['https://x/m.png'] },
      { type: 'skin_age', score: 37 },
      { type: 'all', score: 75.7 },
      { type: 'resize_image', mask_urls: ['https://x/base.jpg'] },
    ],
  };
  const n = normalizeSkinResult(results);
  assert.deepEqual(n.scores.acne, { ui: 76, raw: 59.9, maskUrl: 'https://x/acne.png' });
  assert.equal(n.scores.moisture.raw, 48.7);
  assert.equal(n.scores.pore, undefined, 'pore is not tracked and sub-regions are ignored');
  assert.equal(n.skinAge, 37);
  assert.equal(n.overall, 75.7);
  assert.equal(n.baseImageUrl, 'https://x/base.jpg');
});

test('normalizes the score_info.json object shape', () => {
  const n = normalizeSkinResult({ hd_acne: { whole: { raw_score: 59.9, ui_score: 76 } }, hd_redness: { raw_score: 72, ui_score: 77 }, all: { score: 75 }, skin_age: 37 });
  assert.equal(n.scores.acne.ui, 76);
  assert.equal(n.scores.redness.raw, 72);
  assert.equal(n.skinAge, 37);
});

test('score changes inside retake noise read as steady', () => {
  assert.equal(compareScore({ raw: 70 }, { raw: 73 }).status, 'steady');
  assert.equal(compareScore({ raw: 64 }, { raw: 71 }).status, 'worse');
  assert.equal(compareScore({ raw: 55 }, { raw: 71 }).status, 'much-worse');
  assert.equal(compareScore({ raw: 80 }, { raw: 71 }).status, 'better');
  assert.equal(compareScore(null, { raw: 71 }).status, 'new');
});

test('HD and SD check-ins are never compared with each other', () => {
  const checkins = [
    { id: 'a', date: '2026-10-01', tier: 'sd', scores: { acne: { raw: 90 } } },
    { id: 'b', date: '2026-10-08', tier: 'hd', scores: { acne: { raw: 60 } } },
  ];
  const cmp = compareCheckin(checkins, checkins[1]);
  assert.equal(cmp.baseline, null);
  assert.equal(cmp.rows.find((r) => r.key === 'acne').vsBase.status, 'new');
});

test('treatment phase and expectations', () => {
  const now = new Date('2026-10-22T10:00:00');
  assert.deepEqual(treatmentPhase('2026-10-25', now), { phase: 'before', week: 0, daysUntil: 3 });
  assert.equal(treatmentPhase('2026-10-22', now).week, 1);
  assert.equal(treatmentPhase('2026-10-08', now).week, 3);
  const exp = expectationsFor(['egfr'], '2026-10-08', now);
  assert.equal(exp[0].id, 'egfr_rash');
  assert.equal(exp[0].timing, 'now');
});

test('EGFR inhibitor + falling acne score -> tell care team, block acne products', () => {
  const now = new Date();
  const { profile, checkins } = sampleJourney(now);
  const current = checkins[checkins.length - 1];
  const notes = watchNotes(profile, compareCheckin(checkins, current), now);
  const rash = notes.find((n) => n.expectation === 'egfr_rash');
  assert.ok(rash, 'rash note present');
  assert.equal(rash.level, 'call');
  assert.equal(notes[0], rash, 'care-team notes sort first');
  assert.deepEqual(rash.concerns.sort(), ['acne', 'redness']);
  assert.ok(rash.avoid.includes('benzoyl_peroxide'));
  assert.ok(rash.avoid.includes('bha'));

  const ctx = shelfContext(profile, notes);
  const ranked = rankShelf(CATALOG, ctx);
  const bp = ranked.find((r) => r.product.id === 'sc-bp-gel');
  assert.equal(bp.verdict, 'avoid');
  assert.match(bp.reasons[0].text, /EGFR/);
  assert.equal(ranked[0].verdict, 'good');
  assert.ok(ranked.slice(-3).every((r) => r.verdict === 'avoid'), 'avoid products sink');
  assert.ok(questionsFor(notes).some((q) => /acne-like rash/.test(q)));
});

test('a generic acne drop without EGFR therapy is not escalated', () => {
  const profile = { treatments: ['hormone'], startDate: '2026-09-01' };
  const checkins = [
    { id: 'a', date: '2026-09-01', tier: 'hd', scores: { acne: { raw: 85 } } },
    { id: 'b', date: '2026-10-01', tier: 'hd', scores: { acne: { raw: 70 } } },
  ];
  const notes = watchNotes(profile, compareCheckin(checkins, checkins[1]), new Date('2026-10-02'));
  assert.equal(notes[0].id, 'unexplained:acne');
  assert.equal(notes[0].level, 'watch');
});

test('lighting mismatch is flagged', () => {
  const checkins = [
    { id: 'a', date: '2026-09-01', tier: 'hd', scores: {}, capture: { brightness: 0.5 } },
    { id: 'b', date: '2026-09-08', tier: 'hd', scores: {}, capture: { brightness: 0.65 } },
  ];
  const notes = watchNotes({ treatments: [] }, compareCheckin(checkins, checkins[1]));
  const light = notes.find((n) => n.id === 'lighting');
  assert.ok(light);
  assert.match(light.body, /30% brighter/);
});

test('INCI parsing keeps parenthesised names together and classifies', () => {
  const list = parseInci('Water, Iron Oxides (CI 77491, CI 77492), Alcohol Denat., Cetearyl Alcohol, Zinc Oxide 18%, Parfum');
  assert.deepEqual(list, ['water', 'iron oxides (ci 77491, ci 77492)', 'alcohol denat', 'cetearyl alcohol', 'zinc oxide 18%', 'parfum']);
  const found = classify(list);
  assert.deepEqual(found.drying_alcohol, ['alcohol denat'], 'fatty alcohols are not drying');
  assert.ok(found.mineral_spf);
  assert.ok(found.fragrance);
});

test('baseline caution applies during any treatment', () => {
  const ctx = shelfContext({ treatments: ['chemo'] }, []);
  const lotion = evaluateProduct(CATALOG.find((p) => p.id === 'sg-lavender-lotion'), ctx);
  assert.equal(lotion.verdict, 'caution');
  const cream = evaluateProduct(CATALOG.find((p) => p.id === 'sg-oat-cream'), ctx);
  assert.equal(cream.verdict, 'good');
  assert.ok(cream.reasons.some((r) => r.cls === 'soothing' || r.cls === 'occlusive'));
});

test('brow print maps to makeup-vto effects without skin smoothing', () => {
  assert.equal(browPatternFor('Soft Angled'), 'SoftArch1');
  assert.equal(browPatternFor('Obscured'), 'Original2');
  const fx = browEffects({ pattern: 'Straight1', color: '3e2b22', intensity: 140, thickness: -300 });
  assert.equal(fx[0].category, 'skin_smooth');
  assert.equal(fx[0].skinSmoothStrength, 0);
  assert.equal(fx[1].palettes[0].color, '#3e2b22');
  assert.equal(fx[1].palettes[0].colorIntensity, 100);
  assert.equal(fx[1].pattern.thickness, -100);
});

test('face attributes are read from the documented result parameters', () => {
  const n = normalizeFaceAttributes({ faceshape: 'Oval', eyebrow: { left_shape: 'Straight', right_shape: 'Straight', left_body_thickness: 'Dense' } });
  assert.deepEqual(n, { faceShape: 'Oval', browShape: 'Straight', browThickness: 'Dense' });
  const nested = normalizeFaceAttributes({ result: { FaceShape: { shape: 'Heart' }, eyebrow: { right_shape: 'Rounded' } } });
  assert.equal(nested.faceShape, 'Heart');
  assert.equal(nested.browShape, 'Rounded');
});
