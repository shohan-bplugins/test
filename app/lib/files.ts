import en from "~/i18n/locales/en/files.json";
import { interpolate, type Vars } from "~/i18n/format";

/**
 * The messages below are merchant-facing, so each helper takes the caller's
 * translator for the "files" namespace — useT("files") in a component,
 * getServerT(request, "files") in an action. English when left out.
 */
export type FilesT = (key: string, vars?: Vars) => string;
export const englishFiles: FilesT = (key, vars) =>
  interpolate((en as Record<string, string>)[key] ?? key, "en", vars);

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
export function describeSaving(
  originalSize: number,
  size: number,
  t: FilesT = englishFiles,
): string | null {
  if (!(originalSize > 0) || size >= originalSize) return null;
  const pct = Math.round((1 - size / originalSize) * 100);
  return t("saving", {
    from: formatFileSize(originalSize),
    to: formatFileSize(size),
    pct,
  });
}

/**
 * What can be told before upload. With `optimize` on, the size check is only
 * the raw cap — whether the file fits in 20 MB is known after compression
 * (finalSizeError). With it off the file is stored as it is, so 20 MB applies
 * up front.
 */
export function validateModelFile(
  file: File,
  optimize = false,
  t: FilesT = englishFiles,
): string | null {
  if (!isValidModelFilename(file.name)) {
    return t("onlyGlb");
  }
  if (file.size === 0) {
    return t("chooseFile");
  }
  if (optimize) {
    if (file.size > MAX_RAW_UPLOAD_BYTES) {
      return t("tooBigRaw", { size: formatFileSize(file.size), max: MAX_RAW_UPLOAD_MB });
    }
  } else if (file.size > MAX_MODEL_FILE_SIZE_BYTES) {
    return t("tooBig", { size: formatFileSize(file.size), max: MAX_MODEL_FILE_SIZE_MB });
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
  t: FilesT = englishFiles,
): string | null {
  if (storedSize <= MAX_MODEL_FILE_SIZE_BYTES) return null;
  return storedSize < originalSize
    ? t("stillTooBig", {
        size: formatFileSize(storedSize),
        original: formatFileSize(originalSize),
        max: MAX_MODEL_FILE_SIZE_MB,
      })
    : t("cantShrink", { size: formatFileSize(storedSize), max: MAX_MODEL_FILE_SIZE_MB });
}
