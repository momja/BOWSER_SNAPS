// macOS-Cmd+Shift+4-style drag-to-select overlay, rendered in a closed shadow
// root so page styles can't touch it. Pure DOM, no extension APIs.

const MAX_Z = 2147483647;

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

let activeTeardown = null;

/**
 * Show the selection overlay and let the user drag out a region.
 * Resolves with { x, y, width, height } in CSS px (viewport-relative), or
 * null if cancelled (Esc, non-left click, or a sub-4px drag). Resolution is
 * deferred until after the overlay has been removed and the page repainted,
 * so callers can capture pixels immediately.
 */
export function selectRegion({ hintText = 'Drag to snap a region · Esc to cancel' } = {}) {
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
      <div class="box"><div class="size"></div></div>`;

    root.querySelector('.hint').textContent = hintText;
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

    const finish = async (rect) => {
      teardown();
      await nextPaint(); // let the overlay disappear before the caller captures
      resolve(rect && rect.width >= 4 && rect.height >= 4 ? rect : null);
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) { finish(null); return; }
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
      finish(currentRect(e));
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
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
