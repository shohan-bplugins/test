/*
 * The app's one loading indicator: public/cube-loader.gif.
 *
 * A plain <img>, not an s-spinner, so it works before polaris.js has defined
 * the s-* elements (the boot splash) and looks the same everywhere. Sizing and
 * the reduced-motion fallback live in critical.css under .cube-loader.
 */
import cubeLoaderUrl from "~/assets/cube-loader.gif?url";

/*
 * Imported through Vite rather than served from /public so the URL is
 * content-hashed (/assets/cube-loader-<hash>.gif). react-router-serve sends
 * hashed assets as `immutable, max-age=1y`, so the browser downloads the gif
 * once and reuses it from cache on every later page load. root.tsx also
 * preloads it, so it is already in cache before the first loader renders.
 */
export { cubeLoaderUrl };

export type CubeLoaderSize = "small" | "base" | "large";

export function CubeLoader({
  size = "base",
  label = "Loading",
}: {
  size?: CubeLoaderSize;
  label?: string;
}) {
  return (
    <img
      className="cube-loader"
      data-size={size}
      src={cubeLoaderUrl}
      alt={label}
      width={256}
      height={256}
      decoding="async"
    />
  );
}
