// The YouCam features Ahead uses, in two interchangeable implementations:
// `live` calls the real API; `demo` returns clearly-flagged synthetic results
// so the app can be explored without an API key or spending units.

import crypto from 'node:crypto';
import { dstActionsFor, normalizeSkinResult, CONCERNS } from '../core/concerns.js';
import { browEffects, normalizeFaceAttributes, BROW_PATTERNS } from '../core/brows.js';
import { downloadAsDataUrl } from './youcam.js';

const EYEBROW_CATALOG_URL = 'https://plugins-media.makeupar.com/wcm-saas/patterns/eyebrows.json';
const TEMPLATE_TTL_MS = 6 * 60 * 60 * 1000;
// Hat VTO restyles outfit and background around the hat; "warm & cozy" suits
// the soft caps and beanies people wear during hair loss.
const HAT_STYLE = 'style_warm_cozy';

export function createLiveFeatures(client, { fetchImpl = fetch } = {}) {
  let templateCache = null;
  let browCache = null;
  const download = (url) => (url ? downloadAsDataUrl(url, fetchImpl).catch(() => null) : null);

  return {
    mode: 'live',

    async upload(buffer, info) {
      const fileId = await client.uploadImage(buffer, { contentType: info.type, fileName: `ahead.${info.ext}` });
      return { fileId };
    },

    async analyzeSkin({ fileId, tier }) {
      let taskId;
      let results;
      try {
        ({ taskId, results } = await client.runTaskWithId('skin-analysis', {
          src_file_id: fileId,
          dst_actions: dstActionsFor(tier),
          format: 'json',
          // Raw masks (PNG with alpha) let the app blend each concern itself.
          miniserver_args: { enable_mask_overlay: false },
        }));
      } catch (err) {
        if (err.taskId) await client.deleteTask(err.taskId).catch(() => {});
        throw err;
      }
      const norm = normalizeSkinResult(results);
      // Signed result links expire after ~2 hours, so fetch everything now.
      const keys = Object.keys(norm.scores);
      const [base, ...masks] = await Promise.all([download(norm.baseImageUrl), ...keys.map((k) => download(norm.scores[k].maskUrl))]);
      const scores = {};
      keys.forEach((k, i) => {
        const { maskUrl, ...rest } = norm.scores[k];
        scores[k] = { ...rest, mask: masks[i] };
      });
      // The check-in photo is never reused, so ask YouCam to delete the task,
      // its input photo and outputs now (best effort; otherwise they expire).
      const deleted = await client.deleteTask(taskId).then(() => true, () => false);
      return { tier, scores, overall: norm.overall, skinAge: norm.skinAge, baseImage: base, deleted };
    },

    // One selfie, two analyses in parallel: colours (hair, brows, skin) and
    // structure (face shape, brow shape and thickness).
    async print({ fileId }) {
      const [tone, face] = await Promise.allSettled([
        client.runTask('skin-tone-analysis', { src_file_id: fileId, face_angle_strictness_level: 'medium' }),
        client.runTask('face-attr-analysis', {
          src_file_id: fileId,
          features: ['faceShape', 'eyebrowShape', 'eyebrowThickness'],
          face_angle_strictness_level: 'medium',
        }),
      ]);
      if (tone.status === 'rejected' && face.status === 'rejected') {
        throw tone.reason?.billed ? tone.reason : face.reason?.billed ? face.reason : tone.reason;
      }
      return {
        colors: tone.status === 'fulfilled' ? tone.value?.color || null : null,
        face: face.status === 'fulfilled' ? normalizeFaceAttributes(face.value) : null,
        partial: tone.status === 'rejected' || face.status === 'rejected',
      };
    },

    // hair_color is only defined for templates (and only honoured by those
    // with keep_users_color); a reference photo always keeps its own colour.
    async hairTryOn({ fileId, templateId, refFileId, keepColor }) {
      const body = { src_file_id: fileId };
      if (templateId) {
        body.template_id = templateId;
        body.hair_color = keepColor ? 'src' : 'ref';
      } else body.ref_file_id = refFileId;
      const results = await client.runTask('hair-transfer', body);
      return { image: await downloadAsDataUrl(results.url, fetchImpl) };
    },

    async hatTryOn({ fileId, refFileId, gender }) {
      const results = await client.runTask('hat', { src_file_id: fileId, ref_file_id: refFileId, gender, style: HAT_STYLE });
      return { image: await downloadAsDataUrl(results.url, fetchImpl) };
    },

    async browTryOn({ fileId, ...opts }) {
      const results = await client.runTask('makeup-vto', { src_file_id: fileId, version: '1.0', effects: browEffects(opts) });
      return { image: await downloadAsDataUrl(results.url, fetchImpl) };
    },

    async hairTemplates() {
      if (templateCache && Date.now() - templateCache.at < TEMPLATE_TTL_MS) return templateCache.list;
      const raw = await client.listTemplates('hair-transfer');
      const list = raw.map((t) => ({
        id: t.id,
        title: t.title || t.id,
        thumb: t.thumb || null,
        category: t.category_name || '',
        keepsColor: Boolean(t.keep_users_color),
      }));
      templateCache = { at: Date.now(), list };
      return list;
    },

    async browPatterns() {
      if (browCache) return browCache;
      try {
        const res = await fetchImpl(EYEBROW_CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
        const rows = await res.json();
        const known = new Map(BROW_PATTERNS.map((p) => [p.label, p.name]));
        browCache = rows
          .filter((r) => r?.label)
          .map((r) => ({ label: r.label, name: known.get(r.label) || r.category || r.label, thumb: r.thumbnail || null }));
      } catch {
        browCache = BROW_PATTERNS.map((p) => ({ ...p, thumb: null }));
      }
      return browCache;
    },

    units: () => client.unitBalance(),
  };
}

// ---------------------------------------------------------------------------
// Demo mode. Scores are seeded from the photo bytes so a retake of the same
// photo is stable and a different photo differs. Try-ons echo the photo back.

const MAX_DEMO_FILES = 60;
// Keeps the in-memory demo store far below a small host's memory (e.g. 512 MB).
export const MAX_DEMO_BYTES = 96 * 1024 * 1024;

export function createDemoFeatures() {
  const files = new Map();
  let storedBytes = 0;
  const remember = (buffer, info) => {
    const id = `demo_${crypto.randomBytes(9).toString('base64url')}`;
    files.set(id, { buffer, info });
    storedBytes += buffer.length;
    // Evict oldest first, but never the photo just uploaded.
    while (files.size > 1 && (files.size > MAX_DEMO_FILES || storedBytes > MAX_DEMO_BYTES)) {
      const [oldId, old] = files.entries().next().value;
      files.delete(oldId);
      storedBytes -= old.buffer.length;
    }
    return id;
  };
  const asDataUrl = (fileId) => {
    const f = files.get(fileId);
    return f ? `data:${f.info.type};base64,${f.buffer.toString('base64')}` : null;
  };
  const seeded = (fileId) => {
    const f = files.get(fileId);
    const hash = crypto.createHash('sha256').update(f ? f.buffer : fileId).digest();
    let i = 0;
    return () => hash[i++ % hash.length] / 255;
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    mode: 'demo',
    storedBytes: () => storedBytes,
    async upload(buffer, info) {
      return { fileId: remember(buffer, info) };
    },
    async analyzeSkin({ fileId, tier }) {
      await pause(900);
      const rnd = seeded(fileId);
      const scores = {};
      for (const c of CONCERNS) {
        const raw = Math.round((58 + rnd() * 30) * 10) / 10;
        scores[c.key] = { raw, ui: Math.round(62 + (raw - 58) * 0.8), mask: null };
      }
      return { tier, scores, overall: null, skinAge: null, baseImage: null, demo: true };
    },
    async print() {
      await pause(700);
      return {
        colors: { skin_color: '#c69c82', hair_color: '#42280E', hair_color_name: 'Brown', eyebrow_color: '#3e2b22', eye_color: '#5b3a24', lip_color: '#b8676b' },
        face: { faceShape: 'Oval', browShape: 'Soft Angled', browThickness: 'Average' },
        partial: false,
        demo: true,
      };
    },
    async hairTryOn({ fileId }) {
      await pause(900);
      return { image: asDataUrl(fileId), demo: true };
    },
    async hatTryOn({ fileId }) {
      await pause(900);
      return { image: asDataUrl(fileId), demo: true };
    },
    async browTryOn({ fileId }) {
      await pause(700);
      return { image: asDataUrl(fileId), demo: true };
    },
    async hairTemplates() {
      return DEMO_TEMPLATES;
    },
    async browPatterns() {
      return BROW_PATTERNS.map((p) => ({ ...p, thumb: null }));
    },
    async units() {
      return null;
    },
  };
}

const DEMO_TEMPLATES = [
  { id: 'demo_pixie', title: 'Soft pixie', category: 'Short', keepsColor: true, thumb: null },
  { id: 'demo_bob', title: 'Chin-length bob', category: 'Medium', keepsColor: true, thumb: null },
  { id: 'demo_lob', title: 'Shoulder lob', category: 'Medium', keepsColor: true, thumb: null },
  { id: 'demo_layers', title: 'Long layers', category: 'Long', keepsColor: true, thumb: null },
  { id: 'demo_waves', title: 'Loose waves', category: 'Long', keepsColor: false, thumb: null },
  { id: 'demo_crop', title: 'Classic crop', category: 'Short', keepsColor: true, thumb: null },
];
