import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { checkDefsReadyCached } from "~/lib/metafields.server";
import prisma from "../db.server";
import {
  countDistinctModels,
  fetchActiveSubscriptionCached,
  getAssignedModelGidsCached,
  getOrCreateUser,
  getPlans,
  productsFirstPageCache,
} from "~/lib/billing.server";
import {
  FREE_MODEL_LIMIT,
  FREE_PLAN_NAME,
  FREE_PRODUCT_LIMIT,
  formatLimit,
} from "~/lib/billing-constants";

import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import {
  BUTTON_FILL,
  fieldValue,
  flag,
  useRouteNav,
} from "~/components/polaris/helpers";

const PAGE_SIZE = 10;

/** Shopify ProductStatus. Only ACTIVE products are live on the storefront. */
type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  status: ProductStatus;
  featuredImageUrl: string | null;
  hasModel: boolean;
  onlineStoreUrl: string | null;
};

type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

type LoaderData = {
  products: ProductRow[];
  assigned: number;
  distinctModelsUsed: number;
  totalProducts: number;
  matchCount: number;
  query: string;
  pageInfo: PageInfo;
  shopDomain: string | null;
  planTitle: string;
  modelLimit: number;
  productLimit: number;
  onboardingDone: boolean;
  metafieldDefsReady: boolean;
  libraryCount: number;
};

/*
 * The default view (first page, no search) reads through a per-shop cache;
 * searches and paging always go to Shopify. See productsFirstPageCache.
 */
function readProductsPage(
  shop: string,
  isFirstPage: boolean,
  load: () => Promise<unknown>,
): Promise<unknown> {
  return isFirstPage ? productsFirstPageCache.read(shop, load) : load();
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const searchQuery = q ? `title:*${q.replace(/["*]/g, "")}*` : null;

  const pageVars: Record<string, unknown> = { query: searchQuery };
  if (before) {
    pageVars.last = PAGE_SIZE;
    pageVars.before = before;
  } else {
    pageVars.first = PAGE_SIZE;
    if (after) pageVars.after = after;
  }

  /*
   * `user` and the plan list join this block instead of being fetched ahead of
   * it. Neither is read by anything inside it, and against Mongo each serial
   * round trip is ~250ms of TTFB — see the note in seedPlans. Same shape as the
   * dashboard loader.
   */
  const [
    user,
    plans,
    productsRes,
    defsReady,
    libraryGids,
    assignedModels,
    subscription,
  ] = await Promise.all([
    // getOrCreateUser seeds the plans itself.
    getOrCreateUser(shop),
    getPlans(),
    readProductsPage(shop, !q && !after && !before, () =>
      admin
        .graphql(
          `#graphql
        query Products(
          $first: Int
          $after: String
          $last: Int
          $before: String
          $query: String
        ) {
          products(
            first: $first
            after: $after
            last: $last
            before: $before
            sortKey: UPDATED_AT
            reverse: true
            query: $query
          ) {
            edges {
              cursor
              node {
                id
                title
                handle
                status
                onlineStoreUrl
                featuredImage { url }
                metafield(namespace: "custom", key: "model_3d") { value }
              }
            }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
          }
          matchCount: productsCount(query: $query) { count }
          totalCount: productsCount { count }
          shop { primaryDomain { url } }
        }`,
          { variables: pageVars },
        )
        .then((res) => res.json()),
    ),
    checkDefsReadyCached(admin, shop),
    prisma.model3D.findMany({ where: { shop }, select: { fileGid: true } }),
    getAssignedModelGidsCached(admin, shop),
    // Was a separate sequential await further down the loader.
    fetchActiveSubscriptionCached(admin, shop),
  ]);

  const json = productsRes as any;
  const products: ProductRow[] =
    json?.data?.products?.edges?.map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      status: (e.node.status ?? "ACTIVE") as ProductStatus,
      featuredImageUrl: e.node.featuredImage?.url ?? null,
      hasModel: Boolean(e.node.metafield?.value),
      onlineStoreUrl: e.node.onlineStoreUrl ?? null,
    })) ?? [];

  const pageInfo: PageInfo = json?.data?.products?.pageInfo ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  };
  const matchCount = json?.data?.matchCount?.count ?? products.length;
  const totalProducts = json?.data?.totalCount?.count ?? products.length;
  const shopDomain = json?.data?.shop?.primaryDomain?.url ?? null;
  const assigned = assignedModels.count;
  const libraryCount = libraryGids.length;
  const distinctModelsUsed = countDistinctModels(
    libraryGids.map((m) => m.fileGid),
    assignedModels.gids,
  );

  let planTitle = FREE_PLAN_NAME;
  let modelLimit = user.modelLimit ?? FREE_MODEL_LIMIT;
  let productLimit = user.productLimit ?? FREE_PRODUCT_LIMIT;
  if (subscription?.status === "active") {
    planTitle = subscription.name;
    const plan = plans.find((p) => p.id === user.planId);
    if (plan) {
      planTitle = plan.title;
      modelLimit = plan.modelLimit;
      productLimit = plan.productLimit;
    }
  }

  return {
    products,
    assigned,
    distinctModelsUsed,
    totalProducts,
    matchCount,
    query: q,
    pageInfo,
    shopDomain,
    planTitle,
    modelLimit,
    productLimit,
    onboardingDone: user.onboardingDone,
    metafieldDefsReady: defsReady,
    libraryCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "dismiss_onboarding") {
    await prisma.appUser.update({
      where: { shop },
      data: { onboardingDone: true },
    });
    return { ok: true };
  }
  return { ok: false };
};

