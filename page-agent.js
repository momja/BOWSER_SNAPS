// page-agent.js — runs in the page's MAIN world at document_start so it can:
//   1. Hook console.error/warn and uncaught errors before app code runs,
//      keeping a rolling buffer for bug reports.
//   2. Run collect.js with access to framework internals (React fibers,
//      Vue instances) that isolated-world content scripts cannot see.
// It talks to the isolated-world content script over window.postMessage.
(() => {
  'use strict';
  if (window.__bowserSnapsAgent) return;
  window.__bowserSnapsAgent = true;

  const MAX_ERRORS = 30;
  const errors = [];

  function pushError(entry) {
    errors.push(entry);
    if (errors.length > MAX_ERRORS) errors.shift();
  }

  function formatArg(arg) {
    try {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${(arg.stack || '').slice(0, 1200)}`;
      }
      if (typeof arg === 'object' && arg !== null) {
        const json = JSON.stringify(arg);
        return json ? json.slice(0, 400) : String(arg);
      }
      return String(arg).slice(0, 400);
    } catch {
      return '[unserializable]';
    }
  }

  window.addEventListener('error', (e) => {
    pushError({
      type: 'uncaught-exception',
      message: e.message,
      source: e.filename || null,
      line: e.lineno || null,
      column: e.colno || null,
      stack: (e.error && e.error.stack && e.error.stack.slice(0, 1500)) || null,
      at: new Date().toISOString()
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    pushError({
      type: 'unhandled-rejection',
      message: formatArg(e.reason),
      at: new Date().toISOString()
    });
  });

  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      pushError({
        type: `console.${level}`,
        message: args.map(formatArg).join(' ').slice(0, 1000),
        at: new Date().toISOString()
      });
      original(...args);
    };
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.__bowserSnaps !== 'request') return;
    let result;
    try {
      if (data.action !== 'collect') return;
      result = __bowserSnapsCollect.collect(data.rect);
      result.consoleErrors = errors.slice();
    } catch (err) {
      result = { error: String(err) };
    }
    window.postMessage({ __bowserSnaps: 'response', id: data.id, result }, '*');
  });
})();
