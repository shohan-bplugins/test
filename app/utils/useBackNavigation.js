import { useEffect, useState } from "react";
import { useLocation, useNavigate, useNavigation } from "@remix-run/react";

/**
 * Shared "back" button behaviour for the app header arrows.
 *
 * - goBack(): navigates to the previous page in history. If there is no
 *   in-app history to go back to (e.g. the page was opened directly / is the
 *   first entry in the session), it falls back to `fallback` (Dashboard).
 * - isNavigating: true only while a back navigation triggered by goBack() is
 *   in flight, so the header can swap the arrow for a spinner. (We can't match
 *   on a target pathname like before because navigate(-1) has no fixed target.)
 */
export function useBackNavigation(fallback = "/app") {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();
  const [pending, setPending] = useState(false);

  // Clear the pending flag once navigation settles.
  useEffect(() => {
    if (navigation.state === "idle" && pending) {
      setPending(false);
    }
  }, [navigation.state, pending]);

  const goBack = () => {
    setPending(true);
    // React Router gives the very first history entry the key "default".
    // Anything else means we navigated within the app and can safely go back.
    if (location.key && location.key !== "default") {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };

  const isNavigating = pending && navigation.state === "loading";

  return { goBack, isNavigating };
}
