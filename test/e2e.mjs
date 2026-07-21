// E2E: load the built extension (dist/) into Chromium, drive a real
// drag-capture on a test page (ids/classes/data-attrs, a console.error, and
// a synthetic React fiber), then assert the stored capture record and the
// downloaded PNG's embedded metadata. A second leg drives click-to-select:
// hover an element, ↑/↓ parent-child navigation, click, and asserts the
// element-mode selection and target marking.
//
//   npm run build && npm run test:e2e     (needs xvfb; see package.json)
//
// Set BS_CHROMIUM to your Chromium binary if Playwright's default isn't a
// full (extension-capable) build.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist');
const PORT = 8907;

const HTML = `<!doctype html>
<html><head><title>Bowser Snaps test page</title></head>
<body style="margin:0;font-family:sans-serif">
  <header id="site-header" class="app-header" style="height:40px;background:#eee">Header</header>
  <main class="checkout-page" style="padding:20px">
    <section id="cart-summary" class="cart summary-card" data-testid="cart-summary"
             style="width:400px;height:150px;background:#dbeafe;padding:10px">
      <h2 class="cart-title">Your cart</h2>
      <button id="pay-button" class="btn btn-primary" type="button" aria-label="Pay now">Pay now</button>
    </section>
  </main>
  <script>
    console.error('payment widget failed to load: TEST_SENTINEL');
    // Simulate a React-rendered button: React attaches fibers to DOM nodes
    // under a __reactFiber$<random> expando, only visible in the MAIN world.
    function PayButton() {}
    function CheckoutForm() {}
    document.getElementById('pay-button')['__reactFiber$e2e'] =
      { type: PayButton, return: { type: CheckoutForm, return: null } };
  </script>
</body></html>`;

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(HTML);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const userDataDir = mkdtempSync(join(tmpdir(), 'bs-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false, // extensions need a real (xvfb) browser
  executablePath: process.env.BS_CHROMIUM || undefined,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(500); // let content scripts settle

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await globalThis.__bowserSnapsStartCapture(tab);
  });
  await page.waitForTimeout(300);

  // Drag a region covering the cart card and pay button.
  await page.mouse.move(30, 60);
  await page.mouse.down();
  await page.mouse.move(430, 230, { steps: 8 });
  await page.mouse.up();

  // The report dialog opens (autofocused textarea in a closed shadow root —
  // unreachable by locators, so drive it purely via the keyboard). The
  // description deliberately mixes quotes, markdown, newlines, and
  // backslashes to prove JSON escaping survives the PNG roundtrip.
  const DESCRIPTION = 'Pay button says "Pay now" but **overlaps** the total.\nRepro: resize < 400px & click \\ backslash';
  await page.waitForTimeout(1000);
  await page.keyboard.type(DESCRIPTION);
  await page.keyboard.press('Control+Enter');

  // Wait for the pipeline: capture → crop → report → embed → download → storage.
  let captures = [];
  for (let i = 0; i < 40 && captures.length === 0; i++) {
    await page.waitForTimeout(250);
    ({ captures = [] } = await sw.evaluate(() => chrome.storage.local.get('captures')));
  }
  assert.strictEqual(captures.length, 1, 'one capture stored');

  const meta = captures[0].metadata;
  assert.strictEqual(meta.format, 'bowser-snaps', 'format discriminator present');
  assert.strictEqual(meta.schemaVersion, 2, 'schema version present');
  assert.strictEqual(meta.report.description, DESCRIPTION, 'bug description stored verbatim');
  assert.strictEqual(meta.page.url, `http://127.0.0.1:${PORT}/`, 'page url recorded');
  assert.strictEqual(meta.page.path, '/', 'path recorded');
  assert.strictEqual(meta.selection.mode, 'region', 'drag capture recorded as region mode');
  assert.ok(meta.selection.width >= 395 && meta.selection.width <= 405, `selection width ~400, got ${meta.selection.width}`);
  assert.ok(meta.image.width > 0 && meta.image.height > 0, 'image dimensions recorded');

  const selectors = meta.elements.map((e) => e.selector);
  assert.ok(selectors.includes('#pay-button'), `pay button collected: ${selectors.join(', ')}`);
  assert.ok(selectors.includes('#cart-summary'), `cart summary collected: ${selectors.join(', ')}`);
  const payButton = meta.elements.find((e) => e.selector === '#pay-button');
  assert.strictEqual(payButton.text, 'Pay now', 'button text captured');
  assert.strictEqual(payButton.attributes['aria-label'], 'Pay now', 'aria-label captured');
  assert.deepStrictEqual(payButton.classes, ['btn', 'btn-primary'], 'classes captured');
  assert.strictEqual(payButton.component?.framework, 'react', 'react fiber detected');
  assert.strictEqual(payButton.component?.name, 'PayButton', 'component name detected');
  assert.deepStrictEqual(payButton.component?.ownerChain, ['PayButton', 'CheckoutForm'], 'owner chain walked');
  assert.ok(meta.frameworks.includes('react'), `frameworks includes react: ${meta.frameworks}`);
  const cart = meta.elements.find((e) => e.selector === '#cart-summary');
  assert.strictEqual(cart.attributes['data-testid'], 'cart-summary', 'data-testid captured');

  assert.ok(
    meta.consoleErrors.some((e) => e.type === 'console.error' && e.message.includes('TEST_SENTINEL')),
    `console.error captured: ${JSON.stringify(meta.consoleErrors)}`
  );
  assert.ok(meta.domSnippet && meta.domSnippet.includes('pay-button'), 'DOM snippet includes region content');

  // Verify the downloaded PNG exists and carries the embedded metadata.
  // (Playwright reroutes downloads to its artifacts dir with opaque names,
  // so match on the originating extension rather than the filename.)
  let downloads = [];
  for (let i = 0; i < 40; i++) {
    downloads = await sw.evaluate(() => chrome.downloads.search({}));
    if (downloads.some((d) => d.state === 'complete' && d.byExtensionName === 'Bowser Snaps' && d.finalUrl.startsWith('data:image/png'))) break;
    await page.waitForTimeout(250);
  }
  const done = downloads.find((d) => d.state === 'complete' && d.byExtensionName === 'Bowser Snaps' && d.finalUrl.startsWith('data:image/png'));
  assert.ok(done, `png download completed: ${JSON.stringify(downloads.map((d) => ({ state: d.state, filename: d.filename })))}`);
  assert.ok(existsSync(done.filename), `downloaded file exists at ${done.filename}`);

  const extracted = JSON.parse(
    execFileSync('node', [join(ROOT, 'tools/extract-metadata.mjs'), done.filename], { encoding: 'utf8' })
  );
  assert.strictEqual(extracted.page.url, meta.page.url, 'embedded metadata matches');
  assert.strictEqual(extracted.report.description, DESCRIPTION, 'description survives PNG embed/extract with escaping intact');
  assert.ok(extracted.elements.some((e) => e.selector === '#pay-button'), 'embedded metadata has elements');

  // Sanity: PNG pixel size matches reported crop size.
  const png = readFileSync(done.filename);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.strictEqual(width, meta.image.width, 'png width matches');
  assert.strictEqual(height, meta.image.height, 'png height matches');

  // --- Leg 2: click-to-select an element (penpot-visual-fetch style) --------
  const btn = await page.evaluate(() => {
    const r = document.getElementById('pay-button').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  });

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await globalThis.__bowserSnapsStartCapture(tab);
  });
  await page.waitForTimeout(300);

  // Hover the button, walk up to the card and back down, then click it.
  await page.mouse.move(btn.x, btn.y);
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowUp');    // expand to #cart-summary
  await page.keyboard.press('ArrowDown');  // back to #pay-button
  await page.mouse.down();
  await page.mouse.up();

  await page.waitForTimeout(1000);            // report dialog opens
  await page.keyboard.press('Control+Enter'); // save without a note

  let captures2 = [];
  for (let i = 0; i < 40 && captures2.length < 2; i++) {
    await page.waitForTimeout(250);
    ({ captures: captures2 = [] } = await sw.evaluate(() => chrome.storage.local.get('captures')));
  }
  assert.strictEqual(captures2.length, 2, 'click-select capture stored');
  const clickMeta = captures2[0].metadata; // history is newest-first

  assert.strictEqual(clickMeta.selection.mode, 'element', 'element mode recorded');
  assert.ok(Math.abs(clickMeta.selection.width - btn.width) <= 2,
    `selection width matches button (${btn.width}), got ${clickMeta.selection.width}`);
  assert.ok(Math.abs(clickMeta.selection.height - btn.height) <= 2,
    `selection height matches button (${btn.height}), got ${clickMeta.selection.height}`);
  assert.strictEqual(clickMeta.elements[0].selector, '#pay-button', 'clicked element leads the element list');
  assert.strictEqual(clickMeta.elements[0].target, true, 'clicked element marked as target');
  assert.strictEqual(clickMeta.elements[0].component?.name, 'PayButton',
    'target resolved in the MAIN world (component visible)');
  assert.strictEqual(clickMeta.report.description, null, 'empty note stored as null');
  assert.ok(clickMeta.domSnippet && clickMeta.domSnippet.startsWith('<button'),
    `DOM snippet is the clicked element, got: ${String(clickMeta.domSnippet).slice(0, 60)}`);
  assert.ok(!clickMeta.elements.slice(1).some((e) => e.target), 'only the clicked element is marked target');

  console.log('E2E passed:');
  console.log(`  file: ${done.filename} (${width}×${height})`);
  console.log(`  elements: ${selectors.length} collected → ${selectors.slice(0, 6).join(', ')}…`);
  console.log(`  console errors: ${meta.consoleErrors.length}`);
  console.log(`  click-select: ${clickMeta.elements[0].selector} (${clickMeta.selection.width}×${clickMeta.selection.height}, mode=${clickMeta.selection.mode})`);
} finally {
  await context.close();
  server.close();
}
