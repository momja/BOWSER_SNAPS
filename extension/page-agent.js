// MAIN-world content script (document_start) — thin Chrome glue around the
// SDK: starts the error monitor before app code runs and serves collection
// requests with access to framework internals (React fibers, Vue instances)
// that isolated worlds can't see. Talks to content.js over window.postMessage.
// Bundled with its SDK imports by tools/build.mjs.
import { collectRegionMetadata, resolveElementTarget } from '../sdk/collect.js';
import { createErrorMonitor } from '../sdk/error-monitor.js';

(() => {
  'use strict';
  if (window.__bowserSnapsAgent) return;
  window.__bowserSnapsAgent = true;

  const errorMonitor = createErrorMonitor();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.__bowserSnaps !== 'request') return;
    if (data.action !== 'collect') return;
    let result;
    try {
      result = collectRegionMetadata(data.rect, { target: resolveElementTarget(data.target) });
      result.consoleErrors = errorMonitor.snapshot();
    } catch (err) {
      result = { error: String(err) };
    }
    window.postMessage({ __bowserSnaps: 'response', id: data.id, result }, '*');
  });
})();
