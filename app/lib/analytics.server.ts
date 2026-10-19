import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Analytics configuration.
 *
 * The IDs below are the defaults; an env var of the same name overrides either
 * one, and setting it to "off" disables that tracker outright:
 *
 *   GA_MEASUREMENT_ID=G-XXXXXXXXXX     # Google Analytics 4 measurement ID
 *   CLARITY_PROJECT_ID=abcdefghij      # Microsoft Clarity project ID
 *
 * They are checked in rather than left env-only because they aren't secrets —
 * both are printed verbatim into the page's HTML for every visitor to read, and
 * neither grants access to anything. Env-only cost us more than it bought: the
 * production server had neither var (`.env` is gitignored, so it never shipped,
 * and the host injects nothing), which silently disabled both trackers with no
 * symptom other than empty dashboards.
 */
const DEFAULT_GA_MEASUREMENT_ID = "G-K6ZPR6XT8Z";
const DEFAULT_CLARITY_PROJECT_ID = "xz01h8vzcg";

export type AnalyticsConfig = {
  gaMeasurementId: string | null;
  clarityProjectId: string | null;
};

/*
 * Both IDs end up inside an inline <script>, so anything that isn't a plain
 * identifier is dropped rather than escaped. These are opaque vendor IDs — a
 * quote or angle bracket in one means it was mistyped, not that it needs
 * encoding.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/*
 * `.env` fallback, for hosts that don't inject env vars into the process.
 *
 * Nothing loads `.env` in production: `shopify app dev` does it locally, and
 * `react-router-serve` has no dotenv step at all (it only defaults NODE_ENV).
 * So uploading `.env` to a server does nothing — a surprise worth absorbing
 * here, since these two IDs are non-secret and optional.
 *
 * Deliberately *not* `process.loadEnvFile()`: that mutates process.env
 * globally, so a stale SHOPIFY_APP_URL sitting in a deployed `.env` could
 * silently break OAuth. This reads the file and pulls out one key, touching
 * nothing else. Real env vars always win.
 */
let envFileCache: Map<string, string> | null = null;

/*
 * cwd is the obvious place to look, but a panel-managed host (cPanel/Passenger,
 * pm2 with a different `cwd`) can start the process anywhere. The bundle always
 * lives at <root>/build/server/, so walking up from this module finds the
 * project root even when cwd doesn't.
 */
function envFileCandidates(): string[] {
  const paths = [resolve(process.cwd(), ".env")];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    paths.push(resolve(here, "../../.env"), resolve(here, "../.env"));
  } catch {
    // import.meta.url unavailable — cwd is the only candidate.
  }
  return paths;
}

function readEnvFile(): Map<string, string> {
  if (envFileCache) return envFileCache;
  const parsed = new Map<string, string>();
  for (const path of envFileCandidates()) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue; // Not here — try the next candidate.
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !parsed.has(key)) parsed.set(key, value);
    }
    break;
  }
  envFileCache = parsed;
  return parsed;
}

// Real env vars win; `.env` is the fallback. Every setting here goes through
// this, so a key works the same wherever it is written — `ANALYTICS_IN_DEV`
// used to read `process.env` directly, which meant putting it in `.env` (the
// one place the file's own comments point you at) silently did nothing.
function readSetting(name: string): string | undefined {
  return (process.env[name] ?? readEnvFile().get(name))?.trim();
}

function readId(name: string, fallback: string): string | null {
  const value = readSetting(name);
  // Unset means "use the default", so an env var is the only way to turn a
  // tracker off — hence an explicit opt-out keyword. `SAFE_ID` would accept
  // "off" as a legitimate ID, so this has to be checked before validation.
  if (value === "off") return null;
  if (!value) return fallback;
  if (!SAFE_ID.test(value)) {
    console.warn(`[analytics] ignoring malformed ${name}, using default`);
    return fallback;
  }
  return value;
}

/*
 * Dev traffic is excluded on purpose, and not just to keep reports clean.
 *
 * `shopify app dev` serves the app through a throwaway cloudflare tunnel, and
 * `automatically_update_urls_on_dev` points Shopify at it. Clarity stores the
 * DOM plus the *URL* of each stylesheet and re-fetches it at playback time — so
 * a session recorded on a tunnel replays as unstyled HTML the moment that
 * tunnel dies, which is the moment you stop the dev server. Those recordings
 * are worse than useless: they look like a CSS bug in the app.
 *
 * Set ANALYTICS_IN_DEV=1 to record anyway (useful only while verifying the
 * tags actually fire — the replays will still be unstyled).
 *
 * Note the test is `=== "development"` rather than `!== "production"`. A bare
 * `node build/server/index.js` under Passenger/pm2 leaves NODE_ENV unset, and
 * requiring an explicit "production" turned every such host into a silently
 * untracked one. `shopify app dev` always sets "development", so opting out on
 * that exact value is both sufficient and the safer default.
 */
function trackingAllowed(): boolean {
  if (process.env.NODE_ENV !== "development") return true;
  const optIn = readSetting("ANALYTICS_IN_DEV");
  return optIn === "1" || optIn === "true";
}

/*
 * Logged once per boot. Whether the tags are live is otherwise invisible until
 * you go looking in Clarity hours later, and both remaining ways to end up
 * untracked — a dev server, or an explicit `off` — look identical from outside.
 */
let logged = false;

function logStatusOnce(config: AnalyticsConfig, allowed: boolean): void {
  if (logged) return;
  logged = true;
  if (!allowed) {
    console.log(
      `[analytics] disabled (NODE_ENV=${process.env.NODE_ENV ?? "unset"}; set ANALYTICS_IN_DEV=1 to force)`
    );
    return;
  }
  console.log(
    `[analytics] GA=${config.gaMeasurementId ?? "off"} Clarity=${config.clarityProjectId ?? "off"}`
  );
}

export function getAnalyticsConfig(): AnalyticsConfig {
  if (!trackingAllowed()) {
    const off = { gaMeasurementId: null, clarityProjectId: null };
    logStatusOnce(off, false);
    return off;
  }
  const config = {
    gaMeasurementId: readId("GA_MEASUREMENT_ID", DEFAULT_GA_MEASUREMENT_ID),
    clarityProjectId: readId("CLARITY_PROJECT_ID", DEFAULT_CLARITY_PROJECT_ID),
  };
  logStatusOnce(config, true);
  return config;
}
