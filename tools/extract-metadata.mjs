#!/usr/bin/env node
// Extracts the bug-report metadata that Bowser Snaps embeds in its PNGs.
// Intentionally independent of png-meta.js so it double-checks the format.
//
//   node tools/extract-metadata.mjs snap-2026-07-14T05-30-12-123Z.png
//
// Prints the embedded JSON to stdout (exit 1 if the file has none).
import { readFileSync } from 'node:fs';

const KEYWORD = 'bowser-snaps';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/extract-metadata.mjs <snap.png>');
  process.exit(2);
}

const bytes = readFileSync(file);
if (bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) {
  console.error(`${file}: not a PNG`);
  process.exit(1);
}

let offset = 8;
while (offset + 8 <= bytes.length) {
  const length = bytes.readUInt32BE(offset);
  const type = bytes.toString('ascii', offset + 4, offset + 8);
  if (type === 'iTXt') {
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const keywordEnd = data.indexOf(0);
    if (keywordEnd > 0 && data.toString('utf8', 0, keywordEnd) === KEYWORD) {
      // keyword \0 flag method languageTag \0 translatedKeyword \0 text
      let p = keywordEnd + 3;
      p = data.indexOf(0, p) + 1;
      p = data.indexOf(0, p) + 1;
      process.stdout.write(data.toString('utf8', p) + '\n');
      process.exit(0);
    }
  }
  offset += 12 + length;
}

console.error(`${file}: no "${KEYWORD}" metadata found`);
process.exit(1);
