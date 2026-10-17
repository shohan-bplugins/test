import React, { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import "./../styles/docs.css";
import "../styles/styles.css";
import { useSupport } from "../components/SupportForm/SupportProvider";

const DOCS_URL =
  "https://apps.bplugins.com/docs/audio-player-by-bplugins-new/overview/";
// If the docs site hasn't loaded by then it's probably slow or blocking the
// embed — offer to open it in a new tab instead.
const SLOW_LOAD_MS = 15000;

export default function Documentation() {
  const openSupport = useSupport();
  const navigate = useNavigate();
  const [isMounted, setIsMounted] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const timer = setTimeout(() => setIsSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  const showLoading = !isMounted || !isIframeLoaded;
  const openInNewTab = () =>
    window.open(DOCS_URL, "_blank", "noopener,noreferrer");

  return (
    <>
      <ui-title-bar title="Documentation">
        <button onClick={openInNewTab}>Open in new tab</button>
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          Dashboard
        </button>
      </ui-title-bar>

      {/* The docs area has its full size from the first paint. The loading
          state sits on top of it and the iframe (from the external bPlugins
          site) is invisible until loaded, so nothing moves when it appears. */}
      <div className="docs-frame-wrap">
        {isMounted ? (
          <iframe
            className={`docs-frame${showLoading ? " is-loading" : ""}`}
            src={DOCS_URL}
            title="Audio Player by bPlugins documentation"
            allow="clipboard-write; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setIsIframeLoaded(true)}
          />
        ) : null}
        {showLoading ? (
          <div className="docs-loading">
            <s-box padding="base">
              <s-section>
                {isSlow ? (
                  <s-banner
                    tone="warning"
                    heading="Documentation is taking a while"
                  >
                    <s-stack gap="small">
                      <s-paragraph>
                        The documentation site is slow to load here or may be
                        blocked in the embedded view. You can read it in a new
                        tab.
                      </s-paragraph>
                      <s-stack direction="inline">
                        <s-button icon="external" onClick={openInNewTab}>
                          Open in new tab
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </s-banner>
                ) : (
                  <s-stack gap="small" alignItems="center">
                    <s-spinner
                      size="large"
                      accessibilityLabel="Loading documentation"
                    ></s-spinner>
                    <s-heading>Loading documentation</s-heading>
                    <s-text color="subdued">Please wait…</s-text>
                  </s-stack>
                )}
              </s-section>
            </s-box>
          </div>
        ) : null}
      </div>
    </>
  );
}
