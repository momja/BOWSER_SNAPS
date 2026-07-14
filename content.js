// content.js — isolated world. Owns the drag-to-select overlay (macOS
// Cmd+Shift+4 style) and shuttles the selection + collected metadata to the
// background service worker, which does the actual capture.
(() => {
  'use strict';
  if (window.__bowserSnapsContent) return;
  window.__bowserSnapsContent = true;

  const MAX_Z = 2147483647;
  let teardownOverlay = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'BS_START_CAPTURE') startSelection();
    else if (msg.type === 'BS_CAPTURE_DONE') toast(`Saved ${msg.filename} — metadata embedded in the PNG`);
    else if (msg.type === 'BS_CAPTURE_FAILED') toast(`Capture failed: ${msg.error}`, true);
  });

  function startSelection() {
    if (teardownOverlay) return;

    const host = document.createElement('bowser-snaps-overlay');
    host.style.cssText = `position:fixed !important; inset:0 !important; z-index:${MAX_Z} !important;`;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; cursor: crosshair; }
        .hint {
          position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 13px/1.4 -apple-system, system-ui, sans-serif;
          padding: 6px 14px; border-radius: 999px; pointer-events: none;
        }
        .box {
          position: fixed; display: none; pointer-events: none;
          border: 1px solid #58a6ff; background: rgba(88, 166, 255, .10);
          box-shadow: 0 0 0 200vmax rgba(0, 0, 0, .30);
        }
        .size {
          position: absolute; right: 0; top: 100%; margin-top: 6px;
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 11px/1 ui-monospace, monospace;
          padding: 4px 6px; border-radius: 4px; white-space: nowrap;
        }
      </style>
      <div class="backdrop"></div>
      <div class="hint">Drag to snap a region &nbsp;·&nbsp; Esc to cancel</div>
      <div class="box"><div class="size"></div></div>`;

    const backdrop = root.querySelector('.backdrop');
    const box = root.querySelector('.box');
    const sizeLabel = root.querySelector('.size');
    const hint = root.querySelector('.hint');

    let start = null;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const currentRect = (e) => {
      const x2 = clamp(e.clientX, 0, window.innerWidth);
      const y2 = clamp(e.clientY, 0, window.innerHeight);
      return {
        x: Math.min(start.x, x2),
        y: Math.min(start.y, y2),
        width: Math.abs(x2 - start.x),
        height: Math.abs(y2 - start.y)
      };
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) { teardown(); return; }
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      hint.style.display = 'none';
    };
    const onMouseMove = (e) => {
      if (!start) return;
      e.preventDefault();
      const r = currentRect(e);
      box.style.display = 'block';
      box.style.left = r.x + 'px';
      box.style.top = r.y + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    };
    const onMouseUp = (e) => {
      if (!start) return;
      const rect = currentRect(e);
      teardown();
      if (rect.width < 4 || rect.height < 4) return;
      finishSelection(rect).catch(() => toast('Capture failed while collecting metadata', true));
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        teardown();
      }
    };

    function teardown() {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      teardownOverlay = null;
    }

    backdrop.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    (document.body || document.documentElement).appendChild(host);
    teardownOverlay = teardown;
  }

  async function finishSelection(rect) {
    await nextPaint(); // make sure the overlay is gone before we read the DOM / capture
    const collected = await collectMetadata(rect);
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
        page: pageContext(),
        selection: {
          ...selection,
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

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // Ask the MAIN-world page agent (component names + console errors); fall
  // back to local isolated-world collection if it doesn't answer.
  function collectMetadata(rect) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const fallback = () => {
        try {
          resolve(__bowserSnapsCollect.collect(rect));
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
      window.postMessage({ __bowserSnaps: 'request', id, action: 'collect', rect }, '*');
    });
  }

  function pageContext() {
    return {
      url: location.href,
      path: location.pathname,
      query: location.search || null,
      hash: location.hash || null,
      title: document.title,
      referrer: document.referrer || null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
      },
      userAgent: navigator.userAgent,
      language: navigator.language
    };
  }

  function toast(text, isError) {
    const host = document.createElement('bowser-snaps-toast');
    host.style.cssText = `position:fixed !important; left:50% !important; bottom:24px !important; transform:translateX(-50%) !important; z-index:${MAX_Z} !important;`;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .toast {
          background: ${isError ? '#b3261e' : 'rgba(20, 20, 24, .92)'}; color: #fff;
          font: 13px/1.4 -apple-system, system-ui, sans-serif;
          padding: 10px 16px; border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, .25); max-width: 80vw;
        }
      </style>
      <div class="toast"></div>`;
    root.querySelector('.toast').textContent = text;
    (document.body || document.documentElement).appendChild(host);
    setTimeout(() => host.remove(), 4500);
  }
})();
