/**
 * Resize an image blob to fit within maxDim × maxDim and maxBytes.
 * Returns a WebP blob (or JPEG fallback if WebP unsupported).
 */
export async function resizeImage(
  file: File | Blob,
  maxDim = 300,
  maxBytes = 500_000,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // Scale to fit within maxDim
  let w = width;
  let h = height;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Try WebP first, fall back to JPEG
  const formats = ['image/webp', 'image/jpeg'] as const;
  for (const format of formats) {
    let quality = 0.85;
    while (quality >= 0.3) {
      const blob = await canvas.convertToBlob({ type: format, quality });
      if (blob.size <= maxBytes) return blob;
      quality -= 0.15;
    }
  }

  // Last resort: return whatever we got at lowest quality
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.3 });
}
