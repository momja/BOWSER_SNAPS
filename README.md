# Bowser Snaps 🐢📸

Region screenshots — as easy as macOS <kbd>⌘⇧4</kbd> — that **embed rich DOM & component metadata directly into the PNG**. Built for filing bugs that an LLM (or a teammate) can actually investigate: one file carries the pixels *and* the context.

Two deliverables in this repo:

- **[`sdk/`](sdk/)** — a pure-ESM, zero-dependency, Chrome-API-free library (selection overlay, metadata collection, error monitor, cropping, PNG chunk I/O, and a high-level `createSnapper`). Embed it in any web app: `npm install github:momja/bowser_snaps` → `import { createSnapper } from 'bowser-snaps'`. See [sdk/README.md](sdk/README.md).
- **[`extension/`](extension/)** — a thin Chrome MV3 extension built on the SDK, adding what only extensions can do: a global keyboard shortcut, `captureVisibleTab` (no share-picker prompt), works on any site without integration, and a popup with capture history. Built into `dist/` by `npm run build`.

## What gets captured

Alongside the cropped screenshot, Bowser Snaps collects and embeds:

| Data | Why an LLM cares |
| --- | --- |
| **Your bug description** — a dialog after each capture lets you say what's wrong (markdown welcome), stored verbatim in the metadata | The intent: what's broken and what was expected |
| **URL, path, query, hash, title** | Locates the route/page in the codebase |
| **Elements in the selection** — tag, `id`, classes, CSS selector, text, `data-*` / `aria-*` / semantic attributes, position within the screenshot | Maps pixels to source code |
| **Component names** — React (fiber owner chain), Vue 2/3, Angular | Jumps straight to the component file |
| **Frameworks detected** — react, next.js, vue, nuxt, angular (+version), svelte, jQuery, ember | Sets expectations about project structure |
| **Console errors & warnings** (rolling buffer of the last 30, hooked at `document_start`) | Often *is* the bug |
| **Sanitized DOM snippet** of the region's container | Ground-truth markup at capture time |
| **Viewport, device pixel ratio, scroll position, document size, user agent** | Reproduces the environment |

Everything is stored as pretty-printed JSON in a PNG `iTXt` chunk keyed `bowser-snaps` — lossless, spec-compliant, and survives any tool that preserves ancillary chunks.

## Install the extension

1. Clone this repo. `dist/` is committed, so no build is needed — but if you've changed sources, run `npm install && npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` directory.

Requires Chrome 111+.

## Use

