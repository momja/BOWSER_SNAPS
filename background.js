// background.js — MV3 service worker. Captures the visible tab when the
// content script reports a selected region, crops it, embeds the collected
// metadata as a PNG iTXt chunk, downloads the result, and keeps a small
// history in chrome.storage.local for the popup.
importScripts('png-meta.js');

const METADATA_KEYWORD = 'bowser-snaps';
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
        files: ['collect.js', 'content.js']
      }),
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['collect.js', 'page-agent.js']
      })
    ]);
    await chrome.tabs.sendMessage(tab.id, { type: 'BS_START_CAPTURE' });
  }
}

async function handleRegion(msg, tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

  // Derive the CSS-px → image-px scale from the actual bitmap rather than
  // trusting devicePixelRatio; this also handles browser zoom.
  const scale = bitmap.width / msg.viewport.width;
  const sx = Math.min(Math.max(0, Math.round(msg.rect.x * scale)), bitmap.width - 1);
  const sy = Math.min(Math.max(0, Math.round(msg.rect.y * scale)), bitmap.height - 1);
  const sw = Math.max(1, Math.min(Math.round(msg.rect.width * scale), bitmap.width - sx));
  const sh = Math.max(1, Math.min(Math.round(msg.rect.height * scale), bitmap.height - sy));

  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const cropped = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());

  const capturedAt = new Date().toISOString();
  const metadata = {
    tool: { name: 'bowser-snaps', version: chrome.runtime.getManifest().version },
    capturedAt,
    image: {
      width: sw,
      height: sh,
      scale: Math.round(scale * 100) / 100,
      note: 'element/selection coords are CSS px; multiply by `scale` for image px'
    },
    ...msg.metadata
  };
  const metadataJson = JSON.stringify(metadata, null, 2);

  const stamped = PngMeta.insertText(cropped, METADATA_KEYWORD, metadataJson);
  const filename = `bowser-snaps/snap-${capturedAt.replace(/[:.]/g, '-')}.png`;
  await chrome.downloads.download({
    url: `data:image/png;base64,${PngMeta.toBase64(stamped)}`,
    filename,
    conflictAction: 'uniquify'
  });

  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.sidecarJson) {
    await chrome.downloads.download({
      url: `data:application/json;base64,${PngMeta.toBase64(new TextEncoder().encode(metadataJson))}`,
      filename: filename.replace(/\.png$/, '.json'),
      conflictAction: 'uniquify'
    });
  }

  await storeCapture({
    id: crypto.randomUUID(),
    capturedAt,
    url: (metadata.page && metadata.page.url) || tab.url || '',
    title: tab.title || '',
    filename,
    thumbnail: await makeThumbnail(bitmap, sx, sy, sw, sh),
    metadata
  });

  sendToTab(tab.id, { type: 'BS_CAPTURE_DONE', filename });
}

async function makeThumbnail(bitmap, sx, sy, sw, sh) {
  const width = Math.min(280, sw);
  const height = Math.max(1, Math.round(sh * (width / sw)));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return `data:image/jpeg;base64,${PngMeta.toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

async function storeCapture(record) {
  const { captures = [] } = await chrome.storage.local.get('captures');
  captures.unshift(record);
  await chrome.storage.local.set({ captures: captures.slice(0, HISTORY_LIMIT) });
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
