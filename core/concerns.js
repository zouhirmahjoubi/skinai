// The eight skin signals Ahead tracks, with their YouCam HD and SD action names.
// YouCam scores run 1-100 where HIGHER means healthier-looking skin, so every
// label is phrased so that a high score reads as good.

export const CONCERNS = [
  { key: 'moisture', hd: 'hd_moisture', sd: 'moisture', label: 'Hydration', short: 'Hydration', about: 'How hydrated and supple your skin looks.' },
  { key: 'redness', hd: 'hd_redness', sd: 'redness', label: 'Calm skin', short: 'Calm', about: 'Lower redness and irritation scores higher.' },
  { key: 'acne', hd: 'hd_acne', sd: 'acne', label: 'Clear skin', short: 'Clear', about: 'Fewer bumps and breakouts score higher.' },
  { key: 'texture', hd: 'hd_texture', sd: 'texture', label: 'Smoothness', short: 'Smooth', about: 'Rough or flaky patches lower this score.' },
  { key: 'radiance', hd: 'hd_radiance', sd: 'radiance', label: 'Radiance', short: 'Glow', about: 'Dull or sallow-looking skin lowers this score.' },
  { key: 'age_spot', hd: 'hd_age_spot', sd: 'age_spot', label: 'Even tone', short: 'Even', about: 'New dark spots or patches lower this score.' },
  { key: 'oiliness', hd: 'hd_oiliness', sd: 'oiliness', label: 'Oil balance', short: 'Balance', about: 'Shine and excess oil lower this score.' },
  { key: 'dark_circle', hd: 'hd_dark_circle', sd: 'dark_circle_v2', label: 'Under-eye', short: 'Eyes', about: 'Darker under-eye areas lower this score.' },
];

export const CONCERN_BY_KEY = Object.fromEntries(CONCERNS.map((c) => [c.key, c]));

export function dstActionsFor(tier) {
  if (tier !== 'hd' && tier !== 'sd') throw new Error(`Unknown skin-analysis tier: ${tier}`);
  return CONCERNS.map((c) => c[tier]);
}

const BY_ACTION = new Map(CONCERNS.flatMap((c) => [[c.hd, c.key], [c.sd, c.key]]));

/**
 * Normalises a YouCam skin-analysis result (format=json `output` array, or the
 * score_info.json object shape) into { scores, overall, skinAge, baseImageUrl }.
 * Sub-regions (e.g. pore "nose") are ignored; only "whole" or unregioned rows count.
 */
export function normalizeSkinResult(results) {
  const out = { scores: {}, overall: null, skinAge: null, baseImageUrl: null };
  const rows = Array.isArray(results?.output) ? results.output : Array.isArray(results) ? results : null;

  if (rows) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (row.type === 'skin_age') out.skinAge = num(row.score);
      else if (row.type === 'all') out.overall = num(row.score);
      else if (row.type === 'resize_image') out.baseImageUrl = row.mask_urls?.[0] || null;
      else {
        const key = BY_ACTION.get(row.type);
        if (!key || (row.region && row.region !== 'whole')) continue;
        out.scores[key] = { ui: num(row.ui_score), raw: num(row.raw_score), maskUrl: row.mask_urls?.[0] || null };
      }
    }
    return out;
  }

  if (results && typeof results === 'object') {
    for (const [name, value] of Object.entries(results)) {
      if (name === 'all') out.overall = num(value?.score);
      else if (name === 'skin_age') out.skinAge = num(value);
      else {
        const key = BY_ACTION.get(name);
        if (!key || !value) continue;
        const v = value.whole || value;
        out.scores[key] = { ui: num(v.ui_score), raw: num(v.raw_score), maskUrl: null };
      }
    }
  }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
