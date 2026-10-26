import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncModelLibrary } from "~/lib/model-library.server";
import { invalidateDefsReady } from "~/lib/metafields.server";
// Not from the .server module: these are rendered in the UI below, and a route
// export other than loader/action/headers may not reference server-only code.
import {
  APP_LIBRARY_KEY,
  APP_LIBRARY_NAMESPACE,
  LIBRARY_KEY,
  LIBRARY_NAMESPACE,
} from "~/lib/model-library-constants";

import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import { LanguagePicker } from "~/components/LanguagePicker";
import { flag, useRouteNav } from "~/components/polaris/helpers";
import { useT, type TFunction } from "~/i18n";
import { getServerT } from "~/i18n/i18n.server";

type DefinitionStatus = {
  key: string;
  exists: boolean;
  storefrontAccess: boolean;
};

// What the theme block will actually find when it looks the id up. Checking the
// *definition* only proves the schema exists — a definition with storefront
// access and an empty value looks identical to a working one on this page, but
// resolves every Model ID to "not found" on the storefront. So read the value
// back too.
type LibraryContents = {
  present: boolean;
  count: number;
  sampleIds: string[];
  error: string | null;
  // Which namespace the value came from, so the page can say whether the block
  // is on the app-owned path or still limping along on the legacy one.
  source: "app" | "legacy" | null;
};

type LoaderData = {
  modelDef: DefinitionStatus;
  configDef: DefinitionStatus;
  libraryDef: DefinitionStatus;
  library: LibraryContents;
  dbModelCount: number;
};

// The model library metafield hangs off the SHOP, not a product, so all three
// helpers below take an owner type. It defaults to PRODUCT so the existing
// per-product definitions read exactly as before.
type MetafieldOwner = "PRODUCT" | "SHOP";

type ServerT = ReturnType<typeof getServerT>;

async function checkDefinition(
  admin: any,
  namespace: string,
  key: string,
  ownerType: MetafieldOwner = "PRODUCT",
): Promise<DefinitionStatus> {
  const res = await admin.graphql(
    `#graphql
      query MetafieldDef(
        $namespace: String!
        $key: String!
        $ownerType: MetafieldOwnerType!
      ) {
        metafieldDefinitions(
          first: 1
          namespace: $namespace
          key: $key
          ownerType: $ownerType
        ) {
          edges {
            node {
              id
              key
              access { storefront }
            }
          }
        }
      }`,
    { variables: { namespace, key, ownerType } },
  );
  const json = await res.json();
  const node = json?.data?.metafieldDefinitions?.edges?.[0]?.node;
  if (!node) return { key, exists: false, storefrontAccess: false };
  const storefront = node?.access?.storefront;
  return {
    key,
    exists: true,
    storefrontAccess:
      storefront === "PUBLIC_READ" || storefront === "PUBLIC_READ_WRITE",
  };
}

/**
 * Reads the library metafield back exactly as Liquid would see it, from the same
 * two namespaces the block tries and in the same order.
 *
 * This is the check that actually answers "why does my Model ID say not found?".
 * The definition alone can't: a definition holding an empty object looks
 * identical on this page to one holding a full library, but resolves every id to
 * nothing on the storefront.
 */
async function readOne(
  admin: any,
  namespace: string,
  key: string,
): Promise<{ raw: string | null; error: string | null }> {
  try {
    const res = await admin.graphql(
      `#graphql
        query LibraryValue($namespace: String!, $key: String!) {
          shop {
            metafield(namespace: $namespace, key: $key) {
              value
            }
          }
        }`,
      { variables: { namespace, key } },
    );
    const json = await res.json();
    // A GraphQL-level error (an unsupported namespace form, for instance) comes
    // back in `errors` rather than as a thrown exception, so it has to be read
    // explicitly or it would look like "no value".
    const gqlError = json?.errors?.[0]?.message ?? null;
    const raw = json?.data?.shop?.metafield?.value;
    return {
      raw: typeof raw === "string" && raw ? raw : null,
      error: gqlError,
    };
  } catch (err) {
    return {
      raw: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarise(
  raw: string,
  source: "app" | "legacy",
  t: ServerT,
): LibraryContents {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        present: true,
        count: 0,
        sampleIds: [],
        error: t("errors.notModelMap"),
        source,
      };
    }
    const ids = Object.keys(parsed);
    return {
      present: true,
      count: ids.length,
      // Enough to eyeball against the id pasted into the block, without dumping
      // a 500-entry library into the page.
      sampleIds: ids.slice(0, 3),
      error: null,
      source,
    };
  } catch (err) {
    return {
      present: true,
      count: 0,
      sampleIds: [],
      error: err instanceof Error ? err.message : String(err),
      source,
    };
  }
}

