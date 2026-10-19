import { useNavigate } from "@remix-run/react";

/**
 * Returns a back handler that goes to the previous page when there's in-app
 * history to return to, and otherwise falls back to a destination (the
 * dashboard by default). React Router tracks the current position in the
 * history stack via `window.history.state.idx`; it's 0 (or missing) when the
 * page was opened directly, meaning there's nowhere to go "back" to.
 *
 * @param {string} fallback  where to go when there's no back history.
 */
export function useGoBack(fallback = "/app") {
  const navigate = useNavigate();
  return () => {
    const idx =
      typeof window !== "undefined" ? window.history.state?.idx : undefined;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };
}
