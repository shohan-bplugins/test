import { useEffect, useState } from "react";

const STORAGE_KEY = "viewer3d:optimize-uploads";

/**
 * Whether uploads are optimised (optimize-model.server.ts). On unless the
 * merchant turned it off, which is remembered in this browser — it's a
 * per-person working preference, not a shop setting anyone else depends on.
 *
 * Starts true on the server and the first client render alike, then reads
 * storage after mount, so the two renders agree and hydration doesn't break.
 */
export function useOptimizePreference(): [boolean, (on: boolean) => void] {
  const [optimize, setOptimize] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "0") setOptimize(false);
    } catch {
      // Storage blocked in the admin iframe: stays on.
    }
  }, []);
  const update = (on: boolean) => {
    setOptimize(on);
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // Remembered for this page only.
    }
  };
  return [optimize, update];
}

export const OPTIMIZE_DETAILS =
  "Compresses the geometry and shrinks oversized textures before upload — usually 50–90% smaller, so models load faster for shoppers. Turn off to upload the file exactly as it is.";
