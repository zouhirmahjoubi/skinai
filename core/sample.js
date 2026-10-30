// A clearly-labelled sample journey so judges and first-time users can see
// how Still Me reads a treatment course without spending API units. The scores
// are synthetic but follow the documented EGFR-inhibitor pattern: an
// acne-like rash in the first weeks, then dryness.

// Local calendar dates, like db.today(): toISOString() would give UTC dates,
// which run a day ahead in US evenings.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const day = (offset, base) => {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return iso(d);
};

export function sampleJourney(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 17);
  const startDate = iso(start);
  const s = (moisture, redness, acne, texture, radiance, age_spot, oiliness, dark_circle) => {
    const v = { moisture, redness, acne, texture, radiance, age_spot, oiliness, dark_circle };
    return Object.fromEntries(Object.entries(v).map(([k, raw]) => [k, { raw, ui: Math.round(60 + raw * 0.35), mask: null }]));
  };
  const checkins = [
    { id: 'sample-0', date: day(-3, start), tier: 'hd', scores: s(71.2, 78.4, 84.1, 74.0, 72.5, 80.3, 66.0, 70.2), capture: { brightness: 0.52 } },
    { id: 'sample-1', date: day(4, start), tier: 'hd', scores: s(69.8, 77.1, 82.9, 73.2, 71.9, 80.0, 67.1, 69.5), capture: { brightness: 0.5 } },
    { id: 'sample-2', date: day(11, start), tier: 'hd', scores: s(67.5, 71.3, 72.6, 70.4, 69.0, 79.1, 65.2, 68.8), capture: { brightness: 0.53 } },
    { id: 'sample-3', date: day(17, start), tier: 'hd', scores: s(62.9, 69.0, 66.4, 68.1, 67.2, 78.6, 64.9, 68.0), capture: { brightness: 0.51 } },
  ].map((c) => ({ ...c, sample: true }));
  return {
    profile: { name: 'Sam (sample)', treatments: ['egfr', 'chemo'], startDate, sample: true, consentedAt: new Date(now).toISOString() },
    checkins,
    print: {
      sample: true,
      date: day(-3, start),
      colors: { hair_color: '#42280E', hair_color_name: 'Brown', eyebrow_color: '#33241d', skin_color: '#b98a6e', eye_color: '#4a3020', eye_color_name: 'Brown', lip_color: '#a85e5e' },
      face: { faceShape: 'Oval', browShape: 'Soft Angled', browThickness: 'Average' },
    },
  };
}
