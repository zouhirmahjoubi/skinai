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

/**
 * Builds the makeup-vto effects for a brow preview. Smoothing is forced to 0 so
 * the face is not airbrushed. pattern.thickness is an offset from the brow
 * detected in the photo being rendered (-100..100), so 0 keeps the person's own.
 */
export function browEffects({ pattern = 'Original2', color = '#5a4636', intensity = 60, thickness = 0, curvature = 0 } = {}) {
  const c = typeof color === 'string' ? color.trim() : '';
  const hex = /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith('#') ? c : `#${c}`) : '#5a4636';
  const name = typeof pattern === 'string' && /^[A-Za-z0-9&_-]{1,40}$/.test(pattern) ? pattern : 'Original2';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  return [
    { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
    {
      category: 'eyebrows',
      pattern: { type: 'shape', name, thickness: clamp(thickness, -100, 100), curvature: clamp(curvature, -100, 100), definition: 40 },
      palettes: [{ color: hex, colorIntensity: clamp(intensity, 0, 100), texture: 'matte' }],
    },
  ];
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
  return {
    faceShape: pick(faceRaw),
    browShape: pick(brow.left_shape) || pick(brow.right_shape) || null,
    browThickness: pick(brow.left_body_thickness) || pick(brow.right_body_thickness) || null,
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
