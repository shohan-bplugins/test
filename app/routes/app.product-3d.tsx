import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { action as productAction } from "./app.products.$id";
import { FilePickerDialog } from "~/components/FilePickerDialog";
import { useEditorWindow } from "~/components/configurator/EditorWindow";
import { ModalAction } from "~/components/polaris/ModalAction";
import {
  fieldValue,
  flag,
  useOverlay,
  type OverlayElement,
} from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import { getServerT } from "~/i18n/i18n.server";
import { rulesFor, parseLayers } from "~/lib/configurator/config";
import { COVERAGE_MAX_MODEL_MB } from "~/lib/configurator/constants";
import { allowedModules } from "~/lib/configurator/modules.server";
import {
  blankProductConfig,
  getProductConfig,
  saveProductConfig,
} from "~/lib/configurator/product-config.server";
import {
  fetchModelFromUrl,
  MODEL_URL_PATTERN,
  UrlImportError,
} from "~/lib/configurator/url-import.server";
import {
  formatFileSize,
  MAX_RAW_UPLOAD_MB,
  validateModelFile,
} from "~/lib/files";
import { CubeLoader } from "~/components/CubeLoader";
import type { FileItem } from "~/routes/api.files";

/*
 * "3D products" — the prototype's coverage page
 * (3D Configurator for Shopify/shopify/admin/products.js) over the store's real
 * products: every product and its 3D setup, filter tabs, bulk Enable/Disable
 * 3D with undo, and the "Add model" flow (upload, Shopify Files, URL import).
 *
 * Upload and "Choose from Files" post to the product page's own action, so
 * plan limits, optimisation and the one-product-per-file rule stay in one
 * place. Disable keeps the model assigned and publishes `enabled: false` to
 * the configurator metafield, which the product block reads.
 *
 * Not carried over from the prototype: "Generate posters" (needs the
 * configurator engine, Phase 1) and triangle counts (Shopify Files doesn't
 * report them).
 */

const PAGE_SIZE = 50;

/** Same browser-side check as the server's MODEL_URL_PATTERN. */
const URL_SHAPE = /^https:\/\/[^/\s]+\/\S+\.(glb|gltf)(\?\S*)?$/i;

type Status = "ACTIVE" | "DRAFT" | "ARCHIVED";
type Publish = "published" | "not_published" | "changes" | null;
type Issue = "oversized" | "no_ar" | "unpublished";

type Row = {
  id: string;
  title: string;
  status: Status;
  image: string | null;
  modelGid: string | null;
  fileName: string | null;
  fileSize: number | null;
  format: string | null;
  hasUsdz: boolean;
  enabled: boolean;
  variants: number;
  variantSetups: number;
  optionGroups: number;
  publish: Publish;
  issues: Issue[];
};

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

function fileNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const last = url.split("?")[0].split("/").pop();
  return last ? decodeURIComponent(last) : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const vars: Record<string, unknown> = {
    query: q ? `title:*${q.replace(/["*]/g, "")}*` : null,
  };
  if (before) Object.assign(vars, { last: PAGE_SIZE, before });
  else Object.assign(vars, { first: PAGE_SIZE, after: after ?? null });

  const [res, modules] = await Promise.all([
    admin.graphql(
      `#graphql
        query Product3dList(
          $first: Int, $after: String, $last: Int, $before: String, $query: String
        ) {
          products(
            first: $first, after: $after, last: $last, before: $before,
            sortKey: UPDATED_AT, reverse: true, query: $query
          ) {
            nodes {
              id title status
              featuredImage { url(transform: { maxWidth: 80, maxHeight: 80 }) }
              variantsCount { count }
              model: metafield(namespace: "custom", key: "model_3d") {
                reference {
                  ... on GenericFile { id url originalFileSize }
                  ... on Model3d {
                    id filename
                    originalSource { filesize format }
                    sources { format filesize }
                  }
                }
              }
            }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
          }
          total: productsCount { count }
        }`,
      { variables: vars },
    ),
    allowedModules(admin, shop),
  ]);
  const json: any = await res.json();
  const nodes: any[] = json?.data?.products?.nodes ?? [];
  const ids = nodes.map((n) => numericId(n.id));

  const configs = await prisma.productConfig.findMany({
    where: { shop, productId: { in: ids } },
  });
  const byId = new Map(configs.map((c) => [c.productId, c]));

  // Variant setups need each variant's options, but only for products whose
  // config has option rules or variant exceptions — usually a handful — so
  // the list query itself stays cheap.
  const layered = configs.filter(
    (c) => c.optionRules !== "{}" || c.variantConfigs !== "{}",
  );
  const setupCounts = new Map<string, number>();
  if (layered.length) {
    const vRes = await admin.graphql(
      `#graphql
        query Product3dVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              options { name }
              variants(first: 100) {
                nodes { id selectedOptions { name value } }
              }
            }
          }
        }`,
      {
        variables: {
          ids: layered.map((c) => `gid://shopify/Product/${c.productId}`),
        },
      },
    );
    const vJson: any = await vRes.json();
    for (const p of vJson?.data?.nodes ?? []) {
      if (!p?.id) continue;
      const cfg = byId.get(numericId(p.id));
      if (!cfg) continue;
      const rules = parseLayers(cfg.optionRules);
      const exceptions = parseLayers(cfg.variantConfigs);
      const own = (p.variants?.nodes ?? []).filter((v: any) => {
        const opts = Object.fromEntries(
          (v.selectedOptions ?? []).map((o: any) => [o.name, o.value]),
        );
        return (
          exceptions[numericId(v.id)] ||
          rulesFor(p, opts, rules).length > 0
        );
      }).length;
      setupCounts.set(numericId(p.id), own);
    }
  }

  const maxBytes = COVERAGE_MAX_MODEL_MB * 1024 * 1024;
  const rows: Row[] = nodes.map((n) => {
    const id = numericId(n.id);
    const ref = n.model?.reference ?? null;
    const isModel3d = Boolean(ref?.sources);
    const fileSize = isModel3d
      ? (ref.originalSource?.filesize ?? null)
      : (ref?.originalFileSize ?? null);
    const hasUsdz = isModel3d
      ? (ref.sources ?? []).some(
          (s: any) => String(s.format).toLowerCase() === "usdz",
        )
      : false;
    const cfg = byId.get(id);
    const enabled = cfg ? cfg.enabled : true;
    let optionGroups = 0;
    try {
      optionGroups = cfg ? (JSON.parse(cfg.config)?.options?.length ?? 0) : 0;
    } catch {
      optionGroups = 0;
    }

    // No config row yet: the product block reads custom.model_3d directly, so
    // an assigned model is already live.
    let publish: Publish = null;
    if (ref) {
      if (!cfg) publish = "published";
      else if (!cfg.publishedAt) publish = "not_published";
      else if (cfg.updatedAt.getTime() - cfg.publishedAt.getTime() > 1000) {
        publish = "changes";
      } else publish = "published";
    }

    const issues: Issue[] = [];
    if (ref) {
      if (fileSize != null && fileSize > maxBytes) issues.push("oversized");
      if (!hasUsdz) issues.push("no_ar");
      if (enabled && publish !== "published") issues.push("unpublished");
    }

    return {
      id,
      title: n.title,
      status: (n.status ?? "ACTIVE") as Status,
      image: n.featuredImage?.url ?? null,
      modelGid: ref?.id ?? null,
      fileName: ref
        ? (ref.filename ?? fileNameFromUrl(ref.url) ?? "model.glb")
        : null,
      fileSize,
      format: ref
        ? isModel3d
          ? String(ref.originalSource?.format ?? "glb").toUpperCase()
          : (fileNameFromUrl(ref.url)?.split(".").pop()?.toUpperCase() ?? "GLB")
        : null,
      hasUsdz,
      enabled,
      variants: n.variantsCount?.count ?? 1,
      variantSetups: setupCounts.get(id) ?? 0,
      optionGroups,
      publish,
      issues,
    };
  });

  return {
    rows,
    query: q,
    total: json?.data?.total?.count ?? rows.length,
    pageInfo: json?.data?.products?.pageInfo ?? {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
    urlImportAllowed: !!modules["external-url"],
  };
};

