const ACCEPTED_MODEL_EXTENSIONS = [".glb", ".gltf"];

// @egjs/view3d only ships a glTF loader, so accepted and previewable formats
// are the same set.
const PREVIEWABLE_MODEL_EXTENSIONS = ACCEPTED_MODEL_EXTENSIONS;

function endsWithAny(lower: string, extensions: string[]): boolean {
  return extensions.some((ext) => lower.endsWith(ext));
}

export function isValidModelFilename(name: string): boolean {
  return endsWithAny(name.toLowerCase(), ACCEPTED_MODEL_EXTENSIONS);
}

export function isPreviewableModelUrl(url: string): boolean {
  const withoutQuery = url.split("?")[0] ?? url;
  return endsWithAny(withoutQuery.toLowerCase(), PREVIEWABLE_MODEL_EXTENSIONS);
}

/** The most a stored model may weigh — what ends up in Shopify Files. */
export const MAX_MODEL_FILE_SIZE_MB = 20;
export const MAX_MODEL_FILE_SIZE_BYTES = MAX_MODEL_FILE_SIZE_MB * 1024 * 1024;

/**
 * The most an upload may weigh *before* optimisation. The 20 MB cap applies to
 * the file that is stored, so with optimisation on a bigger file is accepted
 * and judged on what it compresses to (finalSizeError). This outer cap is what
 * the server can sensibly hold in memory and process in one request, kept
 * under the ~100 MB request limit of the Cloudflare tunnel `shopify app dev`
 * uses (multipart overhead included).
 */
export const MAX_RAW_UPLOAD_MB = 90;
export const MAX_RAW_UPLOAD_BYTES = MAX_RAW_UPLOAD_MB * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** "Optimized 10.6 MB → 680 KB (94% smaller)", or null when nothing shrank. */
export function describeSaving(originalSize: number, size: number): string | null {
  if (!(originalSize > 0) || size >= originalSize) return null;
  const pct = Math.round((1 - size / originalSize) * 100);
  return `Optimized ${formatFileSize(originalSize)} → ${formatFileSize(size)} (${pct}% smaller)`;
}

/**
 * What can be told before upload. With `optimize` on, the size check is only
 * the raw cap — whether the file fits in 20 MB is known after compression
 * (finalSizeError). With it off the file is stored as it is, so 20 MB applies
 * up front.
 */
export function validateModelFile(file: File, optimize = false): string | null {
  if (!isValidModelFilename(file.name)) {
    return "Only .glb or .gltf files are supported";
  }
  if (file.size === 0) {
    return "Please choose a .glb or .gltf file";
  }
  if (optimize) {
    if (file.size > MAX_RAW_UPLOAD_BYTES) {
      return `File is ${formatFileSize(file.size)}. Max ${MAX_RAW_UPLOAD_MB} MB before optimization.`;
    }
  } else if (file.size > MAX_MODEL_FILE_SIZE_BYTES) {
    return `File is ${formatFileSize(file.size)}. Max accepted size is ${MAX_MODEL_FILE_SIZE_MB} MB — turn on "Optimize for faster loading" to upload larger files.`;
  }
  return null;
}

/** True when the file is too big to store as it is and relies on optimisation. */
export function needsOptimizationToFit(file: File): boolean {
  return file.size > MAX_MODEL_FILE_SIZE_BYTES;
}

/** The 20 MB check on the file that would actually be stored. */
export function finalSizeError(
  storedSize: number,
  originalSize: number,
): string | null {
  if (storedSize <= MAX_MODEL_FILE_SIZE_BYTES) return null;
  return storedSize < originalSize
    ? `Still ${formatFileSize(storedSize)} after optimization (from ${formatFileSize(originalSize)}). Max ${MAX_MODEL_FILE_SIZE_MB} MB.`
    : `File is ${formatFileSize(storedSize)} and couldn't be optimized smaller. Max ${MAX_MODEL_FILE_SIZE_MB} MB.`;
}
