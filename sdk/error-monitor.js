// Rolling buffer of console errors/warnings, uncaught exceptions, and
// unhandled promise rejections. Install as early as possible (before app
// code runs) so the buffer covers the session. Pure DOM, no extension APIs.

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

/**
 * Hook error sources and start buffering.
 * @returns {{ snapshot: () => object[], dispose: () => void }}
 *   snapshot() returns a copy of the buffered entries (oldest first);
 *   dispose() unhooks console methods and listeners.
 */
export function createErrorMonitor({ maxEntries = 30 } = {}) {
  const entries = [];

  function push(entry) {
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();
  }

  const onError = (e) => {
    push({
      type: 'uncaught-exception',
      message: e.message,
      source: e.filename || null,
      line: e.lineno || null,
      column: e.colno || null,
      stack: (e.error && e.error.stack && e.error.stack.slice(0, 1500)) || null,
      at: new Date().toISOString()
    });
  };
  const onRejection = (e) => {
    push({
      type: 'unhandled-rejection',
      message: formatArg(e.reason),
      at: new Date().toISOString()
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const originals = {};
  for (const level of ['error', 'warn']) {
    originals[level] = console[level].bind(console);
    console[level] = (...args) => {
      push({
        type: `console.${level}`,
        message: args.map(formatArg).join(' ').slice(0, 1000),
        at: new Date().toISOString()
      });
      originals[level](...args);
    };
  }

  return {
    snapshot: () => entries.slice(),
    dispose() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      for (const level of Object.keys(originals)) console[level] = originals[level];
    }
  };
}