1. Press <kbd>⌘⇧S</kbd> (mac) / <kbd>Ctrl+Shift+S</kbd>, or click the toolbar icon → **Snap this page**.
   (Browsers can't intercept the OS-level <kbd>⌘⇧4</kbd>; rebind the shortcut to your liking at `chrome://extensions/shortcuts`.)
2. Drag over the buggy region. <kbd>Esc</kbd> cancels.
3. Describe the bug in the dialog that appears (markdown welcome) — <kbd>⌘/Ctrl+Enter</kbd> or **Save snap** to save, **Skip note** to save without a description, <kbd>Esc</kbd> to discard. The pixels are captured *before* the dialog opens, so it's never in the shot and the page can't drift while you type.
4. The cropped PNG (metadata embedded) lands in `Downloads/bowser-snaps/` (configurable in the popup settings — see below).

The popup keeps your 10 most recent snaps with three one-click outputs:

- **Copy bug report** — a ready-to-paste Markdown report (URL, environment, element table with selectors & component names, console errors, DOM snippet). Paste it into an issue or an LLM chat next to the screenshot.
- **Copy JSON** / **JSON ↓** — the raw metadata.
- A settings toggle to also auto-download a `.json` sidecar with every snap.
- A settings field to change the destination subfolder (default `bowser-snaps`; blank saves straight into `Downloads/`). Chrome extensions can only save inside the Downloads directory, so this is a relative path, not an arbitrary location on disk.

## Reading the metadata back

```sh
node tools/extract-metadata.mjs snap-2026-07-14T05-30-12-123Z.png
```

or with exiftool (the chunk is standard): `exiftool -b -PNG:all snap.png`.

**The JSON structure is a documented contract** — see [SCHEMA.md](SCHEMA.md) for the field-by-field integration guide and [`schema/bowser-snaps.schema.json`](schema/bowser-snaps.schema.json) for the machine-readable JSON Schema. Key off `format` + `schemaVersion` and ignore unknown fields.

Metadata shape (abridged):

```json
{
  "format": "bowser-snaps",
  "schemaVersion": 2,
  "tool": { "name": "bowser-snaps", "version": "1.1.0" },
  "capturedAt": "2026-07-14T05:40:05.123Z",
  "report": { "description": "Pay button **overlaps** the total.\nRepro: resize < 400px" },
  "image": { "width": 400, "height": 170, "scale": 1, "note": "…css px → image px…" },
  "page": { "url": "…", "path": "/checkout", "viewport": {…}, "devicePixelRatio": 2, "scroll": {…}, "userAgent": "…" },
  "selection": { "x": 30, "y": 60, "width": 400, "height": 170, "pagePosition": {…} },
  "frameworks": ["react", "next.js"],
  "elements": [
    {
      "selector": "#pay-button",
      "tag": "button",
      "id": "pay-button",
      "classes": ["btn", "btn-primary"],
      "component": { "framework": "react", "name": "PayButton", "ownerChain": ["PayButton", "CheckoutForm"] },
      "text": "Pay now",
      "attributes": { "type": "button", "aria-label": "Pay now" },
      "rectInScreenshot": { "x": 10, "y": 95, "width": 78, "height": 28 },
      "coverage": "fully-visible"
    }
  ],
  "domSnippet": "<section id=\"cart-summary\" …>…</section>",
  "consoleErrors": [
    { "type": "console.error", "message": "payment widget failed to load…", "at": "…" }
  ]
}
```

## How it works

All the reusable logic lives in [`sdk/`](sdk/) (see its README for the API); `extension/` is Chrome glue bundled into `dist/` by esbuild (MAIN-world content scripts can't load ESM on strict-CSP pages, hence the build step):

- `extension/content.js` (isolated world) runs the SDK's `selectRegion` overlay and reports the selected rect.
- `extension/page-agent.js` (MAIN world, `document_start`) runs the SDK's `createErrorMonitor` before app code loads and serves `collectRegionMetadata` requests — the MAIN world sees framework internals (React fibers, Vue instances) that isolated worlds can't. If the page agent isn't present (tab predates install), `content.js` falls back to isolated-world collection, minus component names.
- `extension/background.js` (MV3 service worker) captures the visible tab, crops via the SDK's `deviceRect`/`cropToPng` (scale derived from the actual bitmap, so browser zoom and retina both work), embeds the JSON with `embedMetadata`, downloads the file, and keeps history for the popup.

## Privacy

Everything stays local: no network requests, no analytics. Metadata goes only into the PNG you download (and optional sidecar/clipboard). Console-error hooks live only in the page and are read at capture time. Remember the embedded JSON can include on-screen text and the URL — treat snaps like the screenshots they are.

## Limitations

- Content inside cross-origin iframes is screenshotted but its DOM can't be inspected (only the `<iframe>` element itself is recorded).
- Chrome-internal pages (`chrome://`, the Web Store) can't be captured.
- The selection is viewport-bound (like ⌘⇧4 without the window-picking mode); scroll first, then snap.

## Development

```sh
npm install
npm run build                   # bundle extension/ + sdk/ → dist/
npm test                        # PNG chunk roundtrip vs the independent extractor
npm run test:e2e                # Playwright drives a real drag-capture in Chromium
                                # (needs xvfb; BS_CHROMIUM=<path> to pick the binary)
node tools/generate-icons.mjs   # regenerate icons/
node tools/extract-metadata.mjs <snap.png>
```

The E2E suite loads the built `dist/` extension into a real Chromium, drags out a selection, and asserts the stored metadata (elements, React component detection, console errors) and the PNG's embedded chunk end-to-end. Re-run `npm run build` and commit `dist/` when extension or SDK sources change.