async function readLibrary(admin: any, t: ServerT): Promise<LibraryContents> {
  // Both read at once rather than the legacy one only after the app one comes
  // back empty: it was a second Shopify round trip in series on every load.
  const [app, legacy] = await Promise.all([
    readOne(admin, APP_LIBRARY_NAMESPACE, APP_LIBRARY_KEY),
    readOne(admin, LIBRARY_NAMESPACE, LIBRARY_KEY),
  ]);
  if (app.raw) return summarise(app.raw, "app", t);
  if (legacy.raw) return summarise(legacy.raw, "legacy", t);

  return {
    present: false,
    count: 0,
    sampleIds: [],
    // The app-owned namespace is the one that should work, so its error is the
    // one worth surfacing.
    error: app.error ?? legacy.error ?? null,
    source: null,
  };
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const t = getServerT(request, "setup");
  const [modelDef, configDef, libraryDef, library, dbModelCount] =
    await Promise.all([
      checkDefinition(admin, "custom", "model_3d"),
      checkDefinition(admin, "custom", "viewer_3d_config"),
      // Shop-owned, unlike the two above: it holds the whole model library so the
      // page block can resolve a Model ID in Liquid. App-reserved namespace —
      // the merchant-owned `custom` one is unwritable without a shop-metafield
      // scope this app doesn't request.
      checkDefinition(admin, APP_LIBRARY_NAMESPACE, APP_LIBRARY_KEY, "SHOP"),
      readLibrary(admin, t),
      // Compared against the metafield's entry count below: the two disagreeing
      // is the signature of a sync that silently isn't landing.
      prisma.model3D.count({ where: { shop: session?.shop ?? "" } }),
    ]);
  return { modelDef, configDef, libraryDef, library, dbModelCount };
};

