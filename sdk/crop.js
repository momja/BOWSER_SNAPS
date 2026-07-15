// Cropping helpers: map a CSS-px viewport selection onto a captured bitmap
// and cut it out. Uses OffscreenCanvas, so it works in windows and workers
// (including MV3 service workers). No extension APIs.

/**
 * Map a CSS-px, viewport-relative rect onto bitmap pixel coordinates.
 * The scale is derived from the actual bitmap width rather than
 * devicePixelRatio, which also handles browser zoom.
 */
export function deviceRect(rect, viewport, bitmapWidth, bitmapHeight) {
  const scale = bitmapWidth / viewport.width;
  const sx = Math.min(Math.max(0, Math.round(rect.x * scale)), bitmapWidth - 1);
  const sy = Math.min(Math.max(0, Math.round(rect.y * scale)), bitmapHeight - 1);
  const sw = Math.max(1, Math.min(Math.round(rect.width * scale), bitmapWidth - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * scale), bitmapHeight - sy));
  return { sx, sy, sw, sh, scale };
}

/** Crop a bitmap to the given device rect and encode as PNG bytes. */
export async function cropToPng(bitmap, { sx, sy, sw, sh }) {
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Downscaled JPEG preview of a device rect, as bytes (e.g. for history UIs). */
export async function cropToJpegThumbnail(bitmap, { sx, sy, sw, sh }, { maxWidth = 280, quality = 0.75 } = {}) {
  const width = Math.min(maxWidth, sw);
  const height = Math.max(1, Math.round(sh * (width / sw)));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}