function shortId(gid: string) {
  return gid.split("/").pop() ?? gid;
}

function previewUrl(p: ProductRow, shopDomain: string | null): string | null {
  if (p.status !== "ACTIVE") return null;
  if (p.onlineStoreUrl) return p.onlineStoreUrl;
  if (shopDomain) return `${shopDomain}/products/${p.handle}`;
  return null;
}

const STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <s-badge
      tone={
        status === "ACTIVE"
          ? "success"
          : status === "DRAFT"
            ? "warning"
            : "neutral"
      }
    >
      {STATUS_LABELS[status]}
    </s-badge>
  );
}

/** Edge of a product thumbnail, in px. One number, so nothing can disagree. */
const THUMB_SIZE = 32;

/**
 * A product's image, or a placeholder of exactly the same size.
 *
 * Both states share one box, which is the whole point: the image used to be an
 * s-thumbnail and the placeholder a box, so they were sized by different rules
 * and never quite matched. A thumbnail also sizes to its image's aspect ratio,
 * so a wide product photo came out wider than a tall one and the column of
 * titles beside them stopped lining up.
 *
 * The box is square and clips; the image fills it with `cover`, so any aspect
 * ratio is cropped to the same footprint rather than changing the row's shape.
 * A plain img because that crop is the requirement and Thumbnail has no prop
 * for it — the box around it still carries the admin's own surface and border.
 *
 * alt is empty by design: the product's name is immediately beside it, so
 * naming it here would have a screen reader announce the product twice.
 */
