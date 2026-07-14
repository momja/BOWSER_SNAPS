# Bowser Snaps 🐢📸

A Chrome extension for region screenshots — as easy as macOS <kbd>⌘⇧4</kbd> — that **embeds rich DOM & component metadata directly into the PNG**. Built for filing bugs that an LLM (or a teammate) can actually investigate: one file carries the pixels *and* the context.

## What gets captured

Alongside the cropped screenshot, Bowser Snaps collects and embeds:

| Data | Why an LLM cares |
| --- | --- |
| **URL, path, query, hash, title** | Locates the route/page in the codebase |
| **Elements in the selection** — tag, `id`, classes, CSS selector, text, `data-*` / `aria-*` / semantic attributes, position within the screenshot | Maps pixels to source code |
| **Component names** — React (fiber owner chain), Vue 2/3, Angular | Jumps straight to the component file |
| **Frameworks detected** — react, next.js, vue, nuxt, angular (+version), svelte, jQuery, ember | Sets expectations about project structure |
| **Console errors & warnings** (rolling buffer of the last 30, hooked at `document_start`) | Often *is* the bug |
| **Sanitized DOM snippet** of the region's container | Ground-truth markup at capture time |
| **Viewport, device pixel ratio, scroll position, document size, user agent** | Reproduces the environment |

Everything is stored as pretty-printed JSON in a PNG `iTXt` chunk keyed `bowser-snaps` — lossless, spec-compliant, and survives any tool that preserves ancillary chunks.

## Install

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and pick the repo root.

Requires Chrome 111+.

## Use

1. Press <kbd>⌘⇧S</kbd> (mac) / <kbd>Ctrl+Shift+S</kbd>, or click the toolbar icon → **Snap this page**.
   (Browsers can't intercept the OS-level <kbd>⌘⇧4</kbd>; rebind the shortcut to your liking at `chrome://extensions/shortcuts`.)
2. Drag over the buggy region. <kbd>Esc</kbd> cancels.
3. The cropped PNG (metadata embedded) lands in `Downloads/bowser-snaps/`.

The popup keeps your 10 most recent snaps with three one-click outputs:

- **Copy bug report** — a ready-to-paste Markdown report (URL, environment, element table with selectors & component names, console errors, DOM snippet). Paste it into an issue or an LLM chat next to the screenshot.
- **Copy JSON** / **JSON ↓** — the raw metadata.
- A settings toggle to also auto-download a `.json` sidecar with every snap.

## Reading the metadata back

```sh
node tools/extract-metadata.mjs snap-2026-07-14T05-30-12-123Z.png
```

or with exiftool (the chunk is standard): `exiftool -b -PNG:all snap.png`.

Metadata shape (abridged):

```json
{
  "tool": { "name": "bowser-snaps", "version": "1.0.0" },
  "capturedAt": "2026-07-14T05:40:05.123Z",
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

- `content.js` (isolated world) draws the crosshair drag overlay in a closed shadow root and reports the selected rect.
- `page-agent.js` + `collect.js` (MAIN world, `document_start`) hook `console.error`/`warn` and uncaught errors before app code runs, and harvest elements — grid-sampled `elementsFromPoint` stacks *plus* semantic/interactive elements intersecting the selection — with access to framework internals (React fibers, Vue instances) that isolated worlds can't see. If the page agent isn't present (tab predates install), `content.js` falls back to isolated-world collection, minus component names.
- `background.js` (MV3 service worker) captures the visible tab, crops via `OffscreenCanvas` (scale derived from the actual bitmap, so browser zoom and retina both work), embeds the JSON with `png-meta.js`, downloads the file, and keeps history for the popup.

## Privacy

Everything stays local: no network requests, no analytics. Metadata goes only into the PNG you download (and optional sidecar/clipboard). Console-error hooks live only in the page and are read at capture time. Remember the embedded JSON can include on-screen text and the URL — treat snaps like the screenshots they are.

## Limitations

- Content inside cross-origin iframes is screenshotted but its DOM can't be inspected (only the `<iframe>` element itself is recorded).
- Chrome-internal pages (`chrome://`, the Web Store) can't be captured.
- The selection is viewport-bound (like ⌘⇧4 without the window-picking mode); scroll first, then snap.

## Development

```sh
node tools/generate-icons.mjs   # regenerate icons/
node tools/extract-metadata.mjs <snap.png>
```

The E2E suite (Playwright driving a real Chromium with the extension loaded, asserting collected metadata and the embedded chunk end-to-end) lives in the session scratchpad; the PNG chunk writer is also covered by a Node roundtrip test against the independent extractor.
