// What treatments commonly do to skin, hair and brows, and when. Written for
// patients, deliberately conservative: Ahead never diagnoses, it explains what
// is commonly reported and when to bring a change to the care team.
//
// Sources (see README "Clinical grounding"): NCODA PQI "Managing EGFR
// Inhibitor Induced Rash" (2025); MASCC EGFRI dermatologic toxicity guideline
// (Lacouture et al., Support Care Cancer 2011); Huntsman Cancer Institute and
// Providence patient guidance on chemotherapy hair loss; radiation dermatitis
// reviews (e.g. American Nurse, "Understanding radiation dermatitis").

export const TREATMENTS = {
  chemo: {
    label: 'Chemotherapy',
    noun: 'chemotherapy',
    hint: 'IV or oral chemotherapy',
    expect: [
      {
        id: 'chemo_hair',
        title: 'Hair thinning or loss',
        weeks: [1, 4],
        band: [3, 5],
        short: 'Hair may shed',
        area: 'hair',
        body: 'With many chemotherapy drugs, hair starts to shed two to four weeks after the first dose, and brows and lashes can thin too. Not every drug does this, so ask your team what to expect from yours.',
        action: { label: 'Save your Hair & Brow Print', to: 'look' },
      },
      {
        id: 'chemo_dry',
        title: 'Dry, tight or sensitive skin',
        weeks: [1, null],
        band: [2, null],
        short: 'Dry skin',
        concern: 'moisture',
        body: 'Chemotherapy commonly leaves skin drier and more reactive than usual. Short lukewarm washes, a fragrance-free cream twice a day and skipping exfoliants usually help.',
        needs: ['ceramide', 'humectant', 'occlusive'],
      },
      {
        id: 'chemo_sun',
        title: 'Burning or darkening in the sun',
        weeks: [0, null],
        concern: 'age_spot',
        body: 'Some chemotherapy drugs make skin burn or darken more easily, sometimes leaving new dark patches. Daily broad-spectrum SPF 30+ and shade make a real difference.',
        needs: ['mineral_spf'],
      },
      {
        id: 'chemo_dull',
        title: 'Dull or uneven tone',
        weeks: [2, null],
        concern: 'radiance',
        body: 'A tired, sallow look is common during chemotherapy. It usually improves after treatment; a tinted moisturiser can help in the meantime.',
      },
    ],
  },
  radiation: {
    label: 'Radiation therapy',
    noun: 'radiation therapy',
    hint: 'Especially to the head, face or neck',
    expect: [
      {
        id: 'rad_redness',
        title: 'Skin reaction in the treated area',
        weeks: [2, null],
        band: [3, null],
        short: 'Skin reaction',
        concern: 'redness',
        body: 'Skin in the treated area often turns pink or red, then dry or itchy, usually starting a few weeks in. Ahead only sees your face, so this applies most if your face or neck is in the treatment field.',
        careTeam: 'Tell your radiation team about any skin change in the treated area. Many teams ask you not to put creams on it shortly before a session.',
        needs: ['soothing', 'humectant'],
        callIf: 'much-worse',
      },
    ],
  },
  egfr: {
    label: 'Targeted therapy: EGFR inhibitor',
    noun: 'EGFR inhibitors',
    hint: 'e.g. cetuximab, panitumumab, erlotinib, gefitinib, afatinib, osimertinib',
    expect: [
      {
        id: 'egfr_rash',
        title: 'Acne-like rash',
        weeks: [1, 6],
        band: [1, 4],
        short: 'Acne-like rash',
        concern: 'acne',
        alsoConcerns: ['redness'],
        body: 'An acne-like rash on the face, scalp or chest is one of the most common side effects of EGFR inhibitors, usually in the first weeks. It looks like acne but it is not acne, and over-the-counter acne products such as benzoyl peroxide or salicylic acid can make it worse.',
        careTeam: 'Tell your care team early. They often treat this rash with specific prescriptions, and treating it early can help you stay on your therapy.',
        avoid: ['benzoyl_peroxide', 'bha', 'aha', 'retinoid', 'scrub', 'drying_alcohol'],
        needs: ['humectant', 'mineral_spf', 'soothing'],
        callIf: 'worse',
      },
      {
        id: 'egfr_dry',
        title: 'Dry skin later on',
        weeks: [4, null],
        band: [5, null],
        short: 'Dry skin',
        concern: 'moisture',
        body: 'After the first month or so, dry and flaky skin often follows the rash. Thick fragrance-free creams work better than lotions.',
        needs: ['ceramide', 'occlusive'],
      },
    ],
  },
  immuno: {
    label: 'Immunotherapy',
    noun: 'immunotherapy',
    hint: 'e.g. checkpoint inhibitors',
    expect: [
      {
        id: 'immuno_rash',
        title: 'Rash or itching',
        weeks: [0, null],
        band: [1, null],
        short: 'Rash or itch (any time)',
        concern: 'redness',
        body: 'Immunotherapy can cause a rash or itching at any point, even months in. It is usually mild, but your team needs to hear about it because it can be an immune-related side effect.',
        careTeam: 'Report any new rash or itching to your care team, even if it seems minor.',
        needs: ['soothing', 'humectant'],
        callIf: 'worse',
      },
    ],
  },
  hormone: {
    label: 'Hormone therapy',
    noun: 'hormone therapy',
    hint: 'e.g. tamoxifen, aromatase inhibitors, ADT',
    expect: [
      {
        id: 'hormone_dry',
        title: 'Drier, thinner-feeling skin',
        weeks: [2, null],
        band: [3, null],
        short: 'Drier skin',
        concern: 'moisture',
        body: 'Lower hormone levels can make skin drier and less elastic over time. A richer cream and a gentle cleanser help.',
        needs: ['ceramide', 'humectant'],
      },
    ],
  },
};

