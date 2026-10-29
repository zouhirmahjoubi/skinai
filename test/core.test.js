import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkinResult, dstActionsFor } from '../core/concerns.js';
import { compareCheckin, compareScore } from '../core/trends.js';
import { watchNotes, questionsFor } from '../core/insights.js';
import { parseInci, classify, shelfContext, rankShelf, evaluateProduct } from '../core/ingredients.js';
import { deltaE2000Lab, closest, ita } from '../core/color.js';
import { treatmentPhase, expectationsFor } from '../core/treatments.js';
import { browPatternFor, browEffects, normalizeFaceAttributes } from '../core/brows.js';
import { sampleJourney } from '../core/sample.js';
import { CATALOG, BROW_PRODUCTS } from '../core/catalog.js';

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

test('a real check-in is never compared with sample check-ins', () => {
  const sj = sampleJourney();
  const scores = Object.fromEntries(Object.keys(sj.checkins[0].scores).map((k) => [k, { raw: 60 }]));
  const real = { id: 'r1', date: sj.checkins[3].date, createdAt: 'x', tier: 'hd', scores, capture: { brightness: 0.7 } };
  const cmp = compareCheckin([...sj.checkins, real], real);
  assert.equal(cmp.baseline, null);
  assert.equal(cmp.previous, null);
  assert.deepEqual(watchNotes(sj.profile, cmp).map((n) => n.id), ['baseline']);
});

