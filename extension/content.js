// Isolated-world content script — thin Chrome glue around the SDK: runs the
// selection overlay, asks the MAIN-world page agent for metadata (falling
// back to local collection), and ships the result to the service worker.
// Bundled with its SDK imports by tools/build.mjs.
import { selectRegion, showToast } from '../sdk/selection-overlay.js';
import { collectRegionMetadata, describeElementTarget } from '../sdk/collect.js';
import { buildPageContext } from '../sdk/page-context.js';
import { promptBugReport } from '../sdk/report-dialog.js';

(() => {
  'use strict';
  if (window.__bowserSnapsContent) return;
  window.__bowserSnapsContent = true;

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'BS_START_CAPTURE') {
      run().catch(() => showToast('Capture failed while collecting metadata', { isError: true }));
    } else if (msg.type === 'BS_REQUEST_REPORT') {
      handleReportRequest(msg).catch(() => {
        // If the dialog can't render, still save the snap rather than lose it.
        chrome.runtime.sendMessage({ type: 'BS_REPORT_SUBMITTED', captureId: msg.captureId, report: { description: null } });
      });
    } else if (msg.type === 'BS_CAPTURE_DONE') {
      showToast(`Saved ${msg.filename} — metadata embedded in the PNG`);
    } else if (msg.type === 'BS_CAPTURE_FAILED') {
      showToast(`Capture failed: ${msg.error}`, { isError: true });
    }
  });

  async function run() {
    const rect = await selectRegion();
    if (!rect) return;
    // The picked element (click mode) can't cross postMessage/sendMessage;
    // it travels as a serializable descriptor from here on.
    const target = rect.mode === 'element' && rect.element ? describeElementTarget(rect.element) : null;
    const plainRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const collected = await collectViaPageAgent(plainRect, target, rect.element || null);
    const selection = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    chrome.runtime.sendMessage({
      type: 'BS_REGION_SELECTED',
      rect: selection,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      metadata: {
        page: buildPageContext(),
        selection: {
          ...selection,
          mode: rect.mode || 'region',
          unit: 'css-px, viewport-relative',
          pagePosition: {
            x: selection.x + Math.round(window.scrollX),
            y: selection.y + Math.round(window.scrollY)
          }
        },
        frameworks: collected.frameworks || [],
        elements: collected.elements || [],
        domSnippet: collected.domSnippet || null,
        consoleErrors: collected.consoleErrors || []
      }
    });
  }

  // The service worker has the pixels frozen; collect the human half of the
  // bug report and send it back to finalize (or discard) the capture.
  async function handleReportRequest(msg) {
    const outcome = await promptBugReport({ thumbnailUrl: msg.thumbnail || null });
    if (outcome.action === 'discard') {
      chrome.runtime.sendMessage({ type: 'BS_REPORT_SUBMITTED', captureId: msg.captureId, discard: true });
      showToast('Snap discarded');
      return;
    }
    chrome.runtime.sendMessage({
      type: 'BS_REPORT_SUBMITTED',
      captureId: msg.captureId,
      report: { description: outcome.action === 'save' ? outcome.description : null }
    });
  }

  // Ask the MAIN-world page agent (component names + console errors); fall
  // back to local isolated-world collection if it doesn't answer. `target`
  // is the picked element's descriptor for the agent; `targetElement` is the
  // live node this world already holds, used by the fallback.
  function collectViaPageAgent(rect, target, targetElement) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const fallback = () => {
        try {
          resolve(collectRegionMetadata(rect, { target: targetElement }));
        } catch {
          resolve({});
        }
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        fallback();
      }, 500);
      function onMessage(event) {
        const d = event.data;
        if (event.source !== window || !d || d.__bowserSnaps !== 'response' || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (d.result && !d.result.error) resolve(d.result);
        else fallback();
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ __bowserSnaps: 'request', id, action: 'collect', rect, target }, '*');
    });
  }
})();
