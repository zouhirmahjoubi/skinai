// Reads type and pixel size straight from JPEG/PNG headers, so the server can
// reject unusable photos before spending YouCam units. No image library needed.

export function sniffImage(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return size ? { type: 'image/jpeg', ext: 'jpg', ...size } : null;
  }
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

// Walk JPEG segments until a start-of-frame marker, which carries the size.
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** Picks the skin-analysis tier a photo qualifies for (YouCam: SD >= 480px, HD >= 1080px short side). */
export function skinTierFor({ width, height }) {
  const short = Math.min(width, height);
  if (short >= 1080) return 'hd';
  if (short >= 480) return 'sd';
  return null;
}