type ActionResult =
  | { ok: true; intent: "set_enabled"; on: boolean; changed: string[]; skipped: number }
  | { ok: true; intent: "import_url"; message?: string }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const t = getServerT(request, "product3d");

  if (intent === "set_enabled") {
    const on = fd.get("on") === "1";
    const ids = String(fd.get("ids") ?? "")
      .split(",")
      .filter((id) => /^\d+$/.test(id))
      .slice(0, PAGE_SIZE);
    if (!ids.length) return { ok: false, error: t("errNoSelection") };

    // Which of them actually have a model — read here, not trusted from the form.
    const res = await admin.graphql(
      `#graphql
        query Product3dModels($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              model: metafield(namespace: "custom", key: "model_3d") {
                reference { ... on Node { id } }
              }
            }
          }
        }`,
      { variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) } },
    );
    const json: any = await res.json();
    const models = new Map<string, string>();
    for (const n of json?.data?.nodes ?? []) {
      const gid = n?.model?.reference?.id;
      if (n?.id && gid) models.set(numericId(n.id), gid);
    }

    const changed: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      const modelGid = models.get(id);
      if (!modelGid) continue;
      const data =
        (await getProductConfig(shop, id)) ?? blankProductConfig(id);
      if (!data.modelFileId) data.modelFileId = modelGid;
      if (data.enabled === on && data.publishedAt) {
        changed.push(id);
        continue;
      }
      data.enabled = on;
      const saved = await saveProductConfig(admin, shop, data);
      if (saved.ok) changed.push(id);
      else errors.push(saved.error);
    }
    if (errors.length && !changed.length) {
      return { ok: false, error: errors[0] };
    }
    return {
      ok: true,
      intent: "set_enabled",
      on,
      changed,
      skipped: ids.length - models.size,
    };
  }

  if (intent === "import_url") {
    const productId = String(fd.get("productId") ?? "");
    const rawUrl = String(fd.get("url") ?? "");
    if (!/^\d+$/.test(productId)) {
      return { ok: false, error: t("errNoProduct") };
    }
    const modules = await allowedModules(admin, shop);
    if (!modules["external-url"]) {
      return { ok: false, error: t("urlLocked") };
    }
    if (!MODEL_URL_PATTERN.test(rawUrl.trim())) {
      return { ok: false, error: t("urlInvalid") };
    }
    let file: File;
    try {
      file = await fetchModelFromUrl(rawUrl);
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof UrlImportError
            ? t(`urlErr_${err.code}`, { status: err.status ?? "" })
            : t("urlErr_download"),
      };
    }

    // Hand the downloaded file to the product page's upload action, so URL
    // imports get the same optimisation, plan limits and Files pipeline as an
    // upload. Same auth headers; a new multipart body.
    const headers = new Headers(request.headers);
    headers.delete("content-type");
    headers.delete("content-length");
    const body = new FormData();
    body.set("intent", "upload");
    body.set("file", file);
    body.set("optimize", "1");
    const forwarded = new Request(
      new URL(`/app/products/${productId}`, request.url),
      { method: "POST", headers, body },
    );
    const result: any = await productAction({
      request: forwarded,
      params: { id: productId },
      context: {},
    } as unknown as ActionFunctionArgs);
    if (result instanceof Response) return result;
    return result?.ok
      ? { ok: true, intent: "import_url", message: result.message }
      : { ok: false, error: result?.error ?? t("urlErr_download") };
  }

  return { ok: false, error: t("errUnknown") };
};

/* ------------------------------------------------------------------ */

