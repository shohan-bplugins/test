/*
 * The vocabulary of the engagement counters, shared by the server
 * (viewer-stats.server.ts, the beacon routes) and the Analytics page.
 */

export const PLACEMENTS = ["product", "page", "embed"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number] | "unknown";

/** Toolbar controls whose use is counted, as stored event names. */
export const FEATURES = [
  "f_zoom",
  "f_fullscreen",
  "f_screenshot",
  "f_animation",
  "f_hotspot",
] as const;

/**
 * Event names as stored. Everything a beacon may send maps onto these, except
 * `dwell`, which the track route splits into dwell_s (seconds) and dwell_n
 * (viewers) so an average can be taken.
 */
export const EVENTS = [
  "view",
  "interact",
  "ar",
  "cart_3d",
  "cart_no3d",
  "dwell_s",
  "dwell_n",
  ...FEATURES,
] as const;
export type ViewerEvent = (typeof EVENTS)[number];

export function isPlacement(value: unknown): value is Placement {
  return PLACEMENTS.includes(value as Placement);
}
export function isViewerEvent(value: unknown): value is ViewerEvent {
  return EVENTS.includes(value as ViewerEvent);
}
export function toDevice(value: unknown): Device {
  return DEVICES.includes(value as (typeof DEVICES)[number])
    ? (value as Device)
    : "unknown";
}

/**
 * The Home page's analytics card: the last `days` days (7 on Free, 30 on paid
 * plans), compared with the same number of days before.
 */
export type AnalyticsOverview = {
  paid: boolean;
  days: number;
  views: number;
  viewsPrev: number;
  /** null on the Free plan — never computed, never sent. */
  interact: number | null;
  interactPrev: number | null;
  ar: number | null;
  arPrev: number | null;
  /** Daily views, oldest first, for the trend line. */
  daily: number[];
};
