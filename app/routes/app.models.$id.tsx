import { useEffect, useMemo, useState } from "react";
import type {
  LinksFunction,
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import { resolveAppOrigin } from "~/lib/app-origin.server";
import { syncModelLibrary } from "~/lib/model-library.server";
import { resolveFileUrl } from "~/lib/files.server";

import { ViewerPreview, type ViewerConfig } from "~/components/ViewerPreview";
import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import appStylesUrl from "~/app.css?url";
import { parseConfig } from "~/lib/viewer-config";
import { hotspotsAllowed } from "~/lib/hotspots.server";
import { HotspotsEditor, createHotspot } from "~/components/HotspotsEditor";
import { buildEmbedSnippet, type EmbedMode } from "~/lib/embed";
import { ViewerSettings } from "~/components/ViewerSettings";
import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import { useReviewPrompt } from "~/components/ReviewPrompt";
import { evaluateReviewPrompt } from "~/lib/review-prompt.server";
import { fieldValue, flag } from "~/components/polaris/helpers";

// Moved off root's global links: only the routes that mount ViewerPreview need
// view3d's stylesheet, and it still loads with the route so the canvas is never
// briefly unstyled.
export const links: LinksFunction = () => [
  // app.css is Tailwind plus the viewer's own styling. ViewerPreview is the
  // only thing left in the app that uses either, so it loads here rather than
  // globally — which also keeps Tailwind's preflight away from the Polaris
  // components every other admin page is built from.
  { rel: "stylesheet", href: appStylesUrl },
  { rel: "stylesheet", href: view3dStylesUrl },
];

type LoaderData = {
  model: {
    id: string;
    name: string;
    fileUrl: string;
    fileGid: string;
    createdAt: string;
  };
  config: ViewerConfig;
  appOrigin: string;
  /** Free plan: the Hotspots panel shows a PRO lock. */
  hotspotsLocked: boolean;
};

export const loader = async ({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const id = String(params.id ?? "");
  let model = await prisma.model3D.findFirst({
    where: { id, shop },
  });
  if (!model) {
    throw new Response("Model not found", { status: 404 });
  }

  if (!model.fileUrl) {
    const resolvedUrl = await resolveFileUrl(admin, model.fileGid);
    if (resolvedUrl) {
      model = await prisma.model3D.update({
        where: { id: model.id },
        data: { fileUrl: resolvedUrl },
      });
      // See the same backfill in app.models._index.tsx: a row gains a file URL
      // here, so the mirror the theme block reads needs refreshing. Not
      // awaited — the editor does not read the mirror, and the sync is several
      // sequential round trips (syncModelLibrary catches its own errors).
      void syncModelLibrary(admin, shop);
    }
  }

  return {
    model: {
      id: model.id,
      name: model.name,
      fileUrl: model.fileUrl,
      fileGid: model.fileGid,
      createdAt: model.createdAt.toISOString(),
    },
    config: parseConfig(model.config),
    // Read from the request rather than `window.location` so the share link can
    // be rendered on the server too — reading window during render would
    // mismatch on hydration.
    appOrigin: resolveAppOrigin(request),
    hotspotsLocked: !(await hotspotsAllowed(admin, shop)),
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const id = String(params.id ?? "");
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const existing = await prisma.model3D.findFirst({ where: { id, shop } });
  if (!existing) return { ok: false, error: "Model not found" };

  if (intent === "delete") {
    await prisma.model3D.delete({ where: { id } });
    await syncModelLibrary(admin, shop);
    return framedRedirect(request, "/app/models");
  }

  if (intent === "save") {
    const name = String(formData.get("name") ?? "").trim() || existing.name;
    const raw = String(formData.get("config") ?? "");
    // Validated like the product editor's, rather than stored as posted: it
    // reaches the storefront through the library metafield.
    const config = parseConfig(raw);
    // Hotspots are paid-only: on Free, keep exactly what was saved before.
    if (!(await hotspotsAllowed(admin, shop))) {
      config.hotspots = parseConfig(existing.config).hotspots;
    }
    await prisma.model3D.update({
      where: { id },
      data: {
        name,
        config: raw ? JSON.stringify(config) : null,
      },
    });
    // The mirror carries each model's saved config, so a settings change has to
    // be pushed for the theme block to pick it up.
    await syncModelLibrary(admin, shop);
    return {
      ok: true,
      message: "Saved",
      // A review moment. This model is in the library, so rule 5 is met.
      reviewPrompt: await evaluateReviewPrompt(admin, shop, "settings-saved", {
        libraryCount: 1,
      }),
    };
  }

  if (intent === "reset_config") {
    await prisma.model3D.update({
      where: { id },
      data: { config: null },
    });
    await syncModelLibrary(admin, shop);
    return { ok: true, message: "Settings reset to defaults" };
  }

  return { ok: false, error: "Unknown intent" };
};

// The public page that actually renders this model (app/routes/viewer.$id.tsx).
// This used to return the raw .glb URL with the config in the fragment, which
// just made the browser download or blank-screen the file — there was no page to
// render it, which is why the Preview button below had been commented out.
function buildViewerUrl(appOrigin: string, modelId: string): string {
  return `${appOrigin}/viewer/${modelId}`;
}

export default function ModelDetail() {
  const {
    model,
    config: savedConfig,
    appOrigin,
    hotspotsLocked,
  } = useLoaderData<typeof loader>();
  // Hotspots: placement mode, and "preview this one" in the live preview.
  const [placingHotspot, setPlacingHotspot] = useState(false);
  const [hotspotFocus, setHotspotFocus] = useState<{
    id: string;
    n: number;
  } | null>(null);

  const actionData = useActionData<typeof action>();
  useReviewPrompt(
    actionData && "reviewPrompt" in actionData ? actionData.reviewPrompt : null,
  );
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  const [name, setName] = useState(model.name);
  const [config, setConfig] = useState<ViewerConfig>(savedConfig);
  const [copying, setCopying] = useState<"id" | "link" | "embed" | null>(null);
  const [embedMode, setEmbedMode] = useState<EmbedMode>("responsive");
  // Which destructive action is awaiting confirmation, if any.
  const [pending, setPending] = useState<"reset" | "delete" | null>(null);

  /*
   * Resync local edits with whatever the loader last delivered — a different
   * model after navigation, or the same one after a save or reset.
   *
   * Keyed on a serialisation of the config, never on the object itself. A
   * dependency array compares by identity, and `savedConfig` comes off
   * useLoaderData, which hands back a fresh object on every render in the
   * production build. That made this effect run on every render, and
   * `setConfig` with a new object is always a state change, so it re-rendered
   * and ran again: an unbounded loop that rebuilt the DOM continuously. The
   * page still looked right, but every button in the page header was destroyed
   * and recreated faster than a click could land on one — Preview, Reset,
   * Delete and Support all dead, while the page body appeared to work because
   * its controls are re-created just as fast and never need to survive a click.
   *
   * Dev did not show it: its loader data kept a stable identity, so the deps
   * never changed and the effect ran once. Only the built app looped.
   */
  const savedConfigKey = JSON.stringify(savedConfig);
  useEffect(() => {
    setName(model.name);
    setConfig(savedConfig);
    // savedConfig is intentionally absent: savedConfigKey is its value-identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id, model.name, savedConfigKey]);

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? "Saved");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const dirty = useMemo(
    () =>
      name !== model.name ||
      JSON.stringify(config) !== JSON.stringify(savedConfig),
    [name, config, model.name, savedConfig],
  );

  function handleSave() {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("name", name);
    fd.set("config", JSON.stringify(config));
    submit(fd, { method: "post" });
  }

  /** Throw away unsaved edits and go back to what the loader delivered. */
  function handleDiscard() {
    setName(model.name);
    setConfig(savedConfig);
  }

  function confirmPending() {
    const fd = new FormData();
    fd.set("intent", pending === "reset" ? "reset_config" : "delete");
    submit(fd, { method: "post" });
    setPending(null);
  }

  const COPY_LABELS: Record<"id" | "link" | "embed", string> = {
    id: "Model ID copied",
    link: "Viewer link copied",
    embed: "Embed code copied",
  };

  async function handleCopy(value: string, kind: "id" | "link" | "embed") {
    setCopying(kind);
    try {
      await navigator.clipboard.writeText(value);
      shopify.toast.show(COPY_LABELS[kind]);
    } catch {
      shopify.toast.show("Couldn't copy", { isError: true });
    } finally {
      setTimeout(() => setCopying(null), 700);
    }
  }

  const viewerUrl = buildViewerUrl(appOrigin, model.id);
  const embedSnippet = buildEmbedSnippet(viewerUrl, config.height, embedMode);

  return (
    <s-page heading={model.name}>
      <BackButton to="/app/models" label="3D model library" />

      {/*
        The admin's own contextual save bar, not a Save button in the page
        header. It is what Built for Shopify expects an editing screen to use:
        it takes over the admin's top bar while there are unsaved changes and
        intercepts navigation away from them, which a page-level button cannot
        do. `open` is safe to pass as a real boolean here — SaveBar is a React
        component that calls show()/hide() itself, not a bare custom element.
      */}
      <SaveBar id="model-save-bar" open={dirty}>
        <button
          variant="primary"
          onClick={handleSave}
          loading={submitting ? "" : undefined}
        />
        <button onClick={handleDiscard} />
      </SaveBar>

      {/*
        A real link, not a window.open() in a click handler. This page runs
        inside the admin's iframe, and a scripted popup from there is at the
        mercy of the embedder: the frame has to have been granted popups, and
        the browser has to credit the call to the user's gesture. When either
        fails, window.open returns null and the click does nothing at all — no
        tab, no error — which is exactly how this button was failing. An anchor
        with target="_blank" is the path App Bridge itself handles, so the admin
        opens the tab on the app's behalf; it is also what every other
        open-in-a-new-tab button in this app already uses.
      */}
      {/*
        Disabled while there are unsaved edits, because Preview opens
        /viewer/:id — which renders the model's *saved* config, not what is on
        screen. Clicking it mid-edit opened a tab that disagreed with the
        settings panel beside it, which reads as the preview being broken
        rather than as the edits not being saved yet. The save bar is showing
        whenever this is disabled, so the reason is already on screen.
      */}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="external"
        href={viewerUrl}
        target="_blank"
        disabled={flag(dirty)}
      >
        Preview
      </s-button>
      <s-button
        slot="secondary-actions"
        icon="reset"
        disabled={flag(submitting)}
        onClick={() => setPending("reset")}
      >
        Reset settings
      </s-button>
      <s-button
        slot="secondary-actions"
        tone="critical"
        icon="delete"
        disabled={flag(submitting)}
        onClick={() => setPending("delete")}
      >
        Delete
      </s-button>
      <SupportAction />

      <ConfirmModal
        id="model-confirm"
        open={pending !== null}
        heading={
          pending === "delete" ? "Delete model?" : "Reset viewer settings?"
        }
        confirmLabel={pending === "delete" ? "Delete model" : "Reset settings"}
        loading={submitting}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      >
        <s-paragraph>
          {pending === "delete"
            ? "This removes the model from your library. The .glb file itself stays in Shopify Files, and any page still embedding it will stop rendering."
            : "Every viewer setting for this model goes back to its default. The model file and its name are untouched."}
        </s-paragraph>
      </ConfirmModal>

      <s-section slot="aside" heading="Details">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Name"
            value={name}
            placeholder="My 3D model"
            onInput={(e) => setName(fieldValue(e))}
          />
          {/*
            The copy button sits beside the field rather than inside it: the
            React bindings for s-text-field expose no children, so its
            `accessory` slot is unreachable from JSX.

            `1fr auto` rather than a flex row — the field takes the width that
            is left and the button hugs the right edge. As a plain inline stack
            neither child grew, so the button sat immediately after a
            shrink-wrapped input instead of at the end of the row. alignItems
            "end" is what lines the button up with the input rather than with
            the label above it.
          */}
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="small"
            alignItems="end"
            inlineSize="100%"
          >
            <s-text-field
              label="Model ID"
              value={model.id}
              readOnly={flag(true)}
            />
            <s-button
              icon={copying === "id" ? "check" : "clipboard"}
              accessibilityLabel="Copy model ID"
              onClick={() => handleCopy(model.id, "id")}
            />
          </s-grid>
          {/*
            The hint is a paragraph under the row, not the field's own
            `details`. Details renders inside the field, below the input, which
            made the field taller than the button beside it — and since the row
            aligns to the end, the button dropped to the bottom of the help text
            instead of sitting on the input line.
          */}
          <s-paragraph color="subdued">
            This model’s permanent identifier — the same id used in its viewer
            link below.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Share & embed">
        <s-paragraph color="subdued">
          A public page that renders this model with the settings saved below.
          Anyone with the link can view it; it isn’t indexed by search engines.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="small"
            alignItems="end"
            inlineSize="100%"
          >
            <s-text-field
              label="Viewer link"
              value={viewerUrl}
              readOnly={flag(true)}
            />
            <s-button
              icon={copying === "link" ? "check" : "clipboard"}
              accessibilityLabel="Copy viewer link"
              onClick={() => handleCopy(viewerUrl, "link")}
            />
          </s-grid>

          {/*
            A select rather than a two-option choice list. s-choice-list carries
            its selection in a `values` *array*, and React 18 can only set
            string attributes on a custom element — the array would arrive
            stringified and the control would never reflect its own state.
          */}
          <s-select
            label="Embed size"
            value={embedMode}
            onInput={(e) => setEmbedMode(fieldValue(e) as EmbedMode)}
          >
            <s-option value="responsive">Responsive</s-option>
            <s-option value="fixed">{`Fixed ${config.height}px`}</s-option>
          </s-select>

          {/*
            The copy button goes on the label line, not beside the field.

            The single-line fields above can share a row with their button
            because the input is one line tall and the button lines up with it.
            A snippet is four rows tall, so the same treatment left the button
            hanging off the bottom corner of a tall box — and worse, took width
            away from the one field that needs it most, in what is now the
            narrow column. Above the box it costs the snippet no width at all.

            The text area keeps its real label for assistive tech and hides it
            visually, so the heading beside the button is not a second,
            competing name for the same field.
          */}
          <s-stack direction="block" gap="small-500">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="small"
              alignItems="center"
              inlineSize="100%"
            >
              <s-text>Embed code</s-text>
              <s-button
                variant="tertiary"
                icon={copying === "embed" ? "check" : "clipboard"}
                accessibilityLabel="Copy embed code"
                onClick={() => handleCopy(embedSnippet, "embed")}
              />
            </s-grid>
            <s-text-area
              label="Embed code"
              labelAccessibilityVisibility="exclusive"
              value={embedSnippet}
              readOnly={flag(true)}
              rows={embedMode === "responsive" ? 4 : 2}
            />
          </s-stack>

          <s-paragraph color="subdued">
            Paste into any page that accepts HTML — a Shopify page in the{" "}
            <s-text type="strong">&lt;/&gt;</s-text> HTML view, a theme Custom
            Liquid section, a blog post, or a site outside Shopify.{" "}
            <s-text type="strong">Responsive</s-text> keeps a 4:3 box at any
            width; <s-text type="strong">Fixed</s-text> pins the saved height.
          </s-paragraph>
          <s-paragraph color="subdued">
            Append <code>?bg=101014</code> to the URL to match a dark page (hex,
            no <code>#</code>), or <code>?autorotate=0</code> to stop it
            spinning — per placement, without touching the saved settings.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Viewer settings">
        <s-paragraph color="subdued">
          Saved with this library entry, and used by the public viewer page.
        </s-paragraph>
        <ViewerSettings config={config} onChange={setConfig} />
      </s-section>

      <s-section slot="aside" heading="Hotspots">
        <HotspotsEditor
          config={config}
          onChange={setConfig}
          placing={placingHotspot}
          onPlacingChange={setPlacingHotspot}
          onPreview={(id) =>
            setHotspotFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
          }
          locked={hotspotsLocked}
        />
      </s-section>

      {/*
        Sticky, so the canvas stays in view while the merchant works down the
        settings column beside it — the whole point of a live preview is seeing
        a change land, which is no use if tweaking a control near the bottom of
        the form has scrolled the viewer off screen.

        A plain div, and wrapping the section rather than sitting inside it:
        Polaris's Box exposes no position or inset props, and the sticky element
        has to be the column's own child so its containing block is the full
        column — the two columns share a grid row, so this one is as tall as the
        settings beside it and there is room to stick. Nested inside the section
        it could only stick within that card's own height, which is to say not
        at all.
      */}
      <div style={{ position: "sticky", top: 16 }}>
        <s-section heading="Live preview">
          <s-paragraph color="subdued">
            Updates instantly. Save to persist.
          </s-paragraph>
          {model.fileUrl ? (
            <ViewerPreview
              modelUrl={model.fileUrl}
              config={config}
              arShareUrl={viewerUrl}
              onLayoutChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              placingHotspot={placingHotspot}
              onPlaceHotspot={(anchor) => {
                setConfig((c) => ({
                  ...c,
                  hotspots: [
                    ...c.hotspots,
                    createHotspot(anchor, c.hotspots.length),
                  ],
                }));
                setPlacingHotspot(false);
              }}
              focusHotspotId={hotspotFocus?.id ?? null}
              focusNonce={hotspotFocus?.n ?? 0}
            />
          ) : (
            <s-banner tone="info">
              <s-paragraph>
                This file is still processing in Shopify Files. Refresh in a
                moment to see the preview.
              </s-paragraph>
            </s-banner>
          )}
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