test('sample journey dates are local calendar dates', () => {
  const now = new Date(2026, 9, 21, 23, 30);
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(sampleJourney(now).checkins.at(-1).date, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
});

test('treatmentPhase counts calendar days across DST changes', () => {
  const pad = (n) => String(n).padStart(2, '0');
  for (let i = 0; i < 400; i += 3) {
    const s = new Date(2026, 0, 1 + i);
    const sd = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
    for (const off of [-14, -1, 0, 6, 7, 13, 14, 21]) {
      const now = new Date(s.getFullYear(), s.getMonth(), s.getDate() + off, 13);
      const expected = off < 0 ? { phase: 'before', week: 0, daysUntil: -off } : { phase: 'during', week: Math.floor(off / 7) + 1, daysUntil: 0 };
      assert.deepEqual(treatmentPhase(sd, now), expected, `${sd} +${off}`);
    }
  }
});

test('hair-loss card matches its own timing text', () => {
  const now = new Date('2026-10-22T10:00:00');
  assert.equal(expectationsFor(['chemo'], '2026-10-22', now).find((e) => e.id === 'chemo_hair'), undefined); // week 1
  assert.equal(expectationsFor(['chemo'], '2026-10-15', now).find((e) => e.id === 'chemo_hair').timing, 'soon'); // week 2
  assert.equal(expectationsFor(['chemo'], '2026-09-24', now).find((e) => e.id === 'chemo_hair').timing, 'now'); // week 5
});

test('a borderline drop in different light asks for a retake before a call', () => {
  const profile = { treatments: ['egfr'], startDate: '2026-10-08' };
  const now = new Date('2026-10-22');
  const base = { id: 'a', date: '2026-10-07', tier: 'hd', scores: { acne: { raw: 90 } }, capture: { brightness: 0.5 } };
  const rashOf = (c) => watchNotes(profile, compareCheckin([base, c], c), now).find((n) => n.expectation === 'egfr_rash');
  const brighter = { id: 'b', date: '2026-10-21', tier: 'hd', scores: { acne: { raw: 84 } }, capture: { brightness: 0.6 } };
  assert.equal(rashOf(brighter).level, 'watch');
  assert.match(rashOf(brighter).confirm, /Retake/);
  assert.equal(rashOf({ ...brighter, capture: { brightness: 0.52 } }).level, 'call', 'same light still escalates');
  assert.equal(rashOf({ ...brighter, scores: { acne: { raw: 76 } } }).level, 'call', 'a large drop escalates in any light');
});

test('radiation darkening or peeling maps to the radiation note, not "not typical"', () => {
  const profile = { treatments: ['radiation'], startDate: '2026-09-01' };
  const checkins = [
    { id: 'a', date: '2026-09-01', tier: 'hd', scores: { age_spot: { raw: 85 }, redness: { raw: 80 } } },
    { id: 'b', date: '2026-10-01', tier: 'hd', scores: { age_spot: { raw: 70 }, redness: { raw: 79 } } },
  ];
  const notes = watchNotes(profile, compareCheckin(checkins, checkins[1]), new Date('2026-10-02'));
  assert.ok(notes.some((n) => n.expectation === 'rad_redness'));
  assert.ok(!notes.some((n) => n.id === 'unexplained:age_spot'));
  assert.ok(questionsFor(notes).some((q) => /treated area/.test(q)));
});

test('steady note is scoped to the face and still points to the care team', () => {
  const cmp = { baseline: true, lighting: { comparable: true, diff: 0 }, rows: [{ key: 'redness', vsBase: { status: 'steady', delta: 1 } }] };
  const [n] = watchNotes({ treatments: ['immuno'], startDate: '2026-01-01' }, cmp, new Date('2026-02-10'));
  assert.equal(n.id, 'steady');
  assert.match(n.careTeam, /itch/);
  assert.match(n.title, /face/);
});

test('deeper skin tones get a redness caveat when a redness side effect is expected', () => {
  const cmp = { baseline: true, lighting: { comparable: true, diff: 0 }, rows: [{ key: 'redness', vsBase: { status: 'steady', delta: 1 } }] };
  const ids = (hex) => watchNotes({ treatments: ['radiation'], startDate: '2026-09-01' }, cmp, new Date('2026-10-02'), { skinHex: hex }).map((n) => n.id);
  assert.ok(ita('#6b4a3a') < 10 && ita('#e8c4a8') > 10);
  assert.ok(ids('#6b4a3a').includes('tone'));
  assert.ok(!ids('#e8c4a8').includes('tone'));
  assert.ok(!ids(undefined).includes('tone'));
});

test('early EGFR and chemo phases add preventive questions', () => {
  assert.ok(questionsFor([], { treatments: ['egfr'], phase: { phase: 'before', week: 0 } }).some((q) => /preventive/.test(q)));
  assert.ok(!questionsFor([], { treatments: ['egfr'], phase: { phase: 'during', week: 5 } }).some((q) => /preventive/.test(q)));
  assert.ok(questionsFor([], { treatments: ['chemo'], phase: { phase: 'before', week: 0 } }).some((q) => /scalp cooling/.test(q)));
});

test('zinc/titanium only count as sunscreen on a labelled SPF 30+ product', () => {
  const ctx = shelfContext({ treatments: ['chemo'] }, []);
  const foundation = evaluateProduct({ id: 'f', name: 'Matte Foundation', type: 'moisturise', price: 1, ingredients: 'Water, Titanium Dioxide (CI 77891), Mica, Glycerin' }, ctx);
  assert.ok(!foundation.reasons.some((r) => r.cls === 'mineral_spf'));
  const spf = evaluateProduct(CATALOG.find((p) => p.id === 'sg-mineral-spf50'), ctx);
  assert.ok(spf.reasons.some((r) => r.cls === 'mineral_spf'));
});

test('CIEDE2000 matches the Sharma et al. reference pair and ranks brow pencils', () => {
  assert.equal(Math.round(deltaE2000Lab({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }) * 10000) / 10000, 2.0425);
  assert.equal(deltaE2000Lab({ L: 40, a: 10, b: 10 }, { L: 40, a: 10, b: 10 }), 0);
  assert.equal(closest(BROW_PRODUCTS, '#33241d')[0].item.id, 'sb-espresso');
  assert.equal(closest(BROW_PRODUCTS, 'not a colour')[0].dE, null);
});

test('brow effects tolerate bad input', () => {
  assert.equal(browEffects({ color: 123456 })[1].palettes[0].color, '#5a4636');
  assert.equal(browEffects({ pattern: '../../etc' })[1].pattern.name, 'Original2');
});

test('lashes, under-eye and lips join the brow call only when asked for', () => {
  assert.deepEqual(browEffects({}).map((e) => e.category), ['skin_smooth', 'eyebrows']);
  const fx = browEffects({ lashes: { style: 'Upper&Lower1' }, underEye: { color: 'b98a6e' }, lips: { color: '#a85e5e' } });
  assert.deepEqual(fx.map((e) => e.category), ['skin_smooth', 'eyebrows', 'eyelashes', 'concealer', 'lip_color']);
  assert.equal(fx[2].pattern.name, 'Upper&Lower1');
  assert.equal(fx[3].palettes[0].color, '#b98a6e');
  assert.ok(fx[3].palettes[0].colorUnderEyeIntensity > 0);
  assert.equal(fx[4].shape.name, 'original');
  assert.equal(fx[4].palettes[0].texture, 'satin', 'satin needs no gloss or shimmer fields');
  const bad = browEffects({ lashes: { style: 'Artistic9', color: 'red' }, underEye: true, lips: 'pink' });
  assert.deepEqual(bad.map((e) => e.category), ['skin_smooth', 'eyebrows', 'eyelashes'], 'non-object extras are ignored');
  assert.equal(bad[2].pattern.name, 'Natural3', 'unknown lash styles fall back to Natural');
  assert.equal(bad[2].palettes[0].color, '#241a16');
});

test('before-treatment advice stays off notes once treatment has started', () => {
  const now = new Date('2026-10-22T10:00:00');
  const { profile, checkins } = sampleJourney(now);
  const last = checkins[checkins.length - 1];
  const rash = watchNotes(profile, compareCheckin(checkins, last), now).find((n) => n.expectation === 'egfr_rash');
  assert.equal(rash.level, 'call');
  assert.doesNotMatch(rash.careTeam, /first dose/i);
  const hair = expectationsFor(['chemo'], '2026-09-24', now).find((e) => e.id === 'chemo_hair');
  assert.doesNotMatch(hair.careTeam, /before your first infusion/);
  assert.match(hair.careTeamBefore, /before your first infusion/);
});

test('immunotherapy adds the immune question alongside concern-specific ones', () => {
  const notes = [
    { id: 'unexplained:moisture', concern: 'moisture', concerns: ['moisture'] },
    { id: 'unexplained:age_spot', concern: 'age_spot', concerns: ['age_spot'] },
  ];
  const q = questionsFor(notes, { treatments: ['immuno'] });
  assert.ok(q.some((x) => /immune-related/.test(x)));
  assert.ok(q.some((x) => /drier/.test(x)));
  assert.ok(q.some((x) => /darker patches/.test(x)));
});

test('steady note names where the camera cannot see, with the right preposition', () => {
  const cmp = { baseline: true, lighting: { comparable: true, diff: 0 }, rows: [{ key: 'redness', vsBase: { status: 'steady', delta: 1 } }] };
  const careTeam = (treatments) => watchNotes({ treatments, startDate: '2026-01-01' }, cmp, new Date('2026-02-10'))[0].careTeam;
  assert.match(careTeam(['chemo']), /skin change anywhere on your body/);
  assert.match(careTeam(['egfr', 'radiation']), /skin change on your scalp, chest or back, or in your treatment area/);
  assert.doesNotMatch(careTeam(['hormone']), /on anywhere/);
});

test('a big even-tone drop on chemo + radiation is not escalated by the radiation note', () => {
  const profile = { treatments: ['chemo', 'radiation'], startDate: '2026-09-01' };
  const checkins = [
    { id: 'a', date: '2026-09-01', tier: 'hd', scores: { age_spot: { raw: 85 }, redness: { raw: 80 } } },
    { id: 'b', date: '2026-10-01', tier: 'hd', scores: { age_spot: { raw: 72 }, redness: { raw: 80 } } },
  ];
  const notes = watchNotes(profile, compareCheckin(checkins, checkins[1]), new Date('2026-10-02'));
  assert.equal(notes[0].expectation, 'chemo_sun');
  assert.equal(notes[0].level, 'watch');
  assert.ok(questionsFor(notes, { treatments: profile.treatments }).some((q) => /sun-sensitive/.test(q)));
  const radFirst = watchNotes({ ...profile, treatments: ['radiation', 'chemo'] }, compareCheckin(checkins, checkins[1]), new Date('2026-10-02'));
  assert.ok(questionsFor(radFirst, { treatments: ['radiation', 'chemo'] }).some((q) => /sun-sensitive/.test(q)));
});

test('the deeper-skin redness caveat covers every treatment read from redness', () => {
  const cmp = { baseline: true, lighting: { comparable: true, diff: 0 }, rows: [{ key: 'redness', vsBase: { status: 'steady', delta: 1 } }] };
  const ids = (treatments) => watchNotes({ treatments, startDate: '2026-09-01' }, cmp, new Date('2026-10-02'), { skinHex: '#6b4a3a' }).map((n) => n.id);
  assert.ok(ids(['egfr']).includes('tone'));
  assert.ok(ids(['immuno']).includes('tone'));
  assert.ok(!ids(['hormone']).includes('tone'));
});

test('an obscured brow on one side falls back to the side YouCam could read', () => {
  const f = normalizeFaceAttributes({ faceshape: 'Unknown', eyebrow: { left_shape: 'Obscured', right_shape: 'Soft Angled', left_body_thickness: 'Unknown', right_body_thickness: 'Dense' } });
  assert.equal(f.faceShape, null);
  assert.equal(f.browShape, 'Soft Angled');
  assert.equal(f.browThickness, 'Dense');
  assert.equal(browPatternFor(f.browShape), browPatternFor('Soft Angled'));
  const both = normalizeFaceAttributes({ eyebrow: { left_shape: 'Obscured', right_shape: 'Obscured' } });
  assert.equal(both.browShape, 'Obscured');
});
