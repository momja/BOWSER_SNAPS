// Bug-report dialog shown after capture, before save: a description box
// (markdown welcome) whose content rides along in the snap metadata. Rendered
// in a closed shadow root over the live page. Pure DOM, no extension APIs.
//
// The description is returned as a raw string; it is stored verbatim as a
// JSON string field (JSON.stringify escapes quotes/newlines/unicode), so no
// sanitization happens here and markdown is never interpreted.

const MAX_Z = 2147483647;
const MAX_DESCRIPTION = 5000;

/**
 * @param {object} [options]
 * @param {string|null} [options.thumbnailUrl] Preview image of the capture.
 * @param {string} [options.placeholder]
 * @returns {Promise<{action: 'save', description: string} | {action: 'skip'} | {action: 'discard'}>}
 *   'save' — include the description; 'skip' — save the snap without a note;
 *   'discard' — throw the capture away (Esc / ✕).
 */
export function promptBugReport({
  thumbnailUrl = null,
  placeholder = "What's wrong here? Steps, expected vs. actual… (markdown welcome)"
} = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('bowser-snaps-report');
    host.style.cssText = `position:fixed !important; inset:0 !important; z-index:${MAX_Z} !important;`;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); }
        .card {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: min(520px, calc(100vw - 48px));
          background: #1d1f24; color: #e8eaf0;
          font: 13px/1.45 -apple-system, system-ui, sans-serif;
          border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
          padding: 16px; display: flex; flex-direction: column; gap: 10px;
        }
        .head { display: flex; align-items: center; justify-content: space-between; }
        .title { font-size: 14px; font-weight: 600; }
        .close {
          border: 0; background: transparent; color: #9aa0ab; cursor: pointer;
          font: 16px/1 sans-serif; padding: 2px 6px; border-radius: 6px;
        }
        .close:hover { background: rgba(255, 255, 255, .08); color: #fff; }
        .thumb {
          max-width: 100%; max-height: 140px; object-fit: contain;
          border-radius: 8px; border: 1px solid rgba(255, 255, 255, .12);
          align-self: flex-start;
        }
        textarea {
          width: 100%; min-height: 96px; resize: vertical;
          background: #14151a; color: inherit; font: inherit;
          border: 1px solid rgba(255, 255, 255, .15); border-radius: 8px;
          padding: 10px 12px; outline: none;
        }
        textarea:focus { border-color: #58a6ff; }
        .hint { color: #9aa0ab; font-size: 11.5px; }
        kbd {
          font: 10.5px/1 ui-monospace, monospace; padding: 1px 4px;
          border-radius: 4px; background: rgba(255, 255, 255, .10);
        }
        .actions { display: flex; justify-content: flex-end; gap: 8px; }
        button.action {
          font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 14px;
          border: 1px solid rgba(255, 255, 255, .18); background: transparent; color: inherit;
        }
        button.action:hover { background: rgba(255, 255, 255, .07); }
        button.save { background: #2563eb; border-color: #2563eb; color: #fff; }
        button.save:hover { background: #1d4ed8; }
      </style>
      <div class="backdrop"></div>
      <div class="card" role="dialog" aria-label="Report this bug">
        <div class="head">
          <span class="title">Report this bug</span>
          <button class="close" title="Discard capture (Esc)">✕</button>
        </div>
        ${thumbnailUrl ? '<img class="thumb" alt="capture preview">' : ''}
        <textarea maxlength="${MAX_DESCRIPTION}"></textarea>
        <div class="hint">
          Included verbatim in the snap's JSON metadata — markdown welcome.
          <kbd>⌘/Ctrl+Enter</kbd> save · <kbd>Esc</kbd> discard
        </div>
        <div class="actions">
          <button class="action skip">Skip note</button>
          <button class="action save">Save snap</button>
        </div>
      </div>`;

    const textarea = root.querySelector('textarea');
    textarea.placeholder = placeholder;
    if (thumbnailUrl) root.querySelector('.thumb').src = thumbnailUrl;

    const finish = (result) => {
      window.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve(result);
    };
    const save = () => {
      const description = textarea.value.trim().slice(0, MAX_DESCRIPTION);
      finish(description ? { action: 'save', description } : { action: 'skip' });
    };

    // Capture-phase so page hotkey handlers stay quiet while the dialog is
    // open; stopPropagation doesn't affect the textarea's default typing.
    const onKeyDown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish({ action: 'discard' });
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
    };

    root.querySelector('.save').addEventListener('click', save);
    root.querySelector('.skip').addEventListener('click', () => finish({ action: 'skip' }));
    root.querySelector('.close').addEventListener('click', () => finish({ action: 'discard' }));
    window.addEventListener('keydown', onKeyDown, true);

    (document.body || document.documentElement).appendChild(host);
    textarea.focus();
  });
}
