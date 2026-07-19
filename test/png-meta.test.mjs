// Roundtrip test for the SDK's PNG chunk I/O: embed metadata, read it back
// with the SDK, and cross-check with the independent parser in
// tools/extract-metadata.mjs.
//   npm test
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { isPng, embedMetadata, readMetadata } from '../sdk/png-meta.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const src = new Uint8Array(readFileSync(join(ROOT, 'icons/icon48.png')));
assert(isPng(src), 'source is a PNG');

const metadata = {
  page: { url: 'https://example.com/checkout?step=2' },
  elements: [{ selector: '#pay-button', text: 'Pay now — unicode ✓ émojis 🐢' }]
};
const json = JSON.stringify(metadata, null, 2);

const stamped = embedMetadata(src, 'bowser-snaps', json);
assert(isPng(stamped), 'stamped output is still a PNG');
assert.strictEqual(readMetadata(stamped, 'bowser-snaps'), json, 'readMetadata roundtrip');
assert.strictEqual(readMetadata(stamped, 'other-keyword'), null, 'unknown keyword returns null');

const out = join(mkdtempSync(join(tmpdir(), 'bs-test-')), 'stamped.png');
writeFileSync(out, stamped);
const extracted = execFileSync('node', [join(ROOT, 'tools/extract-metadata.mjs'), out], { encoding: 'utf8' });
assert.deepStrictEqual(JSON.parse(extracted), metadata, 'independent extractor roundtrip');

const tail = stamped.subarray(stamped.length - 12);
assert.strictEqual(String.fromCharCode(...tail.subarray(4, 8)), 'IEND', 'IEND still last');

// The published schema must stay valid JSON and pin the current version.
const schema = JSON.parse(readFileSync(join(ROOT, 'schema/bowser-snaps.schema.json'), 'utf8'));
assert.strictEqual(schema.properties.format.const, 'bowser-snaps', 'schema format constant');
assert.strictEqual(schema.properties.schemaVersion.const, 2, 'schema version constant');
assert.ok(schema.required.includes('report'), 'schema requires report');

console.log('png-meta roundtrip + schema: all assertions passed');
