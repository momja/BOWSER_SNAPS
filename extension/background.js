// MV3 service worker — the Chrome-only side of a capture: captureVisibleTab,
// crop + embed via the SDK, download, and popup history in storage.
// Bundled with its SDK imports by tools/build.mjs.
import { embedMetadata, toBase64 } from '../sdk/png-meta.js';
import { deviceRect, cropToPng, cropToJpegThumbnail } from '../sdk/crop.js';
import { METADATA_KEYWORD } from '../sdk/snapper.js';

const HISTORY_LIMIT = 10;
const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chromewebstore\.google\.com\//;

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

async function handleRegion(msg, tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

  const dr = deviceRect(msg.rect, msg.viewport, bitmap.width, bitmap.height);
  const cropped = await cropToPng(bitmap, dr);

  const capturedAt = new Date().toISOString();
  const metadata = {
    tool: { name: 'bowser-snaps', version: chrome.runtime.getManifest().version },
    capturedAt,
    image: {
      width: dr.sw,
      height: dr.sh,
      scale: Math.round(dr.scale * 100) / 100,
      note: 'element/selection coords are CSS px; multiply by `scale` for image px'
    },
    ...msg.metadata
  };
  const metadataJson = JSON.stringify(metadata, null, 2);

  const stamped = embedMetadata(cropped, METADATA_KEYWORD, metadataJson);
  const filename = `bowser-snaps/snap-${capturedAt.replace(/[:.]/g, '-')}.png`;
  await chrome.downloads.download({
    url: `data:image/png;base64,${toBase64(stamped)}`,
    filename,
    conflictAction: 'uniquify'
  });

  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.sidecarJson) {
    await chrome.downloads.download({
      url: `data:application/json;base64,${toBase64(new TextEncoder().encode(metadataJson))}`,
      filename: filename.replace(/\.png$/, '.json'),
      conflictAction: 'uniquify'
    });
  }

  const thumbBytes = await cropToJpegThumbnail(bitmap, dr);
  await storeCapture({
    id: crypto.randomUUID(),
    capturedAt,
    url: (metadata.page && metadata.page.url) || tab.url || '',
    title: tab.title || '',
    filename,
    thumbnail: `data:image/jpeg;base64,${toBase64(thumbBytes)}`,
    metadata
  });

  sendToTab(tab.id, { type: 'BS_CAPTURE_DONE', filename });
}

async function storeCapture(record) {
  const { captures = [] } = await chrome.storage.local.get('captures');
  captures.unshift(record);
  await chrome.storage.local.set({ captures: captures.slice(0, HISTORY_LIMIT) });
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
