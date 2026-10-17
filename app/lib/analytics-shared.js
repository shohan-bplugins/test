// Client-safe analytics constants. Importing this from a route file does NOT
// pull server-only code (prisma, geoip) into the client bundle.

export const ALL_PLAYERS_VALUE = "all";
export const COMING_SOON_PLAYER_TYPES = new Set(["playlist-audio"]);

export const PLAYER_TYPE_LABELS = {
  "single-audio": "Single Audio",
  "playlist-audio": "Playlist",
  "sticky-player": "Sticky Player",
  "sticky-single-button": "Sticky Single Button",
};