function ProductThumb({ src }: { src: string | null }) {
  return (
    <s-box
      inlineSize={`${THUMB_SIZE}px`}
      blockSize={`${THUMB_SIZE}px`}
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
          width={THUMB_SIZE}
          height={THUMB_SIZE}
          loading="lazy"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        /*
          `image-none` is the admin's own mark for this — a picture with a line
          through it — so an empty cell reads as "no image" rather than as one
          that failed to load.
        */
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

function OnboardingStep({
  done,
  title,
  description,
  cta,
  onNavigate,
}: {
  done: boolean;
  title: string;
  description: string;
  cta?: { label: string; href?: string; external?: boolean };
  onNavigate?: (href: string) => void;
}) {
  return (
    <s-stack
      direction="inline"
      gap="base"
      alignItems="start"
      justifyContent="space-between"
      inlineSize="100%"
    >
      <s-stack direction="inline" gap="small" alignItems="start">
        <s-icon
          type={done ? "check-circle-filled" : "circle"}
          tone={done ? "success" : "neutral"}
          color={done ? "base" : "subdued"}
        />
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
      </s-stack>

      {cta && !done ? (
        cta.external ? (
          <s-button href={cta.href} target="_blank" icon="external">
            {cta.label}
          </s-button>
        ) : (
          <s-button
            href={cta.href}
            onClick={(event) => {
              event.preventDefault();
              if (cta.href) onNavigate?.(cta.href);
            }}
          >
            {cta.label}
          </s-button>
        )
      ) : null}
    </s-stack>
  );
}

export default function ProductsIndex() {
  const {
    products,
    assigned,
    distinctModelsUsed,
    totalProducts,
    matchCount,
    query,
    pageInfo,
    shopDomain,
    planTitle,
    modelLimit,
    productLimit,
    onboardingDone,
    metafieldDefsReady,
    libraryCount,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const routeTo = useRouteNav();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput.trim() === query) return;
      const params = new URLSearchParams(searchParams);
      if (searchInput.trim()) params.set("q", searchInput.trim());
      else params.delete("q");
      params.delete("after");
      params.delete("before");
      setSearchParams(params, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function goNext() {
    const params = new URLSearchParams(searchParams);
    params.delete("before");
    if (pageInfo.endCursor) params.set("after", pageInfo.endCursor);
    setSearchParams(params);
  }

  function goPrev() {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    if (pageInfo.startCursor) params.set("before", pageInfo.startCursor);
    setSearchParams(params);
  }

  const modelLimitReached = distinctModelsUsed >= modelLimit;
  const productLimitReached = assigned >= productLimit;
  const limitReached = modelLimitReached || productLimitReached;
  const allDone = metafieldDefsReady && assigned > 0;

  return (
    <s-page heading="Product 3D models">
      <BackButton to="/app" label="Dashboard" />

      {/* Same reasoning as the dashboard: one primary action per page, and it
          is the one the merchant is here to take. Upgrade steps down beside it
          rather than competing with it. */}
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/models"
        onClick={routeTo("/app/models")}
      >
        Open model library
      </s-button>
      {planTitle === FREE_PLAN_NAME ? (
        <s-button
          slot="secondary-actions"
          href="/app/pricing"
          onClick={routeTo("/app/pricing")}
        >
          Upgrade
        </s-button>
      ) : null}
      <SupportAction />

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            {assigned} of {totalProducts} products have a 3D model assigned.
          </s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge icon="wand">{`${planTitle} plan`}</s-badge>
            <s-badge tone={productLimitReached ? "critical" : "neutral"}>
              {`${assigned} / ${formatLimit(productLimit)} products`}
            </s-badge>
            <s-badge tone={modelLimitReached ? "critical" : "neutral"}>
              {`${distinctModelsUsed} / ${formatLimit(modelLimit)} models`}
            </s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      {!onboardingDone ? (
        <s-section heading="Getting started">
          <s-paragraph color="subdued">
            Three quick steps to publish 3D models on your storefront.
          </s-paragraph>

          {/* secondary-actions, unstyled: that slot takes only "secondary" or "auto". */}
          <s-button
            slot="secondary-actions"
            icon="x"
            accessibilityLabel="Dismiss getting started"
            onClick={() =>
              submit({ intent: "dismiss_onboarding" }, { method: "post" })
            }
          />

          <s-stack direction="block" gap="base">
            <OnboardingStep
              done={metafieldDefsReady}
              title="Set up metafield definitions"
              description="Create custom.model_3d (file) and custom.viewer_3d_config (JSON) with storefront read access."
              cta={{ label: "Open Setup", href: "/app/setup" }}
              onNavigate={navigate}
            />
            <s-divider />
            <OnboardingStep
              done={assigned > 0}
              title="Upload your first model"
              description="Pick a product and upload a .glb file. The block automatically reads it on the storefront."
              cta={
                products[0]
                  ? {
                      label: "Open product",
                      href: `/app/products/${shortId(products[0].id)}`,
                    }
                  : undefined
              }
              onNavigate={navigate}
            />
            <s-divider />
            <OnboardingStep
              done={allDone}
              title="Add the theme block"
              description='In Online Store → Themes → Customize → Product template, add "3D Viewer — Product" under Apps.'
            />
          </s-stack>
        </s-section>
      ) : null}

      {limitReached ? (
        <s-banner
          tone="warning"
          heading={`You've hit the ${planTitle} plan limit`}
        >
          <s-paragraph>
            {productLimitReached
              ? `${assigned} of ${formatLimit(productLimit)} products already have a 3D model.`
              : `${distinctModelsUsed} of ${formatLimit(modelLimit)} models in use.`}{" "}
            Upgrade to add more.
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            href="/app/pricing"
            onClick={routeTo("/app/pricing")}
            accessibilityLabel="View pricing plans"
          >
            View plans
          </s-button>
        </s-banner>
      ) : null}

      <s-section heading="3D model library">
        <s-paragraph color="subdued">
          {libraryCount === 0
            ? "Upload standalone 3D models and embed them on any page via the page block."
            : `${libraryCount} model${libraryCount === 1 ? "" : "s"} in your library, ready to embed on pages.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          href="/app/models"
          onClick={routeTo("/app/models")}
        >
          Open library
        </s-button>
      </s-section>

      <s-section heading="Products">
        <s-paragraph color="subdued">
          Click a product to upload, replace, or configure its 3D model.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-search-field
            label="Search products"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search products by title"
            value={searchInput}
            onInput={(e) => setSearchInput(fieldValue(e))}
          />

          {query ? (
            <s-text color="subdued">
              {matchCount} result{matchCount === 1 ? "" : "s"} for “{query}”
            </s-text>
          ) : null}

          {products.length === 0 ? (
            <s-text color="subdued">
              {query
                ? `No products match "${query}".`
                : "No products found in this store."}
            </s-text>
          ) : (
            /*
              Pagination is the table's own: Shopify's product connection is
              cursor-based, so the table reports whether each direction exists
              and hands the click back rather than owning page numbers.
            */
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>3D model</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {products.map((p) => {
                  const href = `/app/products/${shortId(p.id)}`;
                  const preview = previewUrl(p, shopDomain);
                  return (
                    <s-table-row key={p.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small"
                          alignItems="center"
                        >
                          <ProductThumb src={p.featuredImageUrl} />
                          <s-link href={href} onClick={routeTo(href)}>
                            {p.title}
                          </s-link>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <StatusBadge status={p.status} />
                      </s-table-cell>
                      <s-table-cell>
                        {p.hasModel ? (
                          <s-badge tone="success" icon="check">
                            Assigned
                          </s-badge>
                        ) : (
                          <s-text color="subdued">No model</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {/*
                          A grid with a fixed first track, so "Add" and "Update"
                          come out the same width and the buttons line up down
                          the column instead of each shrink-wrapping its own
                          label. s-button exposes no width of its own in the
                          React bindings, but a grid item stretches to its track
                          by default, which gets there without one.
                        */}
                        <s-grid
                          gridTemplateColumns="88px auto"
                          gap="small-500"
                          alignItems="center"
                        >
                          {/*
                            The model action leads, and its emphasis states what
                            the row still needs: primary on a product with no
                            model yet — the one thing this page exists to get
                            done — and secondary once there is one to update, so
                            a list of finished rows has no column of loud buttons
                            competing with the products that do need attention.
                          */}
                          <s-button
                            {...BUTTON_FILL}
                            variant={p.hasModel ? "secondary" : "primary"}
                            href={href}
                            onClick={routeTo(href)}
                          >
                            {p.hasModel ? "Update" : "Add"}
                          </s-button>
                          {/*
                            A draft or archived product has no storefront page
                            to open, so the action is dropped rather than shown
                            disabled with a title attribute no touch or screen
                            reader user could read.
                          */}
                          {preview ? (
                            <s-button
                              variant="tertiary"
                              icon="external"
                              href={preview}
                              target="_blank"
                              accessibilityLabel={`Preview ${p.title} on your storefront`}
                            />
                          ) : null}
                        </s-grid>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}

          {/*
            The card's footer: the count on the left, the page controls hard
            right at the bottom — where the admin puts them on its own lists.

            s-table can paginate itself, but then the controls sit wherever the
            component places them, with no way to line them up with the count
            that belongs beside them. Driving the cursors here costs two buttons
            and puts the whole footer under this page's control.
          */}
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="base"
            alignItems="center"
            inlineSize="100%"
          >
            <s-text color="subdued">
              {query
                ? `${matchCount} matching product${matchCount === 1 ? "" : "s"}`
                : `${totalProducts} products total`}
            </s-text>

            {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
              <s-stack direction="inline" gap="small-500" alignItems="center">
                <s-button
                  icon="chevron-left"
                  accessibilityLabel="Previous page"
                  disabled={flag(!pageInfo.hasPreviousPage)}
                  onClick={goPrev}
                />
                <s-button
                  icon="chevron-right"
                  accessibilityLabel="Next page"
                  disabled={flag(!pageInfo.hasNextPage)}
                  onClick={goNext}
                />
              </s-stack>
            ) : null}
          </s-grid>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
