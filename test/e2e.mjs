// E2E: load the built extension (dist/) into Chromium, drive a real
// drag-capture on a test page (ids/classes/data-attrs, a console.error, and
// a synthetic React fiber), then assert the stored capture record and the
// downloaded PNG's embedded metadata.
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

  // Wait for the pipeline: capture → crop → embed → download → storage.
  let captures = [];
  for (let i = 0; i < 40 && captures.length === 0; i++) {
    await page.waitForTimeout(250);
    ({ captures = [] } = await sw.evaluate(() => chrome.storage.local.get('captures')));
  }
  assert.strictEqual(captures.length, 1, 'one capture stored');

  const meta = captures[0].metadata;
  assert.strictEqual(meta.page.url, `http://127.0.0.1:${PORT}/`, 'page url recorded');
  assert.strictEqual(meta.page.path, '/', 'path recorded');
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
  assert.ok(extracted.elements.some((e) => e.selector === '#pay-button'), 'embedded metadata has elements');

  // Sanity: PNG pixel size matches reported crop size.
  const png = readFileSync(done.filename);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.strictEqual(width, meta.image.width, 'png width matches');
  assert.strictEqual(height, meta.image.height, 'png height matches');

  console.log('E2E passed:');
  console.log(`  file: ${done.filename} (${width}×${height})`);
  console.log(`  elements: ${selectors.length} collected → ${selectors.slice(0, 6).join(', ')}…`);
  console.log(`  console errors: ${meta.consoleErrors.length}`);
} finally {
  await context.close();
  server.close();
}
