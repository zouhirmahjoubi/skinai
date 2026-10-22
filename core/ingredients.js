// Reads a product's INCI ingredient list and judges it against what this
// person's skin and treatment need. Any retailer catalog with ingredient
// lists can be plugged in; nothing is hand-labelled per product.

import { BASELINE_CAUTION, BASELINE_AVOID_UNLESS_OK, TREATMENTS } from './treatments.js';

export const CLASSES = {
  // Things that commonly irritate skin during treatment.
  fragrance: { label: 'Fragrance', kind: 'irritant', match: [/^(parfum|fragrance|aroma)\b/] },
  essential_oil: {
    label: 'Essential oils / fragrance allergens',
    kind: 'irritant',
    match: [/^(limonene|linalool|citral|geraniol|eugenol|citronellol|coumarin|menthol|camphor)$/, /(lavandula|lavender|melaleuca|tea tree|eucalyptus|mentha|peppermint|rosmarinus|citrus .*(peel )?oil|bergamia)/],
  },
  drying_alcohol: { label: 'Drying alcohol', kind: 'irritant', match: [/^alcohol( denat\.?)?$/, /^(sd alcohol|isopropyl alcohol|ethanol|denatured alcohol)/] },
  scrub: { label: 'Physical scrub particles', kind: 'irritant', match: [/(walnut|juglans regia shell|apricot|prunus armeniaca seed|pumice|polyethylene beads?)/] },
  harsh_surfactant: { label: 'Harsh cleanser (SLS)', kind: 'irritant', match: [/^sodium lauryl sulfate$/] },
  // Actives that are fine for many people but risky on treatment-sensitised skin.
  retinoid: { label: 'Retinoid', kind: 'active', match: [/(retinol|retinal|retinaldehyde|retinyl|tretinoin|adapalene|hydroxypinacolone retinoate)/] },
  aha: { label: 'Exfoliating acid (AHA)', kind: 'active', match: [/^(glycolic|lactic|mandelic|malic|tartaric) acid$/] },
  bha: { label: 'Salicylic acid (BHA)', kind: 'active', match: [/^(salicylic acid|betaine salicylate)$/, /salix (alba|nigra) bark/] },
  benzoyl_peroxide: { label: 'Benzoyl peroxide', kind: 'active', match: [/benzoyl peroxide/] },
  // Things that help.
  ceramide: { label: 'Ceramides', kind: 'helpful', match: [/^ceramide/] },
  humectant: { label: 'Hydrators', kind: 'helpful', match: [/^(glycerin|sodium hyaluronate|hyaluronic acid|panthenol|urea|betaine)$/] },
  occlusive: { label: 'Barrier-sealing', kind: 'helpful', match: [/^(petrolatum|dimethicone|squalane)$/, /(butyrospermum parkii|shea butter)/] },
  soothing: { label: 'Soothing', kind: 'helpful', match: [/(avena sativa|colloidal oatmeal|allantoin|bisabolol|centella asiatica|madecassoside|panthenol)/] },
  mineral_spf: { label: 'Mineral sunscreen', kind: 'helpful', match: [/^(zinc oxide|titanium dioxide)/] },
};

/** Splits an INCI string into normalised ingredient names. */
export function parseInci(text = '') {
  return String(text)
    .replace(/\[[^\]]*\]/g, '')
    .split(/,(?![^(]*\))/)
    .map((s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[*.]+$/, '').trim())
    .map((s) => s.replace(/^\d+(\.\d+)?%\s*/, ''))
    .filter(Boolean);
}

/** Returns { classKey: [matching ingredient names] }. */
export function classify(ingredients) {
  const found = {};
  for (const name of ingredients) {
    for (const [key, cls] of Object.entries(CLASSES)) {
      if (cls.match.some((re) => re.test(name))) (found[key] ||= []).push(name);
    }
  }
  return found;
}

const AVOID_REASON = {
  benzoyl_peroxide: 'Acne treatment: can worsen an EGFR-inhibitor rash',
  bha: 'Exfoliating acid: can sting and worsen treatment rashes',
  aha: 'Exfoliating acid: too harsh for treatment-sensitised skin',
  retinoid: 'Retinoid: irritating while skin is reactive',
  scrub: 'Scrub particles: can damage fragile skin',
  drying_alcohol: 'Drying alcohol: strips an already dry barrier',
  fragrance: 'Fragrance: a common irritant on sensitive skin',
  essential_oil: 'Essential oils: common irritants and allergens',
  harsh_surfactant: 'Harsh cleanser: strips the skin barrier',
};

/**
 * Builds the rules for one person: what to avoid outright, what to treat with
 * caution, and which helpful ingredient groups to prioritise.
 */
export function shelfContext(profile, notes = []) {
  const avoid = new Set();
  const caution = new Set(BASELINE_CAUTION);
  const needs = new Set(['humectant']);
  const inTreatment = (profile?.treatments || []).length > 0;
  if (inTreatment) BASELINE_AVOID_UNLESS_OK.forEach((c) => caution.add(c));
  for (const key of profile?.treatments || []) {
    for (const e of TREATMENTS[key]?.expect || []) (e.needs || []).forEach((n) => needs.add(n));
  }
  for (const n of notes) {
    (n.avoid || []).forEach((c) => avoid.add(c));
    (n.needs || []).forEach((c) => needs.add(c));
  }
  for (const c of avoid) caution.delete(c);
  // Fragrance is a hard avoid whenever there is an active skin reaction.
  if (notes.some((n) => n.level === 'call' || n.level === 'watch')) {
    ['fragrance', 'essential_oil'].forEach((c) => {
      avoid.add(c);
      caution.delete(c);
    });
  }
  return { avoid: [...avoid], caution: [...caution], needs: [...needs] };
}

/** SPF stated on the label (product.spf field or "SPF 30" in the name); 0 if none. */
export function labelledSpf(product) {
  const m = /\bspf\s*(\d+)/i.exec(product?.name || '');
  return Number(product?.spf) || (m ? Number(m[1]) : 0);
}

/** Judges one product: verdict "avoid" | "caution" | "good", with human-readable reasons. */
export function evaluateProduct(product, ctx) {
  const found = classify(parseInci(product.ingredients));
  // Zinc oxide and titanium dioxide are also pigments and skin protectants;
  // only a product tested and labelled SPF 30+ counts as sunscreen.
  if (found.mineral_spf && labelledSpf(product) < 30) delete found.mineral_spf;
  const reasons = [];
  let verdict = 'good';
  for (const c of ctx.avoid) {
    if (found[c]) {
      verdict = 'avoid';
      reasons.push({ type: 'avoid', cls: c, text: AVOID_REASON[c] || CLASSES[c].label, matches: found[c] });
    }
  }
  for (const c of ctx.caution) {
    if (found[c]) {
      if (verdict === 'good') verdict = 'caution';
      reasons.push({ type: 'caution', cls: c, text: AVOID_REASON[c] || CLASSES[c].label, matches: found[c] });
    }
  }
  const helps = ctx.needs.filter((c) => found[c]);
  for (const c of helps) reasons.push({ type: 'good', cls: c, text: CLASSES[c].label, matches: found[c] });
  const score = (verdict === 'good' ? 100 : verdict === 'caution' ? 40 : 0) + helps.length * 10;
  return { verdict, reasons, score, found };
}

/** Ranks a catalog for this person, best first; "avoid" products sink to the bottom. */
export function rankShelf(catalog, ctx) {
  return catalog
    .map((p) => ({ product: p, ...evaluateProduct(p, ctx) }))
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price);
}
