// Photos uploaded to YouCam, by key, so each one is uploaded once and reused
// until a task deletes it. Shared by Hair & brows and the companion.

import { api } from './api.js';

const fileIds = new Map();

export async function fileIdFor(key, dataUrl) {
  if (fileIds.has(key)) return fileIds.get(key);
  const blob = await (await fetch(dataUrl)).blob();
  const { fileId } = await api.upload(blob);
  fileIds.set(key, fileId);
  return fileId;
}

export const rememberFileId = (key, fileId) => fileIds.set(key, fileId);

// YouCam reports a file it has lost or never fully received as one of these.
const REUPLOAD = new Set(['InvalidFileId', 'unknown_internal_error', 'error_download_image']);

/**
 * Runs fn with a file id per photo ({ key, dataUrl, ref }). If YouCam lost a
 * file, every photo is uploaded again and fn runs once more: at most two
 * tasks per tap. A product photo (ref) that fails to upload is reported
 * against the product photo, never as a reason to retake the portrait.
 * The server deletes each live try-on task with its photos, and a failed one
 * too, so the ids are then forgotten and the next try-on uploads afresh.
 */
export async function withFiles(photos, fn) {
  const forget = () => photos.forEach((p) => fileIds.delete(p.key));
  const ids = () =>
    Promise.all(
      photos.map((p) =>
        fileIdFor(p.key, p.dataUrl).catch((err) => {
          if (p.ref && err.fix === 'photo') err.fix = 'ref';
          throw err;
        }),
      ),
    );
  const run = async () => {
    const out = await fn(...(await ids()));
    if (out?.deleted) forget();
    return out;
  };
  try {
    return await run();
  } catch (err) {
    forget();
    if (!REUPLOAD.has(err.code)) throw err;
    return run();
  }
}

/** Uploads a result image (a data URL) once, for a follow-up task such as a recolour. */
export async function withResult(key, dataUrl, fn) {
  return withFiles([{ key, dataUrl }], fn);
}
