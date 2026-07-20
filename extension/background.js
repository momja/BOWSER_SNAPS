// MV3 service worker — the Chrome-only side of a capture: captureVisibleTab,
// crop + embed via the SDK, download, and popup history in storage.
//
// A capture is two-phase: pixels are grabbed and cropped the moment the
// region is selected (so the bug-report dialog never appears in the shot and
// the page can't drift while the user types), parked in
// chrome.storage.session, and finalized — report merged, metadata embedded,
// file downloaded — when the dialog resolves. Session storage survives
// service-worker recycling during a slow write-up.
//
// Bundled with its SDK imports by tools/build.mjs.
import { embedMetadata, toBase64, fromBase64 } from '../sdk/png-meta.js';
import { deviceRect, cropToPng, cropToJpegThumbnail } from '../sdk/crop.js';
import { FORMAT, SCHEMA_VERSION, METADATA_KEYWORD } from '../sdk/schema.js';

const HISTORY_LIMIT = 10;
const DEFAULT_FOLDER = 'bowser-snaps';
const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chromewebstore\.google\.com\//;

// chrome.downloads.download() only accepts paths relative to the Downloads
// directory — no absolute paths, no "..". Strip anything that would violate
// that (or land the file outside the intended subtree) rather than letting
// the download call reject the whole capture.
function sanitizeFolder(raw) {
  return String(raw || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'start-capture') {
    startCapture(tab).catch((err) => console.error('bowser-snaps:', err));
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  if (msg.type === 'BS_START_CAPTURE_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => startCapture(tab))
      .catch((err) => console.error('bowser-snaps:', err));
  } else if (msg.type === 'BS_REGION_SELECTED' && sender.tab) {
    handleRegion(msg, sender.tab).catch((err) => {
      console.error('bowser-snaps:', err);
      sendToTab(sender.tab.id, { type: 'BS_CAPTURE_FAILED', error: err && err.message ? err.message : String(err) });
    });
  } else if (msg.type === 'BS_REPORT_SUBMITTED' && sender.tab) {
    (msg.discard ? discardCapture(msg.captureId) : finalizeCapture(msg.captureId, msg.report))
      .catch((err) => {
        console.error('bowser-snaps:', err);
        sendToTab(sender.tab.id, { type: 'BS_CAPTURE_FAILED', error: err && err.message ? err.message : String(err) });
      });
  }
});

async function startCapture(tab) {
  if (!tab || tab.id == null || RESTRICTED_URL.test(tab.url || '')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'BS_START_CAPTURE' });
  } catch {
    // Content scripts not present (e.g. the tab predates the extension
    // install) — inject both worlds on demand, then retry.
    await Promise.all([
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }),
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['page-agent.js']
      })
    ]);
    await chrome.tabs.sendMessage(tab.id, { type: 'BS_START_CAPTURE' });
  }
}

// The E2E suite drives captures through this global because keyboard
// commands can't be synthesized from test code.
globalThis.__bowserSnapsStartCapture = startCapture;

// Phase 1: freeze the pixels, then ask the page for the bug description.
async function handleRegion(msg, tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

  const dr = deviceRect(msg.rect, msg.viewport, bitmap.width, bitmap.height);
  const cropped = await cropToPng(bitmap, dr);
  const thumbBytes = await cropToJpegThumbnail(bitmap, dr);

  const capturedAt = new Date().toISOString();
  const metadata = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'bowser-snaps', version: chrome.runtime.getManifest().version },
    capturedAt,
    report: { description: null },
    image: {
      width: dr.sw,
      height: dr.sh,
      scale: Math.round(dr.scale * 100) / 100,
      note: 'element/selection coords are CSS px; multiply by `scale` for image px'
    },
    ...msg.metadata
  };

  const captureId = crypto.randomUUID();
  const pending = {
    id: captureId,
    tabId: tab.id,
    capturedAt,
    url: (metadata.page && metadata.page.url) || tab.url || '',
    title: tab.title || '',
    pngBase64: toBase64(cropped),
    thumbnail: `data:image/jpeg;base64,${toBase64(thumbBytes)}`,
    metadata
  };
  await chrome.storage.session.set({ [`pending:${captureId}`]: pending });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'BS_REQUEST_REPORT',
      captureId,
      thumbnail: pending.thumbnail
    });
  } catch {
    // Page can't show the dialog (navigated away mid-capture) — don't lose
    // the snap, save it without a description.
    await finalizeCapture(captureId, { description: null });
  }
}

// Phase 2: merge the report, embed metadata, and save.
async function finalizeCapture(captureId, report) {
  const key = `pending:${captureId}`;
  const { [key]: pending } = await chrome.storage.session.get(key);
  if (!pending) throw new Error('capture expired before it could be saved');
  await chrome.storage.session.remove(key);

  const metadata = pending.metadata;
  metadata.report = { description: (report && report.description) || null };
  const metadataJson = JSON.stringify(metadata, null, 2);

  const { settings = {} } = await chrome.storage.local.get('settings');
  const folder = sanitizeFolder(settings.folder ?? DEFAULT_FOLDER);

  const stamped = embedMetadata(fromBase64(pending.pngBase64), METADATA_KEYWORD, metadataJson);
  const filename = `${folder ? folder + '/' : ''}snap-${pending.capturedAt.replace(/[:.]/g, '-')}.png`;
  await chrome.downloads.download({
    url: `data:image/png;base64,${toBase64(stamped)}`,
    filename,
    conflictAction: 'uniquify'
  });

  if (settings.sidecarJson) {
    await chrome.downloads.download({
      url: `data:application/json;base64,${toBase64(new TextEncoder().encode(metadataJson))}`,
      filename: filename.replace(/\.png$/, '.json'),
      conflictAction: 'uniquify'
    });
  }

  await storeCapture({
    id: captureId,
    capturedAt: pending.capturedAt,
    url: pending.url,
    title: pending.title,
    filename,
    thumbnail: pending.thumbnail,
    metadata
  });

  sendToTab(pending.tabId, { type: 'BS_CAPTURE_DONE', filename });
}

async function discardCapture(captureId) {
  await chrome.storage.session.remove(`pending:${captureId}`);
}

async function storeCapture(record) {
  const { captures = [] } = await chrome.storage.local.get('captures');
  captures.unshift(record);
  await chrome.storage.local.set({ captures: captures.slice(0, HISTORY_LIMIT) });
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
