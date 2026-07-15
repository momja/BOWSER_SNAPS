# Bowser Snaps SDK

Region screenshots with DOM & component metadata embedded in the PNG — as a **pure ESM library**: zero dependencies, zero Chrome extension APIs. Everything in this directory runs in any modern browser page; the Chrome extension in `../extension` is just one consumer.

## Install

From another project (e.g. [Exhibit](https://github.com/momja/Exhibit)):

```sh
npm install github:momja/bowser_snaps
```

```js
import { createSnapper, captureViaDisplayMedia, downloadSnap, createErrorMonitor } from 'bowser-snaps';
```

Or skip npm entirely — the SDK is dependency-free ESM, so you can vendor the `sdk/` folder or import it straight from a path.

## Quick start

```js
import {
  createSnapper,
  captureViaDisplayMedia,
  downloadSnap,
  createErrorMonitor
} from 'bowser-snaps';

// 1. (Optional, but do it at app boot) start buffering console errors so
//    they can ride along in snap metadata.
const errorMonitor = createErrorMonitor();

// 2. Create a snapper. You supply the pixels; the SDK does everything else
//    (selection UI, metadata collection, cropping, PNG embedding).
const snapper = createSnapper({
  capture: captureViaDisplayMedia,       // or your own pixel source, see below
  errorMonitor,
  tool: { name: 'exhibit', version: '1.0.0' }
});

// 3. Wire it to a button / hotkey.
document.getElementById('report-bug').addEventListener('click', async () => {
  const snap = await snapper.snap();     // user drags a region; null if cancelled
  if (!snap) return;

  downloadSnap(snap);                    // or upload snap.blob / snap.bytes
  console.log(snap.metadata);            // the same JSON that's inside the PNG
});
```

`snap()` resolves to `{ bytes, blob, metadata, suggestedFilename }` — a cropped PNG whose `iTXt` chunk (keyword `bowser-snaps`) contains the URL/path, viewport & scroll state, every element in the region (selectors, ids, classes, text, `data-*`/`aria-*` attributes, React/Vue/Angular component names when detectable), detected frameworks, a sanitized DOM snippet, and the buffered console errors.

### Bring your own pixels

`capture({ rect, viewport })` just has to return something `createImageBitmap` accepts (ImageBitmap, Blob, canvas, video…) covering the **current viewport**; the SDK crops the selection out and derives the CSS-px→image-px scale from the bitmap itself (so retina and browser zoom are handled).

- `captureViaDisplayMedia` (included): works on any page, but Chrome shows a share picker (`preferCurrentTab` pre-selects the tab). One frame is grabbed, then the stream stops.
- A library like `html-to-image`/`html2canvas` rendering `document.body`: no permission prompt, but it re-renders rather than photographs, so visual bugs can be lost — fine when the bug is layout/data, not paint.
- Server-side (Puppeteer/Playwright) or an extension API, if you have one: photograph the viewport, hand the PNG blob to `capture`.

### Reading metadata back

```js
import { readMetadata } from 'bowser-snaps';
const json = JSON.parse(readMetadata(pngBytes, 'bowser-snaps'));
```

Works in Node too (the PNG module has no DOM dependencies) — or use the standalone `tools/extract-metadata.mjs`, which parses the chunk independently.

## Lower-level building blocks

All exported from `bowser-snaps` (see `index.js`); each is usable on its own:

| Export | What it does |
| --- | --- |
| `selectRegion({ hintText? })` | macOS-style drag overlay; resolves `{x, y, width, height}` in CSS px, or `null` on cancel — after the overlay is gone and the page repainted |
| `showToast(text, { isError? })` | shadow-DOM toast used for capture feedback |
| `collectRegionMetadata(rect)` | `{ elements, frameworks, domSnippet }` for a viewport rect |
| `createErrorMonitor({ maxEntries? })` | console/error rolling buffer → `snapshot()` / `dispose()` |
| `buildPageContext()` | URL, viewport, scroll, DPR, user agent snapshot |
| `deviceRect`, `cropToPng`, `cropToJpegThumbnail` | map CSS-px rects onto a bitmap and cut them out (OffscreenCanvas; worker-safe) |
| `embedMetadata`, `readMetadata`, `toBase64`, `isPng`, `crc32` | PNG `iTXt` chunk I/O (browser, worker, and Node) |

## Notes & caveats

- **Component names** come from framework internals (React fibers, Vue instances, `window.ng`) on the DOM nodes. They're visible when the SDK runs in the same JavaScript world as the app — always true for a normal web app embedding this SDK. (Chrome extensions' isolated worlds can't see them; the extension in this repo works around that with a MAIN-world script.)
- Requires `OffscreenCanvas`, `createImageBitmap`, `CSS.escape` — Chrome/Edge 111+, Firefox 105+, Safari 16.4+.
- Cross-origin iframes: pixels are captured, but their DOM can't be inspected (only the `<iframe>` element itself is recorded).
- The embedded JSON can include on-screen text and URLs — treat snaps like the screenshots they are.
