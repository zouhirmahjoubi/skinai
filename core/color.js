// Colour maths for matching measured colours (YouCam Facial Color Tones) to
// products, and for reading skin depth. sRGB (D65) -> CIELAB -> CIEDE2000.

export function hexToLab(hex) {
  if (typeof hex !== 'string' || !/^#?[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** CIEDE2000 colour difference between two Lab colours (kL = kC = kH = 1). */
export function deltaE2000Lab(x, y) {
  const C1 = Math.hypot(x.a, x.b);
  const C2 = Math.hypot(y.a, y.b);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1 = (1 + G) * x.a;
  const a2 = (1 + G) * y.a;
  const C1p = Math.hypot(a1, x.b);
  const C2p = Math.hypot(a2, y.b);
  const h = (a, b) => (a === 0 && b === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = h(a1, x.b);
  const h2 = h(a2, y.b);
  const dL = y.L - x.L;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lbar = (x.L + y.L) / 2;
  const Cbar = (C1p + C2p) / 2;
  let hbar = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) <= 180) hbar = (h1 + h2) / 2;
    else hbar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hbar - 30)) + 0.24 * Math.cos(rad(2 * hbar)) + 0.32 * Math.cos(rad(3 * hbar + 6)) - 0.2 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbar;
  const Sh = 1 + 0.015 * Cbar * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export function deltaE2000(hexA, hexB) {
  const a = hexToLab(hexA);
  const b = hexToLab(hexB);
  return a && b ? deltaE2000Lab(a, b) : null;
}

/** Items sorted by colour distance to `hex` (closest first), each as { item, dE }. */
export function closest(items, hex, key = 'hex') {
  if (!hexToLab(hex)) return items.map((item) => ({ item, dE: null }));
  return items.map((item) => ({ item, dE: deltaE2000(item[key], hex) })).sort((a, b) => a.dE - b.dE);
}

/**
 * Individual Typology Angle (degrees). Below about 10 covers the "brown" and
 * "dark" skin ranges, where redness is harder for any camera to see. Used only
 * to word alerts; never shown or stored as a label.
 */
export function ita(hex) {
  const lab = hexToLab(hex);
  return lab ? deg(Math.atan2(lab.L - 50, lab.b)) : null;
}
