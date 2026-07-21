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
//   promptBugReport             — post-capture bug description dialog
//   FORMAT / SCHEMA_VERSION     — metadata envelope contract (see SCHEMA.md)
//   selectRegion / showToast    — click-or-drag selection overlay UI
//   collectRegionMetadata       — elements/components/frameworks/DOM snippet
//   describeElementTarget / resolveElementTarget — picked-element handoff
//                                 across JS worlds (extension glue)
//   createErrorMonitor          — console/error rolling buffer
//   buildPageContext            — URL/viewport/scroll/user-agent snapshot
//   deviceRect / cropToPng / cropToJpegThumbnail — bitmap cropping
//   embedMetadata / readMetadata / toBase64 — PNG iTXt chunk I/O

export { createSnapper, captureViaDisplayMedia, downloadSnap } from './snapper.js';
export { promptBugReport } from './report-dialog.js';
export { FORMAT, SCHEMA_VERSION, METADATA_KEYWORD } from './schema.js';
export { selectRegion, showToast } from './selection-overlay.js';
export { collectRegionMetadata, detectFrameworks, describeElementTarget, resolveElementTarget } from './collect.js';
export { createErrorMonitor } from './error-monitor.js';
export { buildPageContext } from './page-context.js';
export { deviceRect, cropToPng, cropToJpegThumbnail } from './crop.js';
export { embedMetadata, readMetadata, toBase64, fromBase64, isPng, crc32 } from './png-meta.js';
