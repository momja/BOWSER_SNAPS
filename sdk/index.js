// Bowser Snaps SDK — region screenshots with embedded DOM/component metadata.
// Pure ESM, zero dependencies, and no Chrome extension APIs: everything here
// runs in any modern browser page (Chrome 111+/equivalents; OffscreenCanvas
// and iTXt handling also work in workers and Node where noted per module).
//
// High level:
//   createSnapper({ capture })  — selection UI → metadata → crop → embed
//   captureViaDisplayMedia      — a capture source for unprivileged pages
//   downloadSnap                — save a snap() result
//
// Building blocks (used by the Chrome extension, reusable individually):
//   selectRegion / showToast    — drag-select overlay UI
//   collectRegionMetadata       — elements/components/frameworks/DOM snippet
//   createErrorMonitor          — console/error rolling buffer
//   buildPageContext            — URL/viewport/scroll/user-agent snapshot
//   deviceRect / cropToPng / cropToJpegThumbnail — bitmap cropping
//   embedMetadata / readMetadata / toBase64 — PNG iTXt chunk I/O

export { createSnapper, captureViaDisplayMedia, downloadSnap, METADATA_KEYWORD } from './snapper.js';
export { selectRegion, showToast } from './selection-overlay.js';
export { collectRegionMetadata, detectFrameworks } from './collect.js';
export { createErrorMonitor } from './error-monitor.js';
export { buildPageContext } from './page-context.js';
export { deviceRect, cropToPng, cropToJpegThumbnail } from './crop.js';
export { embedMetadata, readMetadata, toBase64, isPng, crc32 } from './png-meta.js';
