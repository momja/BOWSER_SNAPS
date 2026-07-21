# Bowser Snaps metadata schema

Every snap is a PNG whose `iTXt` chunk (keyword **`bowser-snaps`**) contains one JSON document; the optional `.json` sidecar and the popup's "Copy JSON" emit the identical document. This page is the integration contract. The machine-readable version is [`schema/bowser-snaps.schema.json`](schema/bowser-snaps.schema.json) (JSON Schema draft 2020-12).

## Getting the JSON out of a snap

```sh
node tools/extract-metadata.mjs snap.png          # standalone, no deps
exiftool -b -PNG:all snap.png                     # the chunk is standard PNG
```

```js
import { readMetadata, METADATA_KEYWORD } from 'bowser-snaps';   // browser or Node
const doc = JSON.parse(readMetadata(pngBytes, METADATA_KEYWORD));
```

## Versioning & compatibility

- Check `format === "bowser-snaps"` before parsing anything else.
- `schemaVersion` (currently **2**) bumps only on breaking changes. New *optional* fields may appear within a version — **ignore unknown fields**.
- v1 documents (the initial release) lack `format`, `schemaVersion`, and `report`; treat their absence as v1.

## Document structure

```jsonc
{
  "format": "bowser-snaps",            // constant discriminator
  "schemaVersion": 2,
  "tool": { "name": "bowser-snaps", "version": "1.1.0" },
  "capturedAt": "2026-07-19T18:03:12.412Z",   // ISO 8601, pixel-capture time

  // The human half of the bug report, from the post-capture dialog.
  // `description` is VERBATIM user input — may contain markdown, newlines,
  // quotes, any unicode. It is escaped by JSON serialization only; render it
  // as text or markdown, never as HTML, and treat it as untrusted input.
  // null ⇒ the user skipped the note.
  "report": { "description": "Pay button overlaps the total on narrow viewports.\n\n**Repro:** resize to <400px" },

  // Cropped screenshot geometry. Element/selection coords below are CSS px;
  // multiply by `scale` to get pixel coords inside the PNG.
  "image": { "width": 400, "height": 170, "scale": 2, "note": "…" },

  // Where and on what environment the snap was taken.
  "page": {
    "url": "https://shop.example/checkout?step=2#payment",
    "path": "/checkout",
    "query": "?step=2",                // null if none
    "hash": "#payment",                // null if none
    "title": "Checkout",
    "referrer": null,
    "viewport": { "width": 1440, "height": 900 },
    "devicePixelRatio": 2,
    "scroll": { "x": 0, "y": 340 },
    "documentSize": { "width": 1440, "height": 3200 },
    "userAgent": "Mozilla/5.0 …",
    "language": "en-US"
  },

  // The captured region, CSS px relative to the viewport; pagePosition adds
  // the scroll offset (document coordinates). `mode` says how it was chosen:
  // "region" = dragged rectangle, "element" = click-to-select (the region is
  // the clicked element's viewport-clamped bounds, and that element leads
  // `elements` with `target: true`). Older documents lack `mode` — treat its
  // absence as "region".
  "selection": { "x": 30, "y": 60, "width": 400, "height": 170,
                 "mode": "region",
                 "unit": "css-px, viewport-relative",
                 "pagePosition": { "x": 30, "y": 400 } },

  "frameworks": ["react", "next.js"],  // may include versions, e.g. "angular@17.0.3"

  // Elements inside the region, most specific (smallest) first, max 40.
  // Sourced from painted-element sampling + semantic elements (buttons,
  // inputs, headings, [data-testid], …) intersecting the region. In
  // click-to-select captures the clicked element is always first, marked
  // `"target": true` (the field is absent on every other element).
  "elements": [
    {
      "selector": "#pay-button",       // id-anchored when possible
      "tag": "button",
      "target": true,                  // only in element-mode captures, on the clicked element
      "id": "pay-button",              // present only if set
      "classes": ["btn", "btn-primary"],
      "component": {                   // present when framework internals visible
        "framework": "react",          // "react" | "vue" | "angular"
        "name": "PayButton",
        "ownerChain": ["PayButton", "CheckoutForm"]   // react only, innermost first
      },
      "text": "Pay now",               // own text, truncated to 140 chars
      "attributes": { "type": "button", "aria-label": "Pay now" },  // semantic + data-*/aria-*
      "rectInScreenshot": { "x": 10, "y": 95, "width": 78, "height": 28 },
      "coverage": "fully-visible"      // or "partially-visible"
    }
  ],

  // Sanitized outerHTML of the smallest container spanning the region — or
  // of the clicked element itself in element-mode captures (scripts/styles
  // stripped, long attributes truncated, ≤ ~4KB). null if it couldn't be
  // computed.
  "domSnippet": "<section id=\"cart-summary\" …>…</section>",

  // Console/error activity up to capture time (oldest first, max 30).
  "consoleErrors": [
    {
      "type": "console.error",         // console.error | console.warn |
                                       // uncaught-exception | unhandled-rejection
      "message": "payment widget failed to load",
      "at": "2026-07-19T18:02:58.101Z",
      "source": "https://…/widget.js", // uncaught-exception only
      "line": 91, "column": 12,        //   "
      "stack": "TypeError: …"          //   " (truncated)
    }
  ]
}
```

## Integration notes

- **Presence guarantees:** every field in the top-level `required` list of the JSON Schema is always present — `report` always exists (its `description` may be null), `domSnippet` may be null, arrays may be empty but are never absent.
- **Coordinates:** everything except `image.width/height` is CSS px. To highlight an element on the PNG: `element.rectInScreenshot × image.scale`.
- **`report.description` handling:** verbatim user input. Safe to embed in a JSON pipeline as-is (it's just a string field); when displaying, render as plain text or markdown — never inject as HTML.
- **Size bounds:** ≤40 elements, ≤30 console errors, ≤4KB DOM snippet, ≤5000-char description, attribute/text values truncated — a metadata document is typically 5–30KB.
- **Filenames:** `snap-<capturedAt with : and . replaced by ->.png`, e.g. `snap-2026-07-19T18-03-12-412Z.png`.
