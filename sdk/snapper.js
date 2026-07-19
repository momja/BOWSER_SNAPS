// High-level API for web apps: selection UI → metadata collection → capture →
// crop → metadata embedding, with the pixel source supplied by the host.
// No extension APIs — the Chrome extension uses the lower-level pieces
// directly because its capture happens in a different process (the service
// worker); everyone else can use createSnapper.

import { selectRegion } from './selection-overlay.js';
import { collectRegionMetadata } from './collect.js';
import { buildPageContext } from './page-context.js';
import { deviceRect, cropToPng } from './crop.js';
import { embedMetadata } from './png-meta.js';
import { promptBugReport } from './report-dialog.js';
import { FORMAT, SCHEMA_VERSION, METADATA_KEYWORD } from './schema.js';

export { METADATA_KEYWORD };

/**
 * @param {object} options
 * @param {(ctx: {rect, viewport}) => Promise<ImageBitmap|Blob|HTMLCanvasElement|HTMLVideoElement>} options.capture
 *   Returns pixels covering the current viewport (any createImageBitmap
 *   source). The SDK crops the selection out of it. See
 *   captureViaDisplayMedia for a built-in browser-only source.
 * @param {{snapshot: () => object[]}} [options.errorMonitor]
 *   A createErrorMonitor() instance whose buffer is included in metadata.
 * @param {string} [options.keyword] PNG iTXt keyword to embed under.
 * @param {object} [options.tool] Identifies the producing app in metadata.
 * @param {(rect) => object|Promise<object>} [options.collect]
 *   Override metadata collection (default: collectRegionMetadata).
 * @param {boolean} [options.promptReport]
 *   Show the bug-report dialog after capture (default true). The pixels are
 *   captured before the dialog opens, so it never appears in the screenshot.
 */
export function createSnapper({
  capture,
  errorMonitor = null,
  keyword = METADATA_KEYWORD,
  tool = { name: 'bowser-snaps-sdk', version: '1.1.0' },
  collect = collectRegionMetadata,
  promptReport = true
} = {}) {
  if (typeof capture !== 'function') {
    throw new TypeError('createSnapper requires a capture({rect, viewport}) function returning viewport pixels');
  }

  return {
    /**
     * Run one interactive snap. Resolves null if the user cancels, else
     * { bytes, blob, metadata, suggestedFilename } where bytes/blob are the
     * cropped PNG with metadata embedded.
     */
    async snap() {
      const rect = await selectRegion();
      if (!rect) return null;

      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const collected = await collect(rect);
      const source = await capture({ rect, viewport });
      const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);

      const dr = deviceRect(rect, viewport, bitmap.width, bitmap.height);
      const png = await cropToPng(bitmap, dr);

      // Pixels are frozen; now ask for the human half of the bug report.
      let report = { description: null };
      if (promptReport) {
        const previewUrl = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        let outcome;
        try {
          outcome = await promptBugReport({ thumbnailUrl: previewUrl });
        } finally {
          URL.revokeObjectURL(previewUrl);
        }
        if (outcome.action === 'discard') return null;
        if (outcome.action === 'save') report = { description: outcome.description };
      }

      const capturedAt = new Date().toISOString();
      const metadata = {
        format: FORMAT,
        schemaVersion: SCHEMA_VERSION,
        tool,
        capturedAt,
        report,
        image: {
          width: dr.sw,
          height: dr.sh,
          scale: Math.round(dr.scale * 100) / 100,
          note: 'element/selection coords are CSS px; multiply by `scale` for image px'
        },
        page: buildPageContext(),
        selection: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: 'css-px, viewport-relative',
          pagePosition: {
            x: Math.round(rect.x + window.scrollX),
            y: Math.round(rect.y + window.scrollY)
          }
        },
        frameworks: collected.frameworks || [],
        elements: collected.elements || [],
        domSnippet: collected.domSnippet || null,
        consoleErrors: errorMonitor ? errorMonitor.snapshot() : []
      };

      const bytes = embedMetadata(png, keyword, JSON.stringify(metadata, null, 2));
      return {
        bytes,
        blob: new Blob([bytes], { type: 'image/png' }),
        metadata,
        suggestedFilename: `snap-${capturedAt.replace(/[:.]/g, '-')}.png`
      };
    }
  };
}

/**
 * Browser-only capture source using getDisplayMedia. Chrome shows a share
 * picker (preferCurrentTab pre-selects the current tab); one frame is
 * grabbed and the stream stops immediately. Suitable as createSnapper's
 * `capture` when no privileged screenshot API is available.
 */
export async function captureViaDisplayMedia() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include'
  });
  const video = document.createElement('video');
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    video.srcObject = null;
    for (const track of stream.getTracks()) track.stop();
  }
}

/** Trigger a browser download of a snap() result. */
export function downloadSnap(snap, filename = snap.suggestedFilename) {
  const url = URL.createObjectURL(snap.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
