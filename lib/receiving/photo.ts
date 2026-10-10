const PHOTO_MAX_SIDE = 1600;

/** Phone photos are downscaled to a JPEG so they stay well under the upload size limits. Browser only. */
export async function toJpeg(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "proof.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** A typed number ("1,5" or "1.5"); null when empty, invalid or outside 0..max. */
export function parseDecimal(value: string, max: number): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}