type Tab = "all" | "with" | "without" | "attention";
const TABS: Tab[] = ["all", "with", "without", "attention"];
const TAB_KEYS: Record<Tab, string> = {
  all: "tabAll",
  with: "tabWith",
  without: "tabWithout",
  attention: "tabAttention",
};

const THUMB = 40;

function Thumb({ src }: { src: string | null }) {
  return (
    <s-box
      inlineSize={`${THUMB}px`}
      blockSize={`${THUMB}px`}
      background="subdued"
      borderWidth="base"
      borderStyle="solid"
      borderColor="base"
      borderRadius="base"
      overflow="hidden"
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={THUMB}
          height={THUMB}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="center"
          inlineSize="100%"
          blockSize="100%"
        >
          <s-icon type="image-none" color="subdued" size="small" />
        </s-stack>
      )}
    </s-box>
  );
}

export default function Product3dPage() {
  const { rows, query, total, pageInfo, urlImportAllowed } =
    useLoaderData<typeof loader>();
  const t = useT("product3d");
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const bulk = useFetcher<ActionResult>();

  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [addFor, setAddFor] = useState<Row | null>(null);
  const editorWindow = useEditorWindow();

  useEffect(() => setSearch(query), [query]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === query) return;
      const params = new URLSearchParams(searchParams);
      if (search.trim()) params.set("q", search.trim());
      else params.delete("q");
      params.delete("after");
      params.delete("before");
      setSearchParams(params, { replace: true });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Bulk result: toast for Enable, an undo banner for Disable — as in the prototype.
  useEffect(() => {
    const d = bulk.data;
    if (!d || bulk.state !== "idle") return;
    if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.intent !== "set_enabled") return;
    if (d.on) {
      setUndo(null);
      shopify.toast.show(
        d.skipped
          ? t("enabledSkipped", { count: d.changed.length, skipped: d.skipped })
          : t("enabledToast", { count: d.changed.length }),
      );
    } else {
      setUndo(d.changed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulk.data, bulk.state]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      with: rows.filter((r) => r.modelGid).length,
      without: rows.filter((r) => !r.modelGid).length,
      attention: rows.filter((r) => r.issues.length).length,
    }),
    [rows],
  );
  const list = rows.filter((r) =>
    tab === "with"
      ? r.modelGid
      : tab === "without"
        ? !r.modelGid
        : tab === "attention"
          ? r.issues.length > 0
          : true,
  );

  const busy = bulk.state !== "idle";
  const allOnPage = list.length > 0 && list.every((r) => selected.includes(r.id));

  function setEnabled(ids: string[], on: boolean) {
    setSelected([]);
    bulk.submit(
      { intent: "set_enabled", ids: ids.join(","), on: on ? "1" : "0" },
      { method: "post" },
    );
  }

  function undoDisable() {
    if (!undo) return;
    const ids = undo;
    setUndo(null);
    bulk.submit(
      { intent: "set_enabled", ids: ids.join(","), on: "1" },
      { method: "post" },
    );
  }

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const firstWithout = rows.find((r) => !r.modelGid) ?? rows[0] ?? null;

  function page(dir: "next" | "prev") {
    const params = new URLSearchParams(searchParams);
    params.delete(dir === "next" ? "before" : "after");
    const cursor = dir === "next" ? pageInfo.endCursor : pageInfo.startCursor;
    if (cursor) params.set(dir === "next" ? "after" : "before", cursor);
    setSelected([]);
    setSearchParams(params);
  }

  const emptyText = query
    ? t("emptySearch", { query })
    : tab === "attention"
      ? t("emptyAttention")
      : t("emptyTab");

  return (
    <s-page heading={t("heading")} inlineSize="large">
      {firstWithout ? (
        <s-button
          slot="primary-action"
          variant="primary"
          icon="plus"
          onClick={() => setAddFor(firstWithout)}
        >
          {t("addModel")}
        </s-button>
      ) : null}

      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t("subtitle")}</s-paragraph>

        {undo ? (
          <s-banner
            tone="info"
            heading={t("undoHeading", { count: undo.length })}
            dismissible
          >
            <s-paragraph>{t("undoBody")}</s-paragraph>
            <s-button slot="secondary-actions" onClick={undoDisable}>
              {t("undo")}
            </s-button>
          </s-banner>
        ) : null}

        <s-section padding="none">
          <s-stack direction="block" gap="base" padding="base">
            <s-grid gridTemplateColumns="1fr minmax(200px, 320px)" gap="base" alignItems="center">
              <s-button-group>
                {TABS.map((id) => (
                  <s-button
                    key={id}
                    variant={id === tab ? "primary" : "secondary"}
                    onClick={() => {
                      setTab(id);
                      setSelected([]);
                    }}
                  >
                    {t("tabCount", { label: t(TAB_KEYS[id]), count: counts[id] })}
                  </s-button>
                ))}
              </s-button-group>
              <s-search-field
                label={t("searchLabel")}
                labelAccessibilityVisibility="exclusive"
                placeholder={t("searchLabel")}
                value={search}
                onInput={(e) => setSearch(fieldValue(e))}
              />
            </s-grid>

            {selected.length ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">
                  {t("selectedCount", { count: selected.length })}
                </s-text>
                <s-button
                  disabled={flag(busy)}
                  onClick={() => setEnabled(selected, true)}
                >
                  {t("enable3d")}
                </s-button>
                <s-button
                  disabled={flag(busy)}
                  onClick={() => setEnabled(selected, false)}
                >
                  {t("disable3d")}
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>

          {list.length === 0 ? (
            <s-box padding="large">
              <s-text color="subdued">{emptyText}</s-text>
            </s-box>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>
                  <s-checkbox
                    accessibilityLabel={t("selectAll")}
                    checked={flag(allOnPage)}
                    onInput={() =>
                      setSelected(allOnPage ? [] : list.map((r) => r.id))
                    }
                  />
                </s-table-header>
                <s-table-header listSlot="primary">{t("colProduct")}</s-table-header>
                <s-table-header>{t("col3d")}</s-table-header>
                <s-table-header>{t("colFile")}</s-table-header>
                <s-table-header>{t("colVariants")}</s-table-header>
                <s-table-header>{t("colOptions")}</s-table-header>
                <s-table-header>{t("colStorefront")}</s-table-header>
                <s-table-header>{t("colActions")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {list.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <s-checkbox
                        accessibilityLabel={t("selectProduct", { title: r.title })}
                        checked={flag(selected.includes(r.id))}
                        onInput={() => toggle(r.id)}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <Thumb src={r.image} />
                        <s-stack direction="block" gap="small-500">
                          {r.modelGid ? (
                            <s-link
                              href={`/app/products/${r.id}/editor`}
                              onClick={(e) => {
                                e.preventDefault();
                                editorWindow.open(r.id);
                              }}
                            >
                              {r.title}
                            </s-link>
                          ) : (
                            <s-text type="strong">{r.title}</s-text>
                          )}
                          {r.status !== "ACTIVE" ? (
                            <s-badge tone="info">
                              {r.status === "DRAFT" ? t("badgeDraft") : t("badgeArchived")}
                            </s-badge>
                          ) : null}
                        </s-stack>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {!r.modelGid ? (
                        <s-badge>{t("badgeNoModel")}</s-badge>
                      ) : r.enabled ? (
                        <s-badge tone="success">{t("badgeEnabled")}</s-badge>
                      ) : (
                        <s-badge tone="warning">{t("badgeOff")}</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.modelGid ? (
                        <s-stack direction="block" gap="small-500">
                          <s-text>{r.fileName}</s-text>
                          <s-text color="subdued">
                            {r.fileSize != null
                              ? t("fileMeta", { size: formatFileSize(r.fileSize), format: r.format ?? "" })
                              : r.format}
                          </s-text>
                          {r.issues.includes("oversized") || r.issues.includes("no_ar") ? (
                            <s-stack direction="inline" gap="small-500">
                              {r.issues.includes("oversized") ? (
                                <s-badge tone="warning" icon="alert-triangle">
                                  {t("oversized", { mb: COVERAGE_MAX_MODEL_MB })}
                                </s-badge>
                              ) : null}
                              {r.issues.includes("no_ar") ? (
                                <s-badge tone="warning" icon="alert-triangle">
                                  {t("noAr")}
                                </s-badge>
                              ) : null}
                            </s-stack>
                          ) : null}
                        </s-stack>
                      ) : (
                        <s-button icon="plus" onClick={() => setAddFor(r)}>
                          {t("addModelShort")}
                        </s-button>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.modelGid && r.variants > 1 ? (
                        <s-text>{t("variantsOf", { own: r.variantSetups, total: r.variants })}</s-text>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.modelGid ? (
                        r.optionGroups ? (
                          <s-text>{r.optionGroups}</s-text>
                        ) : (
                          <s-text color="subdued">{t("none")}</s-text>
                        )
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.publish === "published" ? (
                        <s-badge tone="success">{t("pubPublished")}</s-badge>
                      ) : r.publish === "changes" ? (
                        <s-badge tone="warning">{t("pubChanges")}</s-badge>
                      ) : r.publish === "not_published" ? (
                        <s-badge>{t("pubNotPublished")}</s-badge>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.modelGid ? (
                        <s-stack direction="inline" gap="small-500">
                          <s-button
                            icon="edit"
                            onClick={() => editorWindow.open(r.id)}
                          >
                            {t("customize")}
                          </s-button>
                          <s-button onClick={() => setAddFor(r)}>
                            {t("changeModel")}
                          </s-button>
                        </s-stack>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          <s-box padding="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-text color="subdued">
                {t("pageNote", { shown: rows.length, total })}
              </s-text>
              {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
                <s-stack direction="inline" gap="small-500">
                  <s-button
                    icon="chevron-left"
                    accessibilityLabel={t("prevPage")}
                    disabled={flag(!pageInfo.hasPreviousPage)}
                    onClick={() => page("prev")}
                  />
                  <s-button
                    icon="chevron-right"
                    accessibilityLabel={t("nextPage")}
                    disabled={flag(!pageInfo.hasNextPage)}
                    onClick={() => page("next")}
                  />
                </s-stack>
              ) : null}
            </s-grid>
          </s-box>
        </s-section>

        <s-text color="subdued">{t("footNote", { mb: COVERAGE_MAX_MODEL_MB })}</s-text>
      </s-stack>

      {editorWindow.element}
      <AddModelModal
        row={addFor}
        urlImportAllowed={urlImportAllowed}
        onClose={() => setAddFor(null)}
        onOpenEditor={(id) => editorWindow.open(id)}
      />
    </s-page>
  );
}

/* ------------------------------------------------------------------ */

type Source = "upload" | "files" | "url";

// One sample per product category, served from public/demo-models/.
const DEMO_MODELS = [
  { id: "sheen-chair", labelKey: "demoChair", file: "sheen-chair.glb" },
  { id: "shoe", labelKey: "demoShoe", file: "shoe.glb" },
  { id: "sunglasses", labelKey: "demoSunglasses", file: "sunglasses.glb" },
  { id: "watch", labelKey: "demoWatch", file: "watch.glb" },
  { id: "water-bottle", labelKey: "demoBottle", file: "water-bottle.glb" },
  { id: "lamp", labelKey: "demoLamp", file: "lamp.glb" },
  { id: "toy-car", labelKey: "demoToy", file: "toy-car.glb" },
] as const;

/**
 * The prototype's AddModelModal, wired to the real pipeline. Every control in
 * the body listens on `input` and the footer uses ModalAction — React's
 * delegated click never reaches content s-modal lifts into the top layer.
 */
function AddModelModal({
  row,
  urlImportAllowed,
  onClose,
  onOpenEditor,
}: {
  row: Row | null;
  urlImportAllowed: boolean;
  onClose: () => void;
  onOpenEditor: (productId: string) => void;
}) {
  const t = useT("product3d");
  const te = useT("editor");
  const tc = useT("common");
  const tf = useT("files");
  const shopify = useAppBridge();
  const productFetcher = useFetcher<{ ok: boolean; error?: string; message?: string }>();
  const urlFetcher = useFetcher<ActionResult>();

  const [source, setSource] = useState<Source>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  // Keep the product while the File picker is open on top of a closed modal.
  const [target, setTarget] = useState<Row | null>(null);

  const open = !!row && !pickerOpen;
  const ref = useOverlay<OverlayElement>(open, () => {
    if (!pickerOpen) onClose();
  });

  useEffect(() => {
    if (row) {
      setTarget(row);
      setSource("upload");
      setFile(null);
      setUrl("");
      setUrlError("");
      setDone(false);
    }
  }, [row]);

  const product = row ?? target;
  const working =
    productFetcher.state !== "idle" || urlFetcher.state !== "idle" || demoLoading;

  useEffect(() => {
    const d = productFetcher.data;
    if (!d || productFetcher.state !== "idle") return;
    if (d.ok) setDone(true);
    else shopify.toast.show(d.error ?? tc("somethingWentWrong"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFetcher.data, productFetcher.state]);

  useEffect(() => {
    const d = urlFetcher.data;
    if (!d || urlFetcher.state !== "idle") return;
    if (d.ok) setDone(true);
    else setUrlError(d.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFetcher.data, urlFetcher.state]);

  if (!product) return null;
  const productAction = `/app/products/${product.id}`;

  function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLElement & { files?: FileList | null };
    const f = input.files?.[0] ?? null;
    if (!f) return;
    const err = validateModelFile(f, true, tf);
    if (err) {
      shopify.toast.show(err, { isError: true });
      return;
    }
    setFile(f);
  }

  function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.set("intent", "upload");
    fd.set("file", file);
    fd.set("optimize", "1");
    productFetcher.submit(fd, {
      method: "post",
      action: productAction,
      encType: "multipart/form-data",
    });
  }

  // Demo models are static files served by this app. Fetch one and send it
  // through the normal upload action so limits and optimisation still apply.
  async function importDemo(demo: (typeof DEMO_MODELS)[number]) {
    setDemoLoading(true);
    try {
      const res = await fetch(`/demo-models/${demo.file}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const demoFile = new File([blob], demo.file, { type: "model/gltf-binary" });
      setFile(demoFile);
      const fd = new FormData();
      fd.set("intent", "upload");
      fd.set("file", demoFile);
      fd.set("optimize", "1");
      productFetcher.submit(fd, {
        method: "post",
        action: productAction,
        encType: "multipart/form-data",
      });
    } catch {
      shopify.toast.show(t("demoLoadFailed"), { isError: true });
    } finally {
      setDemoLoading(false);
    }
  }

  function importUrl() {
    if (!URL_SHAPE.test(url.trim())) {
      setUrlError(t("urlInvalid"));
      return;
    }
    setUrlError("");
    urlFetcher.submit(
      { intent: "import_url", productId: product!.id, url: url.trim() },
      { method: "post" },
    );
  }

  function assign(picked: FileItem) {
    productFetcher.submit(
      { intent: "assign_existing", fileGid: picked.id },
      { method: "post", action: productAction },
    );
  }

  const stages = [t("stageUploading"), t("stageProcessing"), t("stageReady")];
  const stage = done ? 2 : productFetcher.state === "loading" || urlFetcher.state === "loading" ? 1 : 0;

  let primary: { label: string; onClick: () => void; disabled?: boolean } | null;
  if (done) {
    primary = {
      label: te("openEditor"),
      onClick: () => {
        onClose();
        onOpenEditor(product.id);
      },
    };
  } else if (source === "files") {
    primary = { label: t("chooseFile"), onClick: () => setPickerOpen(true) };
  } else if (source === "url") {
    primary = {
      label: t("import"),
      onClick: importUrl,
      disabled: !urlImportAllowed || !url.trim(),
    };
  } else {
    primary = { label: t("upload"), onClick: upload, disabled: !file };
  }

  return (
    <>
      <s-modal
        ref={ref as never}
        id="add-3d-model"
        heading={t(product.modelGid ? "modalHeadingChange" : "modalHeading", { title: product.title })}
        accessibilityLabel={t(product.modelGid ? "modalHeadingChange" : "modalHeading", { title: product.title })}
      >
        {working || done ? (
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              {done ? (
                <s-badge tone="success">{t("stageReady")}</s-badge>
              ) : (
                <CubeLoader size="small" label={stages[stage]} />
              )}
              <s-text type="strong">
                {file?.name ?? (url ? url.split("/").pop() : product.title)}
              </s-text>
            </s-stack>
            <s-ordered-list>
              {stages.map((label, i) => (
                <s-list-item key={label}>
                  {i < stage || done ? "✓ " : i === stage ? "… " : ""}
                  {label}
                </s-list-item>
              ))}
            </s-ordered-list>
            {done ? (
              <s-banner tone="success" heading={t("modelAdded")}>
                <s-paragraph>{t("modelAddedBody", { title: product.title })}</s-paragraph>
              </s-banner>
            ) : null}
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-select
              label={t("sourceLabel")}
              value={source}
              onInput={(e) => setSource(fieldValue(e) as Source)}
            >
              <s-option value="upload">{t("srcUpload")}</s-option>
              <s-option value="files">{t("srcFiles")}</s-option>
              <s-option value="url">{t("srcUrl")}</s-option>
            </s-select>


            {source === "upload" ? (
              <s-stack direction="block" gap="small">
                <s-drop-zone
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  label={t("dropLabel")}
                  onInput={chooseFile}
                />
                <s-text color="subdued">
                  {file
                    ? t("chosenFile", { name: file.name, size: formatFileSize(file.size) })
                    : t("dropHelp", { mb: MAX_RAW_UPLOAD_MB })}
                </s-text>
              </s-stack>
            ) : null}

            {source === "files" ? (
              <s-paragraph color="subdued">{t("filesHelp")}</s-paragraph>
            ) : null}

            {source === "url" ? (
              <s-stack direction="block" gap="small">
                {!urlImportAllowed ? (
                  <s-banner tone="info">
                    <s-paragraph>{t("urlLocked")}</s-paragraph>
                  </s-banner>
                ) : null}
                <s-url-field
                  label={t("urlLabel")}
                  placeholder="https://cdn.example.com/models/chair.glb"
                  value={url}
                  disabled={flag(!urlImportAllowed)}
                  error={urlError || undefined}
                  details={t("urlHelp")}
                  onInput={(e) => setUrl(fieldValue(e))}
                />
              </s-stack>
            ) : null}

            <s-divider />
            <s-stack direction="block" gap="small">
              <s-text type="strong">{t("srcDemo")}</s-text>
              <s-text color="subdued">{t("demoHelp")}</s-text>
              <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                {DEMO_MODELS.map((d) => (
                  <s-button
                    key={d.id}
                    icon="import"
                    onClick={() => importDemo(d)}
                  >
                    {t(d.labelKey)}
                  </s-button>
                ))}
              </s-grid>
            </s-stack>
          </s-stack>
        )}

        {primary ? (
          <ModalAction
            slot="primary-action"
            variant="primary"
            disabled={primary.disabled}
            loading={working}
            onClick={primary.onClick}
          >
            {primary.label}
          </ModalAction>
        ) : null}
        <ModalAction slot="secondary-actions" onClick={onClose}>
          {done ? tc("done") : tc("cancel")}
        </ModalAction>
      </s-modal>

      <FilePickerDialog
        open={pickerOpen}
        onOpenChange={(o) => setPickerOpen(o)}
        currentUrl={null}
        productId={`gid://shopify/Product/${product.id}`}
        blockAssigned
        onSelect={(picked) => assign(picked)}
      />
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
