// "Hair & Brow Print": what someone's own hair and brows look like before
// treatment, captured so they can be matched or recreated later.

// The nine eyebrow shape families in YouCam's eyebrows.json pattern catalog.
export const BROW_PATTERNS = [
  { label: 'Original2', name: 'Natural' },
  { label: 'SoftArch1', name: 'Soft arch' },
  { label: 'HighArch1', name: 'High arch' },
  { label: 'Straight1', name: 'Straight' },
  { label: 'Curved1', name: 'Curved' },
  { label: 'Arrow1', name: 'Angled' },
  { label: 'Upward4', name: 'Lifted' },
  { label: 'Thin1', name: 'Fine' },
  { label: 'Drama2', name: 'Bold' },
];

// Face Attributes eyebrow shapes -> closest makeup-vto pattern.
const SHAPE_TO_PATTERN = {
  'hard angled': 'Arrow1',
  'soft angled': 'SoftArch1',
  straight: 'Straight1',
  rounded: 'Curved1',
};

export function browPatternFor(shape) {
  return SHAPE_TO_PATTERN[String(shape || '').toLowerCase()] || 'Original2';
}

// Three eyelash looks from YouCam's eyelashes.json catalog, softest first.
export const LASH_STYLES = [
  { label: 'Natural5', name: 'Soft' },
  { label: 'Natural3', name: 'Natural' },
  { label: 'Upper&Lower1', name: 'Fuller' },
];

// Lip shades offered next to the lip colour measured in the print.
export const LIP_SHADES = [
  { id: 'soft-rose', name: 'Soft rose', hex: '#c4807f' },
  { id: 'berry', name: 'Berry', hex: '#8e4357' },
];

const hexOr = (color, fallback) => {
  const c = typeof color === 'string' ? color.trim() : '';
  return /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith('#') ? c : `#${c}`) : fallback;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/**
 * Builds the makeup-vto effects for a brow preview. Smoothing is forced to 0 so
 * the face is not airbrushed. pattern.thickness is an offset from the brow
 * detected in the photo being rendered (-100..100), so 0 keeps the person's own.
 * Lashes, under-eye concealer and lip colour are optional extras in the same
 * call: makeup-vto costs 1 unit however many effects it applies.
 */
export function browEffects({ pattern = 'Original2', color = '#5a4636', intensity = 60, thickness = 0, curvature = 0, lashes, underEye, lips } = {}) {
  const name = typeof pattern === 'string' && /^[A-Za-z0-9&_-]{1,40}$/.test(pattern) ? pattern : 'Original2';
  const effects = [
    { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
    {
      category: 'eyebrows',
      pattern: { type: 'shape', name, thickness: clamp(thickness, -100, 100), curvature: clamp(curvature, -100, 100), definition: 40 },
      palettes: [{ color: hexOr(color, '#5a4636'), colorIntensity: clamp(intensity, 0, 100), texture: 'matte' }],
    },
  ];
  if (lashes && typeof lashes === 'object') {
    const style = LASH_STYLES.find((s) => s.label === lashes.style)?.label || 'Natural3';
    effects.push({ category: 'eyelashes', pattern: { name: style }, palettes: [{ color: hexOr(lashes.color, '#241a16'), colorIntensity: 70 }] });
  }
  // A light concealer in the person's own skin tone, weighted to the under-eye.
  if (underEye && typeof underEye === 'object') {
    effects.push({ category: 'concealer', palettes: [{ color: hexOr(underEye.color, '#c69c82'), colorIntensity: 35, colorUnderEyeIntensity: 60, coverageLevel: 45 }] });
  }
  // Satin needs no gloss or shimmer settings and reads as natural lip colour.
  if (lips && typeof lips === 'object') {
    effects.push({
      category: 'lip_color',
      shape: { name: 'original' },
      style: { type: 'full' },
      palettes: [{ color: hexOr(lips.color, '#b8676b'), texture: 'satin', colorIntensity: 55 }],
    });
  }
  return effects;
}

/**
 * Normalises face-attr-analysis results. The documented result parameters are
 * `faceshape`, `eyebrow.left_shape`/`right_shape` and
 * `eyebrow.left_body_thickness`/`right_body_thickness`; nesting varies, so we
 * search case-insensitively.
 */
export function normalizeFaceAttributes(results) {
  const faceRaw = findKey(results, 'faceshape');
  const brow = findKey(results, 'eyebrow') || {};
  const pick = (v) => (typeof v === 'string' ? v : v?.shape || v?.type || v?.value || null);
  // YouCam reports a brow it can't see as 'Obscured' (shape) or 'Unknown'
  // (thickness), per side: prefer the side it could read, and keep the
  // placeholder only when neither side was readable.
  const known = (v, placeholder) => {
    const s = pick(v);
    return s && s.toLowerCase() !== placeholder ? s : null;
  };
  const face = pick(faceRaw);
  return {
    faceShape: face && face.toLowerCase() !== 'unknown' ? face : null,
    browShape: known(brow.left_shape, 'obscured') || known(brow.right_shape, 'obscured') || pick(brow.left_shape) || pick(brow.right_shape) || null,
    browThickness: known(brow.left_body_thickness, 'unknown') || known(brow.right_body_thickness, 'unknown') || pick(brow.left_body_thickness) || pick(brow.right_body_thickness) || null,
  };
}

function findKey(obj, wanted, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === wanted) return v;
  }
  for (const v of Object.values(obj)) {
    const hit = findKey(v, wanted, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// Gentle, non-prescriptive wig cut notes by face shape (stylist conventions).
export const FACE_SHAPE_TIPS = {
  oval: 'Most cuts suit an oval face, so you can choose by comfort and how close it is to your own hair.',
  round: 'Styles with some height at the crown and length past the chin add balance.',
  square: 'Soft layers and side-swept fringes soften a strong jawline.',
  oblong: 'A fringe and volume at the sides keep a longer face in proportion.',
  heart: 'Chin-length or longer styles with fullness near the jaw balance a wider forehead.',
  diamond: 'Side-swept fringes and fullness at the jaw suit narrower foreheads and chins.',
  triangle: 'Volume at the crown and temples balances a wider jawline.',
  invtriangle: 'Chin-length or longer styles with fullness near the jaw balance a wider forehead.',
};
