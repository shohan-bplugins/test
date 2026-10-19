import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { createRoot } from "react-dom/client";

startTransition(() => {
  createRoot(document).render(
    <StrictMode>
      <RemixBrowser
        future={{
          v7_fetcherPersist: true,
          v7_normalizeFormMethod: true,
          v7_partialHydration: true,
          v7_relativeSplatPath: true,
        }}
      />
    </StrictMode>,
  );
});
