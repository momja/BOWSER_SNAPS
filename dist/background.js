(() => {
  // sdk/png-meta.js
  var SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function readU32(bytes, offset) {
    return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
  }
  function writeU32(bytes, offset, value) {
    bytes[offset] = value >>> 24 & 255;
    bytes[offset + 1] = value >>> 16 & 255;
    bytes[offset + 2] = value >>> 8 & 255;
    bytes[offset + 3] = value & 255;
  }
  function isPng(bytes) {
    return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
  }
  function chunkTypeAt(bytes, offset) {
    return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
  }
  function findIendOffset(bytes) {
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      if (chunkTypeAt(bytes, offset) === "IEND") return offset;
      offset += 12 + readU32(bytes, offset);
    }
    throw new Error("PNG has no IEND chunk");
  }
  function buildITXt(keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    if (keywordBytes.length < 1 || keywordBytes.length > 79) throw new Error("invalid iTXt keyword length");
    const textBytes = encoder.encode(text);
    const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
    data.set(keywordBytes, 0);
    data.set(textBytes, keywordBytes.length + 5);
    const chunk = new Uint8Array(12 + data.length);
    writeU32(chunk, 0, data.length);
    chunk.set([105, 84, 88, 116], 4);
    chunk.set(data, 8);
    writeU32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
  }
  function embedMetadata(pngBytes, keyword, text) {
    if (!isPng(pngBytes)) throw new Error("not a PNG");
    const chunk = buildITXt(keyword, text);
    const iend = findIendOffset(pngBytes);
    const out = new Uint8Array(pngBytes.length + chunk.length);
    out.set(pngBytes.subarray(0, iend), 0);
    out.set(chunk, iend);
    out.set(pngBytes.subarray(iend), iend + chunk.length);
    return out;
  }
  function toBase64(bytes) {
    let binary = "";
    const CHUNK = 32768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  // sdk/crop.js
  function deviceRect(rect, viewport, bitmapWidth, bitmapHeight) {
    const scale = bitmapWidth / viewport.width;
    const sx = Math.min(Math.max(0, Math.round(rect.x * scale)), bitmapWidth - 1);
    const sy = Math.min(Math.max(0, Math.round(rect.y * scale)), bitmapHeight - 1);
    const sw = Math.max(1, Math.min(Math.round(rect.width * scale), bitmapWidth - sx));
    const sh = Math.max(1, Math.min(Math.round(rect.height * scale), bitmapHeight - sy));
    return { sx, sy, sw, sh, scale };
  }
  async function cropToPng(bitmap, { sx, sy, sw, sh }) {
    const canvas = new OffscreenCanvas(sw, sh);
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function cropToJpegThumbnail(bitmap, { sx, sy, sw, sh }, { maxWidth = 280, quality = 0.75 } = {}) {
    const width = Math.min(maxWidth, sw);
    const height = Math.max(1, Math.round(sh * (width / sw)));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // sdk/snapper.js
  var METADATA_KEYWORD = "bowser-snaps";

  // extension/background.js
  var HISTORY_LIMIT = 10;
  var RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chromewebstore\.google\.com\//;
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "start-capture") {
      startCapture(tab).catch((err) => console.error("bowser-snaps:", err));
    }
  });
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg) return;
    if (msg.type === "BS_START_CAPTURE_ACTIVE_TAB") {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => startCapture(tab)).catch((err) => console.error("bowser-snaps:", err));
    } else if (msg.type === "BS_REGION_SELECTED" && sender.tab) {
      handleRegion(msg, sender.tab).catch((err) => {
        console.error("bowser-snaps:", err);
        sendToTab(sender.tab.id, { type: "BS_CAPTURE_FAILED", error: err && err.message ? err.message : String(err) });
      });
    }
  });
  async function startCapture(tab) {
    if (!tab || tab.id == null || RESTRICTED_URL.test(tab.url || "")) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "BS_START_CAPTURE" });
    } catch {
      await Promise.all([
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        }),
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          files: ["page-agent.js"]
        })
      ]);
      await chrome.tabs.sendMessage(tab.id, { type: "BS_START_CAPTURE" });
    }
  }
  globalThis.__bowserSnapsStartCapture = startCapture;
  async function handleRegion(msg, tab) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const dr = deviceRect(msg.rect, msg.viewport, bitmap.width, bitmap.height);
    const cropped = await cropToPng(bitmap, dr);
    const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    const metadata = {
      tool: { name: "bowser-snaps", version: chrome.runtime.getManifest().version },
      capturedAt,
      image: {
        width: dr.sw,
        height: dr.sh,
        scale: Math.round(dr.scale * 100) / 100,
        note: "element/selection coords are CSS px; multiply by `scale` for image px"
      },
      ...msg.metadata
    };
    const metadataJson = JSON.stringify(metadata, null, 2);
    const stamped = embedMetadata(cropped, METADATA_KEYWORD, metadataJson);
    const filename = `bowser-snaps/snap-${capturedAt.replace(/[:.]/g, "-")}.png`;
    await chrome.downloads.download({
      url: `data:image/png;base64,${toBase64(stamped)}`,
      filename,
      conflictAction: "uniquify"
    });
    const { settings = {} } = await chrome.storage.local.get("settings");
    if (settings.sidecarJson) {
      await chrome.downloads.download({
        url: `data:application/json;base64,${toBase64(new TextEncoder().encode(metadataJson))}`,
        filename: filename.replace(/\.png$/, ".json"),
        conflictAction: "uniquify"
      });
    }
    const thumbBytes = await cropToJpegThumbnail(bitmap, dr);
    await storeCapture({
      id: crypto.randomUUID(),
      capturedAt,
      url: metadata.page && metadata.page.url || tab.url || "",
      title: tab.title || "",
      filename,
      thumbnail: `data:image/jpeg;base64,${toBase64(thumbBytes)}`,
      metadata
    });
    sendToTab(tab.id, { type: "BS_CAPTURE_DONE", filename });
  }
  async function storeCapture(record) {
    const { captures = [] } = await chrome.storage.local.get("captures");
    captures.unshift(record);
    await chrome.storage.local.set({ captures: captures.slice(0, HISTORY_LIMIT) });
  }
  function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
    });
  }
})();
