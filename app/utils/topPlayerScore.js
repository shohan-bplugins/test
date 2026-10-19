// ── "Top player" ranking requirement ────────────────────────────────────────
//
// REQUIREMENT: The "top player" / "top video" is NOT ranked by play count alone.
// It is ranked by a COMPOSITE score that combines three signals, so a video that
// merely autoplays a lot can't outrank one people actually choose and watch:
//
//   1. total plays       — how often the video started playing
//   2. unique viewers    — distinct (device + network) people who watched it
//   3. total watch time  — seconds actually watched across all plays
//
// Because the three are in very different units, each is normalized to the
// best-performing video in the set (a 0–1 share of the max), then summed with
// equal weight:
//
//   score = plays/maxPlays + viewers/maxViewers + watchSeconds/maxWatchSeconds
//
// The highest score is the top player. Ties break on plays, then watch time.
// Adjust the weights below to bias the ranking toward one signal.
export const TOP_PLAYER_WEIGHTS = { plays: 1, viewers: 1, watch: 1 };

// One unique view = one distinct (device, network) pair. Mirrors the analytics
// page so viewer counts agree everywhere. Rows missing both ids are skipped.
function uniqueViewerKey(p) {
  return p.visitorId || p.ipHash ? `${p.visitorId || ""}|${p.ipHash || ""}` : null;
}

// Aggregate raw videoPlay rows into per-video stats, then rank by the composite
// score above. `titleFor(videoId, row)` optionally resolves a display title;
// without it the row's stored videoTitle is used.
export function rankVideosByScore(rows, titleFor) {
  const map = new Map();
  for (const p of rows) {
    let v = map.get(p.videoId);
    if (!v) {
      v = { videoId: p.videoId, title: "", plays: 0, viewers: new Set(), watchSeconds: 0 };
      map.set(p.videoId, v);
    }
    v.plays += 1;
    v.watchSeconds += p.watchedSeconds || 0;
    const k = uniqueViewerKey(p);
    if (k) v.viewers.add(k);
    const t = titleFor ? titleFor(p.videoId, p) : p.videoTitle;
    if (t) v.title = t;
  }

  const list = [...map.values()].map((v) => ({
    videoId: v.videoId,
    title: v.title || "Untitled",
    plays: v.plays,
    unique: v.viewers.size,
    watchSeconds: v.watchSeconds,
  }));

  return rankAggregatedVideos(list);
}

// Same composite ranking, but for per-video stats that were aggregated in the
// database rather than by walking raw rows. Lets a caller push the grouping
// into MongoDB (one row per video) instead of pulling every play into Node.
// Expects: { videoId, title, plays, unique, watchSeconds }.
export function rankAggregatedVideos(list) {
  const maxPlays = Math.max(1, ...list.map((v) => v.plays));
  const maxViewers = Math.max(1, ...list.map((v) => v.unique));
  const maxWatch = Math.max(1, ...list.map((v) => v.watchSeconds));
  const w = TOP_PLAYER_WEIGHTS;

  return list
    .map((v) => ({
      ...v,
      title: v.title || "Untitled",
      score:
        w.plays * (v.plays / maxPlays) +
        w.viewers * (v.unique / maxViewers) +
        w.watch * (v.watchSeconds / maxWatch),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.plays - a.plays || b.watchSeconds - a.watchSeconds,
    );
}

// Compact human watch-time label (e.g. "45s", "3m 20s", "1h 4m").
export function formatWatchSeconds(total) {
  const s = Math.max(0, Math.round(total || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
