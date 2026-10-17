import { useNavigation } from "@remix-run/react";
import { CustomImg } from "../utils/polarisWebComponents";
import { useState, useEffect } from "react";
import "../styles/documentation.css";

export default function Documentation() {
  const nav = useNavigation();
  const [isMounted, setIsMounted] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleIframeLoad = () => {
    setIsIframeLoaded(true);
  };

  const showSpinner = !isMounted || !isIframeLoaded;

  return (
    <>
      {showSpinner ? (
        <s-box class="doc-loading">
          <s-stack direction="block" gap="base" alignItems="center">
            {/* Branded spinner: the app's logo inside a rotating ring. Bespoke,
                so the ring keeps its own CSS; s-spinner has no image slot. */}
            <s-box class="doc-loader">
              <s-text class="doc-loader-ring" aria-hidden="true"  />
              <CustomImg src="/loader.png" alt="" />
            </s-box>
            <s-heading class="doc-loading-title">
              Preparing Documentation...
            </s-heading>
            <s-text color="subdued">
              Fetching the latest tutorials and guides
            </s-text>
          </s-stack>
        </s-box>
      ) : null}
      {isMounted ? (
        <iframe
          className="doc-frame"
          width="100%"
          src="https://apps.bplugins.com/docs/video-player-by-bplugins-2/overview"
          title="Video Player documentation"
          frameBorder="0"
          allow="picture-in-picture;"
          referrerPolicy="strict-origin-when-cross-origin"
          hidden={showSpinner}
          onLoad={handleIframeLoad}
        />
      ) : (
        /* Placeholder so the client's first paint matches the server render. */
        <s-box class="doc-frame-placeholder" />
      )}
    </>
  );
}
