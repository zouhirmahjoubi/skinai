// Noise-aware comparison of check-ins. A single selfie is a noisy measurement:
// light, angle and camera all move the scores. Published retake tests on
// YouCam skin analysis (github.com/StuartYo/youcam-claim-guard, README "Noise
// floor") report raw_score SDs of about 1-2 points between photos taken
// minutes apart in the same light, and up to ~3.75 across evenings. Still Me
// therefore treats a move smaller than CHANGE as "steady" and only calls a
// move larger than BIG_CHANGE "a lot".

import { CONCERNS } from './concerns.js';

export const CHANGE = 6;
export const BIG_CHANGE = 12;
// Face brightness may differ by this much (relative) before we warn that
// lighting, not skin, could explain a change.
export const LIGHT_TOLERANCE = 0.15;

/** One trend line: same quality tier, and synthetic sample check-ins never mix with real ones. */
export const sameSeries = (a, b) => a.tier === b.tier && Boolean(a.sample) === Boolean(b.sample);

/** Picks the comparable baseline: the first check-in in the same series. */
export function baselineFor(checkins, current) {
  return checkins.find((c) => sameSeries(c, current) && c.id !== current.id) || null;
}

export function previousFor(checkins, current) {
  const same = checkins.filter((c) => sameSeries(c, current) && c.date <= current.date && c.id !== current.id && c !== current);
  const before = same.filter((c) => c.date < current.date || (c.createdAt || '') < (current.createdAt || ''));
  return before.length ? before[before.length - 1] : null;
}

function valueOf(score) {
  if (!score) return null;
  return score.raw ?? score.ui ?? null;
}

/** Status of one concern versus a reference check-in. Scores: higher = healthier. */
export function compareScore(now, ref) {
  const a = valueOf(now);
  const b = valueOf(ref);
  if (a === null || b === null) return { delta: null, status: 'new' };
  const delta = Math.round((a - b) * 10) / 10;
  let status = 'steady';
  if (delta <= -BIG_CHANGE) status = 'much-worse';
  else if (delta <= -CHANGE) status = 'worse';
  else if (delta >= BIG_CHANGE) status = 'much-better';
  else if (delta >= CHANGE) status = 'better';
  return { delta, status };
}

/** Full comparison of a check-in against its baseline and the previous check-in. */
export function compareCheckin(checkins, current) {
  const sorted = [...checkins].sort((x, y) => (x.date < y.date ? -1 : 1));
  const base = baselineFor(sorted, current);
  const prev = previousFor(sorted, current);
  const rows = CONCERNS.map((c) => {
    const vsBase = base ? compareScore(current.scores?.[c.key], base.scores?.[c.key]) : { delta: null, status: 'new' };
    const vsPrev = prev ? compareScore(current.scores?.[c.key], prev.scores?.[c.key]) : { delta: null, status: 'new' };
    const history = sorted.filter((x) => sameSeries(x, current) && x.date <= current.date).map((x) => valueOf(x.scores?.[c.key]));
    return { key: c.key, label: c.label, score: current.scores?.[c.key] || null, vsBase, vsPrev, history };
  });
  return { baseline: base, previous: prev, rows, lighting: lightingCheck(current, base) };
}

export function lightingCheck(current, base) {
  const a = current?.capture?.brightness;
  const b = base?.capture?.brightness;
  if (!a || !b) return { comparable: true, diff: null };
  const diff = (a - b) / b;
  return { comparable: Math.abs(diff) <= LIGHT_TOLERANCE, diff: Math.round(diff * 100) / 100 };
}

export const STATUS_TEXT = {
  new: 'First reading',
  steady: 'Steady',
  better: 'Better',
  'much-better': 'Much better',
  worse: 'Lower',
  'much-worse': 'Much lower',
};
