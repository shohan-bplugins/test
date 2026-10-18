import { useEffect, useState } from "react";

/*
 * First-load cover for the embedded admin.
 *
 * The document arrives fully server-rendered but not yet alive: React still has
 * to hydrate, and Shopify's polaris.js / app-bridge.js still have to define the
 * s-* elements app.tsx renders (s-app-nav, s-link), which are inert unknown
 * elements until then. So the merchant sees a page that looks finished, has no
 * navigation, and ignores clicks. This overlay owns that window.
 *
 * Rendered on the server as well as the client — that is the whole point, it has
 * to be in the first painted frame — so the markup must be identical on both
 * sides. Hence the state starts at "visible" and only an effect moves it on.
 *
 * Boot only. Route-to-route waits are the nav-progress-bar in root.tsx; this
 * component unmounts for good once the app is live and never comes back.
 */

// Which custom elements have to exist before the shell is real. Registration is
// global once the script runs, so it does not matter that the current route may
// render none of them.
//
// s-page and s-section are in the list because the admin pages are built from
// them: waiting only on the nav would clear the splash while every page was
// still a run of unstyled text, which is the flash this component exists to
// prevent.
const REQUIRED_ELEMENTS = ["s-app-nav", "s-link", "s-page", "s-section"];

// Racing a timeout against those definitions is not belt-and-braces: outside the
// admin iframe (or with Shopify's CDN blocked) they may never be defined at all,
// and a splash that never clears is far worse than an unstyled s-link.
const READY_TIMEOUT_MS = 4000;

// Must stay in step with the .boot-splash opacity transition in app.css.
const FADE_MS = 220;

export function BootSplash() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");

  useEffect(() => {
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setPhase("fading");
    };

    const timer = setTimeout(reveal, READY_TIMEOUT_MS);

    if (typeof customElements === "undefined") {
      reveal();
    } else {
      // Settled either way — a rejected whenDefined still means "stop waiting".
      Promise.all(
        REQUIRED_ELEMENTS.map((name) => customElements.whenDefined(name))
      ).then(reveal, reveal);
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (phase !== "fading") return;
    const timer = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      className="boot-splash"
      data-fading={phase === "fading" ? "" : undefined}
      role="status"
      aria-label="Loading"
    >
      {/*
        A CSS ring, styled in app.css to match the admin's own spinner: a
        neutral ink arc, not the brand blue this used to draw. Nothing in here
        can be a Polaris component — the splash exists precisely because
        polaris.js has not defined those elements yet, so an s-spinner would be
        an inert unknown element for exactly as long as the splash is up.

        A bordered div works again now that the global border-radius reset in
        app.css is scoped to the 3D viewer; before that it rendered as a
        spinning square, which is why this used to be an SVG.
      */}
      <div className="boot-splash-spinner" aria-hidden="true" />
    </div>
  );
}
