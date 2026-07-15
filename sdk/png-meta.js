// PNG chunk utilities — embed a UTF-8 text payload as an iTXt chunk inserted
// just before IEND, and read it back. Pure ESM, zero dependencies, no browser
// or extension APIs; works in windows, workers, and Node 16+.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

export function isPng(bytes) {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function chunkTypeAt(bytes, offset) {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function findIendOffset(bytes) {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    if (chunkTypeAt(bytes, offset) === 'IEND') return offset;
    offset += 12 + readU32(bytes, offset);
  }
  throw new Error('PNG has no IEND chunk');
}

function buildITXt(keyword, text) {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword); // must be 1–79 Latin-1 chars
  if (keywordBytes.length < 1 || keywordBytes.length > 79) throw new Error('invalid iTXt keyword length');
  const textBytes = encoder.encode(text);
  // Layout: keyword \0 compressionFlag(0) compressionMethod(0) languageTag'' \0 translatedKeyword'' \0 text
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  data.set(keywordBytes, 0);
  data.set(textBytes, keywordBytes.length + 5);

  const chunk = new Uint8Array(12 + data.length);
  writeU32(chunk, 0, data.length);
  chunk.set([0x69, 0x54, 0x58, 0x74], 4); // 'iTXt'
  chunk.set(data, 8);
  writeU32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Return a copy of `pngBytes` with `text` embedded as an iTXt chunk under `keyword`. */
export function embedMetadata(pngBytes, keyword, text) {
  if (!isPng(pngBytes)) throw new Error('not a PNG');
  const chunk = buildITXt(keyword, text);
  const iend = findIendOffset(pngBytes);
  const out = new Uint8Array(pngBytes.length + chunk.length);
  out.set(pngBytes.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(pngBytes.subarray(iend), iend + chunk.length);
  return out;
}

/** Read back the text embedded under `keyword`, or null if absent. */
export function readMetadata(pngBytes, keyword) {
  if (!isPng(pngBytes)) throw new Error('not a PNG');
  const decoder = new TextDecoder();
  let offset = 8;
  while (offset + 8 <= pngBytes.length) {
    const length = readU32(pngBytes, offset);
    if (chunkTypeAt(pngBytes, offset) === 'iTXt') {
      const data = pngBytes.subarray(offset + 8, offset + 8 + length);
      const keywordEnd = data.indexOf(0);
      if (keywordEnd > 0 && decoder.decode(data.subarray(0, keywordEnd)) === keyword) {
        // Skip compression flag/method, then language tag and translated keyword.
        let p = keywordEnd + 3;
        p = data.indexOf(0, p) + 1;
        p = data.indexOf(0, p) + 1;
        return decoder.decode(data.subarray(p));
      }
    }
    offset += 12 + length;
  }
  return null;
}

export function toBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
