// Region-selection overlay, rendered in a closed shadow root so page styles
// can't touch it. Pure DOM, no extension APIs. Two ways to select:
//   · hover + click — devtools/penpot-visual-fetch style element picking,
//     with ↑/↓ walking to the parent/back to the child and ↵ confirming
//   · drag — macOS-Cmd+Shift+4-style rectangle
// Both resolve through the same promise; see selectRegion.

const MAX_Z = 2147483647;
const DRAG_THRESHOLD = 4; // px of movement before a press becomes a drag

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

let activeTeardown = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The overlay host sits on top of everything, so hit-testing goes through
// elementsFromPoint (which reports the whole stack) and skips the host.
function elementAt(x, y, host) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host || el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}

// Element bounds clamped to the viewport (captures are viewport-bound).
function viewportRect(el) {
  const r = el.getBoundingClientRect();
  const x = clamp(r.left, 0, window.innerWidth);
  const y = clamp(r.top, 0, window.innerHeight);
  return {
    x,
    y,
    width: clamp(r.right, 0, window.innerWidth) - x,
    height: clamp(r.bottom, 0, window.innerHeight) - y
  };
}

function describeElement(el, rect) {
  let name = el.localName;
  if (el.id) name += '#' + el.id;
  else {
    const classes = [...el.classList].slice(0, 2);
    if (classes.length) name += '.' + classes.join('.');
  }
  return `${name} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

/**
 * Show the selection overlay and let the user pick an element (hover
 * highlights it, ↑/↓ walk to the parent/back down, click or ↵ confirms) or
 * drag out a rectangle. Resolves with { x, y, width, height, mode } in CSS
 * px (viewport-relative) — mode is 'element' (plus an `element` property
 * referencing the picked node, bounds clamped to the viewport) or 'region' —
 * or null if cancelled (Esc or non-left click). Resolution is deferred until
 * after the overlay has been removed and the page repainted, so callers can
 * capture pixels immediately.
 */
export function selectRegion({ hintText = 'Click an element or drag a region · ↑ ↓ parent/child · Esc to cancel' } = {}) {
  if (activeTeardown) return Promise.resolve(null);

  return new Promise((resolve) => {
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
        .pick {
          position: fixed; display: none; pointer-events: none;
          border: 1px solid #58a6ff; background: rgba(88, 166, 255, .18);
        }
        .pick-label {
          position: absolute; left: 0; top: 100%; margin-top: 6px;
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 11px/1 ui-monospace, monospace;
          padding: 4px 6px; border-radius: 4px; white-space: nowrap;
        }
        .pick-label.above { top: auto; bottom: 100%; margin: 0 0 6px; }
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
      <div class="hint"></div>
      <div class="pick"><div class="pick-label"></div></div>
      <div class="box"><div class="size"></div></div>`;

    root.querySelector('.hint').textContent = hintText;
    const backdrop = root.querySelector('.backdrop');
    const pick = root.querySelector('.pick');
    const pickLabel = root.querySelector('.pick-label');
    const box = root.querySelector('.box');
    const sizeLabel = root.querySelector('.size');
    const hint = root.querySelector('.hint');

    let start = null;      // mousedown point; set while the button is held
    let dragging = false;  // movement exceeded DRAG_THRESHOLD since mousedown
    // Element picking: hoverEl is what's under the pointer; current is the
    // highlighted candidate (hoverEl, or an ancestor after ↑); descentStack
    // remembers the path down so ↓ retraces it.
    let hoverEl = null;
    let current = null;
    let descentStack = [];

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

    const finish = async (result) => {
      teardown();
      await nextPaint(); // let the overlay disappear before the caller captures
      resolve(result);
    };

    const finishRegion = (rect) => {
      finish(rect && rect.width >= DRAG_THRESHOLD && rect.height >= DRAG_THRESHOLD
        ? { ...rect, mode: 'region' }
        : null);
    };

    const finishElement = (el) => {
      if (!el) return; // nothing under the pointer yet — keep picking
      const rect = viewportRect(el);
      if (rect.width < 1 || rect.height < 1) return; // fully off-screen
      finish({ ...rect, mode: 'element', element: el });
    };

    const highlight = (el) => {
      current = el;
      if (!el) {
        pick.style.display = 'none';
        return;
      }
      const r = viewportRect(el);
      pick.style.display = 'block';
      pick.style.left = r.x + 'px';
      pick.style.top = r.y + 'px';
      pick.style.width = r.width + 'px';
      pick.style.height = r.height + 'px';
      pickLabel.textContent = describeElement(el, r);
      // Flip the label above the box when it would run off the bottom.
      pickLabel.classList.toggle('above', r.y + r.height > window.innerHeight - 32);
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) { finish(null); return; }
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      dragging = false;
      hint.style.display = 'none';
    };
    const onMouseMove = (e) => {
      if (start) {
        e.preventDefault();
        if (!dragging) {
          if (Math.abs(e.clientX - start.x) < DRAG_THRESHOLD &&
              Math.abs(e.clientY - start.y) < DRAG_THRESHOLD) return;
          dragging = true;
          pick.style.display = 'none'; // it's a drag — leave element mode
        }
        const r = currentRect(e);
        box.style.display = 'block';
        box.style.left = r.x + 'px';
        box.style.top = r.y + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
        sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
        return;
      }
      const el = elementAt(e.clientX, e.clientY, host);
      if (el !== hoverEl) {
        hoverEl = el;
        descentStack = []; // pointer moved to a new element — drop ↑/↓ state
        highlight(el);
      }
    };
    const onMouseUp = (e) => {
      if (!start) return;
      if (dragging) {
        finishRegion(currentRect(e));
      } else {
        finishElement(current); // a click — select the highlighted element
        start = null;
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
        return;
      }
      if (start) return; // mid-drag — only Esc applies
      if (e.key === 'ArrowUp' && current) {
        e.preventDefault();
        const parent = current.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          descentStack.push(current);
          highlight(parent);
        }
      } else if (e.key === 'ArrowDown' && descentStack.length) {
        e.preventDefault();
        highlight(descentStack.pop());
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishElement(current);
      }
    };

    function teardown() {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      activeTeardown = null;
    }

    backdrop.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    (document.body || document.documentElement).appendChild(host);
    activeTeardown = teardown;
  });
}

/** Small auto-dismissing notification in the page corner. */
export function showToast(text, { isError = false, durationMs = 4500 } = {}) {
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
  setTimeout(() => host.remove(), durationMs);
}
