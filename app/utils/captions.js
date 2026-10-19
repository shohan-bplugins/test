/**
 * Caption file helpers.
 *
 * Browsers only understand WebVTT in a <track> element — SRT is not a
 * supported format anywhere. So merchants may upload either, and we convert
 * SRT to VTT once at upload time and store only VTT. The storefront player
 * then never has to deal with SRT at all.
 */

// A caption cue timestamp line, e.g. "00:00:01,000 --> 00:00:04,000" (SRT) or
// "00:00:01.000 --> 00:00:04.000" (VTT). Hours are optional in both formats,
// and SRT files in the wild put varying whitespace around the arrow.
const CUE_TIME_LINE =
  /^\s*(\d{1,3}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}\s*-->\s*(\d{1,3}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}.*$/;

/** Strip a UTF-8 BOM and normalise CRLF/CR line endings to LF. */
function normalizeText(text) {
  return String(text || "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n");
}

/** True when the content already looks like a WebVTT file. */
export function isVtt(text) {
  return /^\s*WEBVTT/.test(normalizeText(text));
}

/**
 * Convert caption content to WebVTT.
 *
 * Accepts SRT or VTT and always returns VTT. Only commas inside cue-timing
 * lines become dots — commas in the subtitle text itself are left alone, which
 * a blanket replace would corrupt.
 *
 * @param {string} text raw file contents
 * @returns {string} WebVTT content
 */
export function toVtt(text) {
  const normalized = normalizeText(text).trim();
  if (!normalized) return "";

  const converted = normalized
    .split("\n")
    .map((line) =>
      CUE_TIME_LINE.test(line) ? line.replace(/,(\d{1,3})/g, ".$1") : line,
    )
    .join("\n");

  if (isVtt(converted)) return converted;
  return `WEBVTT\n\n${converted}`;
}

/**
 * Sanity-check that content actually contains caption cues, so a merchant who
 * picks the wrong file gets told instead of silently ending up with a track
 * that renders nothing.
 */
export function hasCues(text) {
  return normalizeText(text)
    .split("\n")
    .some((line) => CUE_TIME_LINE.test(line));
}

/**
 * Guess a language from a filename like "movie.en.srt" or "clip-pt-BR.vtt".
 *
 * The guess is only accepted when it's a language we actually offer —
 * otherwise any two letters before the extension (e.g. "promo.go.srt") would
 * become a bogus srclang that shows up as a meaningless entry in the player's
 * language menu. Returns "" when nothing recognisable is found.
 */
export function guessLangFromFilename(filename = "") {
  const match = String(filename).match(
    /[._-]([a-z]{2})(?:[-_][A-Za-z]{2})?\.(?:srt|vtt)$/i,
  );
  if (!match) return "";
  const code = match[1].toLowerCase();
  return CAPTION_LANGUAGES.some((l) => l.value === code) ? code : "";
}

/**
 * Caption languages offered in the picker, alphabetical by English name so a
 * merchant can scan to theirs quickly. `value` is the ISO 639-1 code that goes
 * into the <track srclang> attribute; `native` is the endonym, shown next to
 * the English name so non-English speakers can spot their language.
 */
export const CAPTION_LANGUAGES = [
  { value: "ar", label: "Arabic", native: "العربية" },
  { value: "bn", label: "Bengali", native: "বাংলা" },
  { value: "bg", label: "Bulgarian", native: "Български" },
  { value: "zh", label: "Chinese", native: "中文" },
  { value: "hr", label: "Croatian", native: "Hrvatski" },
  { value: "cs", label: "Czech", native: "Čeština" },
  { value: "da", label: "Danish", native: "Dansk" },
  { value: "nl", label: "Dutch", native: "Nederlands" },
  { value: "en", label: "English", native: "English" },
  { value: "et", label: "Estonian", native: "Eesti" },
  { value: "fi", label: "Finnish", native: "Suomi" },
  { value: "fr", label: "French", native: "Français" },
  { value: "de", label: "German", native: "Deutsch" },
  { value: "el", label: "Greek", native: "Ελληνικά" },
  { value: "he", label: "Hebrew", native: "עברית" },
  { value: "hi", label: "Hindi", native: "हिन्दी" },
  { value: "hu", label: "Hungarian", native: "Magyar" },
  { value: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { value: "it", label: "Italian", native: "Italiano" },
  { value: "ja", label: "Japanese", native: "日本語" },
  { value: "ko", label: "Korean", native: "한국어" },
  { value: "lv", label: "Latvian", native: "Latviešu" },
  { value: "lt", label: "Lithuanian", native: "Lietuvių" },
  { value: "ms", label: "Malay", native: "Bahasa Melayu" },
  { value: "no", label: "Norwegian", native: "Norsk" },
  { value: "fa", label: "Persian", native: "فارسی" },
  { value: "pl", label: "Polish", native: "Polski" },
  { value: "pt", label: "Portuguese", native: "Português" },
  { value: "ro", label: "Romanian", native: "Română" },
  { value: "ru", label: "Russian", native: "Русский" },
  { value: "sr", label: "Serbian", native: "Српски" },
  { value: "sk", label: "Slovak", native: "Slovenčina" },
  { value: "sl", label: "Slovenian", native: "Slovenščina" },
  { value: "es", label: "Spanish", native: "Español" },
  { value: "sw", label: "Swahili", native: "Kiswahili" },
  { value: "sv", label: "Swedish", native: "Svenska" },
  { value: "tl", label: "Tagalog", native: "Tagalog" },
  { value: "ta", label: "Tamil", native: "தமிழ்" },
  { value: "th", label: "Thai", native: "ไทย" },
  { value: "tr", label: "Turkish", native: "Türkçe" },
  { value: "uk", label: "Ukrainian", native: "Українська" },
  { value: "ur", label: "Urdu", native: "اردو" },
  { value: "vi", label: "Vietnamese", native: "Tiếng Việt" },
];

/** Look up a language entry by ISO code. */
export function findLanguage(code) {
  const c = String(code || "").toLowerCase();
  return CAPTION_LANGUAGES.find((l) => l.value === c) || null;
}

/** English name for a code, falling back to the raw code for custom ones. */
export function languageName(code) {
  return findLanguage(code)?.label || String(code || "").toUpperCase();
}

/** Options for a <select>, each showing "English — Endonym". */
export const CAPTION_LANGUAGE_OPTIONS = CAPTION_LANGUAGES.map((l) => ({
  value: l.value,
  label: l.native && l.native !== l.label ? `${l.label} — ${l.native}` : l.label,
}));
