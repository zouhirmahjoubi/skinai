// Photo preparation in the browser: framing crops, per-feature resizing,
// and a face-brightness reading used to warn about changed lighting.

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

const toBlob = (canvas, quality = 0.92) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/**
 * Crops a source (image or video frame) to a rectangle and scales it so the
 * long side is at most `maxLong`. Never upscales: resolution decides HD vs SD.
 */
export async function cropToJpeg(source, rect, { maxLong = 2560, mirror = false, quality = 0.92 } = {}) {
  const scale = Math.min(1, maxLong / Math.max(rect.w, rect.h));
  const c = canvasOf(rect.w * scale, rect.h * scale);
  const ctx = c.getContext('2d');
  if (mirror) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  const blob = await toBlob(c, quality);
  return { blob, width: c.width, height: c.height, dataUrl: await blobToDataUrl(blob) };
}

/**
 * Mean luminance (0-1) inside the central face oval. Compared week to week,
 * a big jump means the light changed, which can move scores on its own.
 */
export function faceBrightness(source, rect) {
  const w = 48;
  const h = Math.round((w * rect.h) / rect.w);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w * 0.36);
      const dy = (y - h * 0.46) / (h * 0.36);
      if (dx * dx + dy * dy > 1) continue;
      const i = (y * w + x) * 4;
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      n++;
    }
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : null;
}

export function lightLabel(b) {
  if (b === null || b === undefined) return { tone: 'neutral', text: 'Checking light' };
  if (b < 0.28) return { tone: 'warn', text: 'Too dark: face a window or lamp' };
  if (b > 0.82) return { tone: 'warn', text: 'Too bright: avoid direct sun or flash' };
  return { tone: 'ok', text: 'Light looks good' };
}
