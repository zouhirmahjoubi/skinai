// A clearly-labelled sample journey so judges and first-time users can see
// how Still Me reads a treatment course without spending API units. The scores
// are synthetic but follow the documented EGFR-inhibitor pattern: an
// acne-like rash in the first weeks, then dryness. The face is an AI-generated
// portrait, not a real person; the looks and masks in web/public/sample are real
// YouCam results on that portrait.
const MASKS = ['moisture', 'redness', 'acne', 'texture', 'radiance', 'age_spot', 'oiliness', 'dark_circle'];

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
  ].map((c) => ({ ...c, sample: true, photo: '/sample/checkin.webp' }));
  const latest = checkins[checkins.length - 1];
  latest.baseImage = '/sample/checkin.webp';
  for (const k of MASKS) latest.scores[k].mask = `/sample/mask-${k}.webp`;
  const madeAt = `${day(-2, start)}T12:00:00`;
  const look = (id, kind, label) => ({ id: `sample-${id}`, kind, image: `/sample/look-${id}.webp`, label, createdAt: madeAt, sample: true });
  return {
    // No consentedAt: the sample skips setup, so the photo notice shows before a first real photo.
    profile: { name: 'Sam', treatments: ['egfr', 'chemo'], startDate, sample: true },
    checkins,
    looks: [look('feather', 'hair', 'Short feather cut, my colour'), look('bob', 'hair', 'Blunt bob, my colour'), look('brows', 'brows', 'My brows, lashes and lips'), look('earrings', 'earrings', 'Earrings'), look('regrowth', 'regrowth', 'Regrowth: soft waves, grey')],
    portrait: { id: 'sample-portrait', dataUrl: '/sample/portrait.jpg', width: 824, height: 1024 },
    hairChecks: [
      { id: 'sample-hair-0', date: day(-3, start), week: 0, score: 2.62, term: 'High Density' },
      { id: 'sample-hair-1', date: day(4, start), week: 1, score: 2.48, term: 'High Density' },
      { id: 'sample-hair-2', date: day(11, start), week: 2, score: 2.05, term: 'Medium Density' },
      { id: 'sample-hair-3', date: day(17, start), week: 3, score: 1.38, term: 'Low Density' },
    ],
    print: {
      sample: true,
      photo: '/sample/portrait.jpg',
      date: day(-3, start),
      colors: { hair_color: '#1f1b19', hair_color_name: 'Black', eyebrow_color: '#33241d', skin_color: '#c99a7e', eye_color: '#4a3020', eye_color_name: 'Brown', lip_color: '#a85e5e' },
      face: { faceShape: 'Oval', browShape: 'Soft Angled', browThickness: 'Average' },
    },
  };
}
