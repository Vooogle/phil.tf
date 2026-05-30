// Minimal animated GIF encoder - grayscale only, 256-color palette

function lzwEncode(pixels) {
  const minCode = 8;
  const clearCode = 256, eoi = 257;
  let codeSize = 9, nextCode = 258;
  const table = new Map();
  const bytes = [];
  let bitBuf = 0, bitLen = 0;

  function emit(code) {
    bitBuf |= (code << bitLen);
    bitLen += codeSize;
    while (bitLen >= 8) {
      bytes.push(bitBuf & 0xFF);
      bitBuf >>>= 8;
      bitLen -= 8;
    }
  }

  function reset() {
    table.clear();
    codeSize = 9;
    nextCode = 258;
    emit(clearCode);
  }

  reset();
  let prefix = pixels[0];

  for (let i = 1; i < pixels.length; i++) {
    const px = pixels[i];
    const key = (prefix << 8) | px;
    if (table.has(key)) {
      prefix = table.get(key);
    } else {
      emit(prefix);
      if (nextCode < 4096) {
        if (nextCode === (1 << codeSize)) codeSize++;
        table.set(key, nextCode++);
      } else {
        reset();
      }
      prefix = px;
    }
  }

  emit(prefix);
  emit(eoi);
  if (bitLen > 0) bytes.push(bitBuf & 0xFF);

  // Pack into sub-blocks (max 255 bytes each)
  const out = [minCode];
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(bytes[i + j]);
  }
  out.push(0);
  return new Uint8Array(out);
}

export function encodeAnimatedGif(frames, fps) {
  if (!frames.length) return null;
  const w = frames[0].width, h = frames[0].height;
  const delay = Math.max(2, Math.round(100 / fps));
  const enc = new TextEncoder();
  const parts = [];

  // Header + Logical Screen Descriptor
  parts.push(enc.encode('GIF89a'));
  parts.push(new Uint8Array([
    w & 0xFF, w >> 8, h & 0xFF, h >> 8,
    0xF7,   // global color table flag + size (256 colors)
    0x00, 0x00,
  ]));

  // Global Color Table: 256 grayscale entries
  const gct = new Uint8Array(768);
  for (let i = 0; i < 256; i++) gct[i * 3] = gct[i * 3 + 1] = gct[i * 3 + 2] = i;
  parts.push(gct);

  // Netscape looping extension (infinite)
  parts.push(new Uint8Array([
    0x21, 0xFF, 0x0B,
    ...enc.encode('NETSCAPE2.0'),
    0x03, 0x01, 0x00, 0x00, 0x00,
  ]));

  for (const frame of frames) {
    // Graphic Control Extension
    parts.push(new Uint8Array([
      0x21, 0xF9, 0x04, 0x00,
      delay & 0xFF, delay >> 8,
      0x00, 0x00,
    ]));

    // Image Descriptor
    parts.push(new Uint8Array([
      0x2C,
      0x00, 0x00, 0x00, 0x00,   // left=0, top=0
      w & 0xFF, w >> 8, h & 0xFF, h >> 8,
      0x00,   // no local color table
    ]));

    // Pixel data → grayscale indices
    const pixels = new Uint8Array(w * h);
    const d = frame.data;
    for (let i = 0; i < pixels.length; i++) pixels[i] = d[i * 4];

    parts.push(lzwEncode(pixels));
  }

  parts.push(new Uint8Array([0x3B])); // trailer
  return new Blob(parts, { type: 'image/gif' });
}