export const TREATMENT_KEYS = Object.keys(TREATMENTS);

// Caution that applies to everyone in treatment: skin is more reactive.
export const BASELINE_CAUTION = ['fragrance', 'essential_oil', 'drying_alcohol', 'scrub', 'harsh_surfactant'];
export const BASELINE_AVOID_UNLESS_OK = ['retinoid', 'aha', 'bha', 'benzoyl_peroxide'];

export const RED_FLAGS = [
  'Skin that blisters, peels in sheets, opens up or weeps',
  'A rash that is painful, spreading fast, or covers a large area',
  'Signs of infection: warmth, swelling, pus, or a fever',
  'Any rash together with mouth sores, eye soreness or feeling unwell',
];

const DAY = 24 * 60 * 60 * 1000;

/** Treatment phase relative to the start date: { phase: 'before'|'during', week, daysUntil }. */
export function treatmentPhase(startDate, now = new Date()) {
  if (!startDate) return { phase: 'unknown', week: null, daysUntil: null };
  const start = new Date(`${startDate}T00:00:00`);
  const days = Math.floor((startOfDay(now) - start) / DAY);
  if (days < 0) return { phase: 'before', week: 0, daysUntil: -days };
  return { phase: 'during', week: Math.floor(days / 7) + 1, daysUntil: 0 };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Expectations relevant now or within the next week, across the person's treatments. */
export function expectationsFor(treatments = [], startDate, now = new Date()) {
  const { phase, week } = treatmentPhase(startDate, now);
  const current = phase === 'before' ? 0 : week ?? 0;
  const items = [];
  for (const key of treatments) {
    const t = TREATMENTS[key];
    if (!t) continue;
    for (const e of t.expect) {
      const [from, to] = e.weeks;
      const active = current >= from && (to === null || current <= to);
      const soon = !active && current < from && from - current <= 1;
      if (active || soon || phase === 'before') {
        items.push({ ...e, treatment: key, treatmentLabel: t.label, timing: active ? 'now' : soon ? 'soon' : 'later' });
      }
    }
  }
  const order = { now: 0, soon: 1, later: 2 };
  return items.sort((a, b) => order[a.timing] - order[b.timing]);
}
