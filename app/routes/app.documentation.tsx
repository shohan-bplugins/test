import { useCallback, useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";

/** Hosted docs site, embedded below and linked as the escape hatch. */
const DOCS_URL = "https://apps.bplugins.com/docs/3d-viewer/";

/** How long to wait before offering the "open it directly" way out. */
const SLOW_LOAD_MS = 5000;

/** Never shrink below this, however cramped the viewport. */
const MIN_HEIGHT = 480;

/**
 * Sizes an element to the whole viewport: everything left below it vertically,
 * and edge to edge horizontally regardless of the page gutters it sits in.
 *
 * Neither half is something CSS can express here. The element sits inside the
 * admin's own layout, several containers deep, none of which are a flex or grid
 * parent this route controls, so `height: 100%` resolves against an `auto`
 * ancestor and collapses; a fixed `vh` fraction ignores the page heading above
 * the frame, overflowing on short viewports and leaving dead space on tall ones.
 * Width is the same story in reverse — the page centres its content inside
 * horizontal padding, so filling the window means cancelling an offset that only
 * exists at runtime.
 *
 * The vertical measurement reads the element's own top offset, which accounts
 * for whatever is actually above it. The horizontal one reads the *parent's*
 * left offset and the document's client width, never the element's own box: the
 * negative margin below moves the element itself, so measuring it would feed its
 * new position back into the next measurement and oscillate. `clientWidth` is
 * used rather than `100vw` because `vw` includes the scrollbar gutter, which
 * would push the frame into horizontal overflow.
 */
function useFillViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState<{
    height: number;
    width: number;
    offsetLeft: number;
  } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const parentLeft = el.parentElement?.getBoundingClientRect().left ?? 0;
    setBox({
      height: Math.max(MIN_HEIGHT, window.innerHeight - top),
      width: document.documentElement.clientWidth,
      offsetLeft: parentLeft,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);

    // The banner above the frame appears and disappears on its own schedule, and
    // the admin can reflow the page around us at any time; both move our top
    // offset without a resize event. Observing the parent covers those, and the
    // parent is unaffected by the sizing this hook applies to its child.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (observer && ref.current?.parentElement) {
      observer.observe(ref.current.parentElement);
    }

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { ref, box };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

function DocsEmbed() {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const { ref: frameBoxRef, box } = useFillViewport<HTMLDivElement>();

  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [loaded]);

  return (
    <>
      {/*
        The docs live on another domain, so a slow or blocked response would
        otherwise leave a merchant watching a spinner with no way out. After
        SLOW_LOAD_MS a banner offers the site directly, and it disappears the
        moment the frame does load.
      */}
      {!loaded && slow ? (
        <s-banner tone="warning" heading="This is taking longer than usual">
          <s-paragraph>
            The documentation site is slow to respond. You can open it in a new
            tab instead.
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            href={DOCS_URL}
            target="_blank"
            icon="external"
          >
            Visit docs
          </s-button>
        </s-banner>
      ) : null}

      {/*
        Plain elements, with no s-section around them: an iframe has no intrinsic
        height, the spinner has to sit on top of it, and the frame is meant to
        run edge to edge — a Section would re-impose the card's padding, border
        and radius the full-bleed sizing exists to escape. Polaris's Box is no
        help either, exposing neither a viewport-relative block size (SizeUnits
        is px/% only) nor any positioning props. The frame is already outside the
        design system, so the boxes that place it stay outside too rather than
        being faked with a component that cannot do the job.
      */}
      <div
        ref={frameBoxRef}
        style={{
          position: "relative",
          // Until the first measurement lands (SSR, and the first paint) the
          // viewport fractions are the closest guess available; both are
          // replaced on mount, before the frame has loaded anything.
          height: box ? `${box.height}px` : "80vh",
          minHeight: MIN_HEIGHT,
          width: box ? `${box.width}px` : "100%",
          // Cancels the page's left gutter, so the frame starts at the window
          // edge instead of at the content column's.
          marginInlineStart: box ? `-${box.offsetLeft}px` : undefined,
        }}
      >
        <iframe
          src={DOCS_URL}
          title="3D Viewer documentation"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
          allow="fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />

        {!loaded ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <s-stack direction="block" gap="base" alignItems="center">
              <s-spinner accessibilityLabel="Loading documentation" />
              <s-text color="subdued">Loading documentation…</s-text>
            </s-stack>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function Documentation() {
  return (
    <s-page heading="Documentation" inlineSize="large">
      <BackButton to="/app" label="Dashboard" />
      <s-button
        slot="primary-action"
        variant="primary"
        href={DOCS_URL}
        target="_blank"
        icon="external"
      >
        Open docs site
      </s-button>
      <SupportAction />

      <DocsEmbed />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