async function createDefinition(
  admin: any,
  input: {
    name: string;
    namespace: string;
    key: string;
    type: string;
    description: string;
    ownerType?: MetafieldOwner;
    // App-reserved namespaces don't need it: Shopify's docs state metafields are
    // "always accessible in Liquid regardless of this setting", and the theme
    // block is the only reader. Asking for it anyway is one more thing the API
    // can reject on a namespace the app already owns outright.
    skipStorefrontAccess?: boolean;
  },
): Promise<string | null> {
  const res = await admin.graphql(
    `#graphql
      mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id key }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        definition: {
          name: input.name,
          namespace: input.namespace,
          key: input.key,
          type: input.type,
          description: input.description,
          ownerType: input.ownerType ?? "PRODUCT",
          pin: true,
          ...(input.skipStorefrontAccess
            ? {}
            : { access: { storefront: "PUBLIC_READ" } }),
        },
      },
    },
  );
  const json = await res.json();
  const errs = json?.data?.metafieldDefinitionCreate?.userErrors ?? [];
  const takenError = errs.find((e: any) => e.code === "TAKEN");
  if (takenError) return null;
  if (errs.length) {
    return errs.map((e: any) => e.message).join("; ");
  }
  return null;
}

async function enableStorefrontAccess(
  admin: any,
  namespace: string,
  key: string,
  t: ServerT,
  ownerType: MetafieldOwner = "PRODUCT",
): Promise<string | null> {
  const defRes = await admin.graphql(
    `#graphql
      query DefId(
        $namespace: String!
        $key: String!
        $ownerType: MetafieldOwnerType!
      ) {
        metafieldDefinitions(
          first: 1
          namespace: $namespace
          key: $key
          ownerType: $ownerType
        ) {
          edges { node { id } }
        }
      }`,
    { variables: { namespace, key, ownerType } },
  );
  const defJson = await defRes.json();
  const id = defJson?.data?.metafieldDefinitions?.edges?.[0]?.node?.id;
  if (!id) return t("errors.definitionNotFound", { name: `${namespace}.${key}` });

  const updateRes = await admin.graphql(
    `#graphql
      mutation UpdateDef($definition: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(definition: $definition) {
          updatedDefinition { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        definition: {
          namespace,
          key,
          // MUST be the caller's owner type, not a hardcoded PRODUCT: a
          // definition is identified by namespace + key + ownerType, so asking
          // to update custom.viewer_3d_library as a PRODUCT definition matched
          // nothing and came back "not found". That error then propagated as
          // libraryErr in the action below, which skipped syncModelLibrary
          // entirely — so the shop library metafield was never written, and
          // every Model ID pasted into the page block rendered the "unknown
          // model id" empty state. The page viewer could not work on any theme.
          ownerType,
          access: { storefront: "PUBLIC_READ" },
        },
      },
    },
  );
  const updateJson = await updateRes.json();
  const errs = updateJson?.data?.metafieldDefinitionUpdate?.userErrors ?? [];
  if (errs.length) return errs.map((e: any) => e.message).join("; ");
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const t = getServerT(request, "setup");

  const errors: string[] = [];

  const modelErr =
    (await createDefinition(admin, {
      name: "3D Model",
      namespace: "custom",
      key: "model_3d",
      type: "file_reference",
      description: "GLB / GLTF 3D model file rendered by the viewer block.",
    })) ?? (await enableStorefrontAccess(admin, "custom", "model_3d", t));
  if (modelErr) errors.push(`custom.model_3d: ${modelErr}`);

  const configErr =
    (await createDefinition(admin, {
      name: "3D Viewer Config",
      namespace: "custom",
      key: "viewer_3d_config",
      type: "json",
      description: "Per-product egjs-view3d viewer configuration (JSON).",
    })) ?? (await enableStorefrontAccess(admin, "custom", "viewer_3d_config", t));
  if (configErr) errors.push(`custom.viewer_3d_config: ${configErr}`);

  // App-reserved namespace, and no enableStorefrontAccess pass: the app owns
  // this namespace outright, and Liquid access doesn't depend on the storefront
  // setting. The previous version created this in the merchant-owned `custom`
  // namespace, which this app has no scope to write shop-level values in — so
  // the definition appeared but stayed empty forever.
  const libraryErr = await createDefinition(admin, {
    name: "3D Model Library",
    namespace: APP_LIBRARY_NAMESPACE,
    key: APP_LIBRARY_KEY,
    type: "json",
    description:
      "Model id to { url, config } map, so the page viewer block can resolve a Model ID.",
    ownerType: "SHOP",
    skipStorefrontAccess: true,
  });
  if (libraryErr) {
    errors.push(`${APP_LIBRARY_NAMESPACE}.${APP_LIBRARY_KEY}: ${libraryErr}`);
  }

  // Populate it immediately, so a merchant who has already built a library
  // doesn't have to touch every model to make the ids resolvable.
  //
  // Attempted even when the definition step reported a problem, and its own
  // failure is reported separately. Previously a definition error skipped the
  // sync, so one broken step left the storefront with no library at all and no
  // second chance short of re-saving every model — and a sync that failed on
  // its own was swallowed entirely, letting this page claim success while the
  // page block still couldn't resolve a single Model ID.
  const syncErr = await syncModelLibrary(admin, shop);
  if (syncErr) errors.push(t("errors.syncFailed", { error: syncErr }));

  // The definitions this action just created are what checkDefsReady reports,
  // so the checklist elsewhere must not keep serving the pre-fix answer.
  invalidateDefsReady(shop);

  if (errors.length) return { ok: false, error: errors.join(" | ") };
  return {
    ok: true,
    message: t("toast.ready"),
  };
};

function StatusRow({
  def,
  label,
  name,
  // The app-owned library needs no storefront access (Liquid reads app-owned
  // metafields regardless), so requiring it here would show a permanent warning
  // on a definition that is working correctly.
  requireStorefrontAccess = true,
}: {
  def: DefinitionStatus;
  label: string;
  name: string;
  requireStorefrontAccess?: boolean;
}) {
  const t = useT("setup");
  const ready =
    def.exists && (!requireStorefrontAccess || def.storefrontAccess);
  return (
    <s-stack
      direction="inline"
      gap="base"
      alignItems="center"
      justifyContent="space-between"
      inlineSize="100%"
    >
      <s-stack direction="block" gap="small-500">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">
          <code>{name}</code>
        </s-text>
      </s-stack>
      {ready ? (
        <s-badge tone="success" icon="check">
          {t("status.ready")}
        </s-badge>
      ) : def.exists ? (
        <s-badge tone="warning" icon="alert-triangle">
          {t("status.noStorefrontAccess")}
        </s-badge>
      ) : (
        <s-badge tone="critical" icon="x">
          {t("status.missing")}
        </s-badge>
      )}
    </s-stack>
  );
}

/*
 * Turns the library's state into the one thing the merchant should do next.
 *
 * The order matters: each case assumes the ones above it have been ruled out,
 * so the merchant is never told to fix a downstream symptom of an upstream
 * problem. "Not found" on the storefront has four distinct causes and they need
 * four different actions, which is exactly what a single green tick was hiding.
 */
function diagnoseLibrary(
  libraryDef: DefinitionStatus,
  library: LibraryContents,
  dbModelCount: number,
  t: TFunction,
): { tone: "ok" | "warn" | "error"; headline: string; detail: string } {
  if (library.error) {
    return {
      tone: "error",
      headline: t("diagnose.readFailed"),
      detail: library.error,
    };
  }

  if (!libraryDef.exists) {
    return {
      tone: "error",
      headline: t("diagnose.noDefinition"),
      detail: t("diagnose.noDefinitionDetail"),
    };
  }

  if (!library.present || library.count === 0) {
    return {
      tone: "error",
      headline: t("diagnose.empty"),
      detail: dbModelCount
        ? t("diagnose.emptyWithModels", { count: dbModelCount })
        : t("diagnose.emptyNoModels"),
    };
  }

  if (library.count < dbModelCount) {
    return {
      tone: "warn",
      headline: t("diagnose.partial", {
        published: library.count,
        count: dbModelCount,
      }),
      detail: t("diagnose.partialDetail"),
    };
  }

  return {
    tone: "ok",
    headline: t("diagnose.ok", { count: library.count }),
    detail:
      library.source === "legacy"
        ? t("diagnose.okDetailLegacy")
        : t("diagnose.okDetail"),
  };
}

const strong = (chunk: string) => <s-text type="strong">{chunk}</s-text>;

export default function Setup() {
  const { modelDef, configDef, libraryDef, library, dbModelCount } =
    useLoaderData<typeof loader>();
  const t = useT("setup");
  const tc = useT("common");
  const libraryState = diagnoseLibrary(libraryDef, library, dbModelCount, t);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const routeTo = useRouteNav();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? tc("done"));
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify, tc]);

  // Renamed from bothReady now that there are three definitions — the library
  // one is what lets the page block resolve a Model ID.
  const allReady =
    modelDef.exists &&
    modelDef.storefrontAccess &&
    configDef.exists &&
    configDef.storefrontAccess &&
    libraryDef.exists;

  // Submitted programmatically rather than by a <Form> wrapper. A Polaris
  // button is a custom element whose real <button> lives in shadow DOM, so it
  // is not form-associated: a `type="submit"` on it never reaches the form
  // react-router is listening to. Every mutation on the converted pages posts
  // through useSubmit for that reason.
  const runSetup = () => submit(new FormData(), { method: "post" });

  const libraryTone =
    libraryState.tone === "ok"
      ? "success"
      : libraryState.tone === "warn"
        ? "warning"
        : "critical";

  return (
    <s-page heading={t("heading")}>
      <BackButton to="/app" label={t("backLabel")} />
      <SupportAction />

      <s-paragraph color="subdued">{t("intro")}</s-paragraph>

      <s-section heading={t("defs.heading")}>
        <s-paragraph color="subdued">{t("defs.body")}</s-paragraph>

        <s-stack direction="block" gap="base">
          <StatusRow
            def={modelDef}
            label={t("defs.model")}
            name="custom.model_3d"
          />
          <s-divider />
          <StatusRow
            def={configDef}
            label={t("defs.config")}
            name="custom.viewer_3d_config"
          />
          <s-divider />
          <StatusRow
            def={libraryDef}
            label={t("defs.library")}
            name={`${APP_LIBRARY_NAMESPACE}.${APP_LIBRARY_KEY}`}
            requireStorefrontAccess={false}
          />

          {allReady ? (
            <s-banner tone="success">
              <s-paragraph>{t("defs.allReady")}</s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>

        {/*
          Shown unconditionally. It used to be hidden once all three
          definitions existed, which made the one recovery action on this page
          unreachable in exactly the state that needs it most: schemas all
          green, library empty, every Model ID failing on the storefront. The
          action re-syncs the library as well as fixing definitions, and is safe
          to run repeatedly.
        */}
        <s-button
          slot={allReady ? "secondary-actions" : "primary-action"}
          // Tracks the slot: primary-action rejects any variant but "primary",
          // and secondary-actions rejects anything but "secondary" or "auto".
          variant={allReady ? "secondary" : "primary"}
          icon="wand"
          loading={flag(submitting)}
          onClick={runSetup}
        >
          {allReady ? t("defs.resync") : t("defs.createFix")}
        </s-button>
      </s-section>

      {/*
        What the theme block actually sees. Step 1 above only proves the
        schemas exist — this reads the value back, which is the only way to
        tell an empty library from a working one.
      */}
      <s-section heading={t("library.heading")}>
        <s-paragraph color="subdued">{t("library.body")}</s-paragraph>

        <s-banner tone={libraryTone} heading={libraryState.headline}>
          <s-paragraph>{libraryState.detail}</s-paragraph>
        </s-banner>

        {/*
          Rendered here as well as in the toast. A toast is gone in seconds,
          and this is the one message worth keeping on screen: if Shopify
          rejects the metafield write, its wording is the whole diagnosis and
          the merchant needs to be able to read it twice or paste it to support.
        */}
        {actionData?.error ? (
          <s-stack direction="block" gap="small-500">
            <s-text type="strong" tone="critical">
              {t("library.lastAttempt")}
            </s-text>
            <s-box background="subdued" padding="small" borderRadius="base">
              <s-text color="subdued">
                <code>{actionData.error}</code>
              </s-text>
            </s-box>
          </s-stack>
        ) : null}

        {library.sampleIds.length > 0 ? (
          <s-stack direction="block" gap="small-500">
            <s-text color="subdued">
              {library.count > library.sampleIds.length
                ? t("library.sampleIdsPartial", {
                    shown: library.sampleIds.length,
                    total: library.count,
                  })
                : t("library.sampleIds")}
            </s-text>
            <s-box background="subdued" padding="small" borderRadius="base">
              <s-stack direction="block" gap="small-500">
                {library.sampleIds.map((id) => (
                  <s-text key={id} color="subdued">
                    <code>{id}</code>
                  </s-text>
                ))}
              </s-stack>
            </s-box>
          </s-stack>
        ) : null}
      </s-section>

      <s-section heading={t("block.heading")}>
        <s-paragraph>{t.rich("block.product", { b: strong })}</s-paragraph>
        <s-paragraph>
          {t.rich("block.anyPage", {
            b: strong,
            link: (chunk) => (
              <s-link href="/app/models" onClick={routeTo("/app/models")}>
                {chunk}
              </s-link>
            ),
          })}
        </s-paragraph>
        <s-paragraph color="subdued">
          {t.rich("block.legacy", { b: strong })}
        </s-paragraph>
      </s-section>

      <s-section heading={t("upload.heading")}>
        <s-paragraph>
          {t.rich("upload.body", {
            link: (chunk) => (
              <s-link href="/app/products" onClick={routeTo("/app/products")}>
                {chunk}
              </s-link>
            ),
          })}
        </s-paragraph>
        <s-paragraph color="subdued">
          {t.rich("upload.formats", { b: strong })}
        </s-paragraph>
      </s-section>

      {/* The same switch as on Home: settings is where it gets looked for. */}
      <s-section>
        <LanguagePicker />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
