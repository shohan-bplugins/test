// Display helpers for the audio picker cards.

const MIME_EXT = {
  "audio/mpeg": "MP3",
  "audio/mp3": "MP3",
  "audio/mp4": "M4A",
  "audio/x-m4a": "M4A",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
  "audio/ogg": "OGG",
  "audio/flac": "FLAC",
  "audio/aac": "AAC",
};

const fileNameFromUrl = (url) => {
  try {
    const last = new URL(url).pathname.split("/").pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
};

// { name: "tutorial_narration_full", ext: "MP3" }
export function audioLabel(node) {
  const raw = node?.alt || fileNameFromUrl(node?.url) || "Audio file";
  const dot = raw.lastIndexOf(".");
  const hasExt = dot > 0 && raw.length - dot <= 5;
  const name = hasExt ? raw.slice(0, dot) : raw;
  const ext = hasExt
    ? raw.slice(dot + 1).toUpperCase()
    : MIME_EXT[node?.mimeType] || "";
  return { name, ext };
}
