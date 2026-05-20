import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  Sparkles,
  X,
} from "lucide-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ensurePlans,
  fetchActiveSubscription,
  getOrCreateUser,
} from "~/lib/billing.server";
import { FREE_PLAN_NAME } from "~/lib/billing-constants";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  hasModel: boolean;
};

type LoaderData = {
  products: ProductRow[];
  assigned: number;
  total: number;
  planTitle: string;
  modelLimit: number;
  onboardingDone: boolean;
  metafieldDefsReady: boolean;
  libraryCount: number;
};

async function checkDefsReady(admin: any): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
        query Defs {
          modelDef: metafieldDefinitions(
            first: 1
            namespace: "custom"
            key: "model_3d"
            ownerType: PRODUCT
          ) {
            edges { node { id access { storefront } } }
          }
          configDef: metafieldDefinitions(
            first: 1
            namespace: "custom"
            key: "viewer_3d_config"
            ownerType: PRODUCT
          ) {
            edges { node { id access { storefront } } }
          }
        }`,
    );
    const json = await res.json();
    const modelNode = json?.data?.modelDef?.edges?.[0]?.node;
    const configNode = json?.data?.configDef?.edges?.[0]?.node;
    function storefrontOk(node: any) {
      if (!node) return false;
      const a = node?.access?.storefront;
      return a === "PUBLIC_READ" || a === "PUBLIC_READ_WRITE";
    }
    return storefrontOk(modelNode) && storefrontOk(configNode);
  } catch {
    return false;
  }
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  await ensurePlans();
  const user = await getOrCreateUser(shop);

  const [productsRes, defsReady, libraryCount] = await Promise.all([
    admin.graphql(
      `#graphql
        query Products($first: Int!) {
          products(first: $first, sortKey: UPDATED_AT, reverse: true) {
            edges {
              node {
                id
                title
                handle
                featuredImage { url altText }
                metafield(namespace: "custom", key: "model_3d") { value }
              }
            }
          }
        }`,
      { variables: { first: 50 } },
    ),
    checkDefsReady(admin),
    prisma.model3D.count({ where: { shop } }),
  ]);

  const json = await productsRes.json();
  const products: ProductRow[] =
    json?.data?.products?.edges?.map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      featuredImageUrl: e.node.featuredImage?.url ?? null,
      featuredImageAlt: e.node.featuredImage?.altText ?? null,
      hasModel: Boolean(e.node.metafield?.value),
    })) ?? [];

  const assigned = products.filter((p) => p.hasModel).length;

  let planTitle = FREE_PLAN_NAME;
  let modelLimit = user.modelLimit ?? 5;
  const subscription = await fetchActiveSubscription(
    shop,
    session.accessToken ?? "",
    user.chargeId,
  );
  if (subscription?.status === "active") {
    planTitle = subscription.name;
    if (user.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: user.planId } });
      if (plan) {
        planTitle = plan.title;
        modelLimit = plan.modelLimit;
      }
    }
  }

  return {
    products,
    assigned,
    total: products.length,
    planTitle,
    modelLimit,
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

function OnboardingStep({
  done,
  title,
  description,
  cta,
}: {
  done: boolean;
  title: string;
  description: string;
  cta?: { label: string; href?: string; external?: boolean };
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      {done ? (
        <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
      ) : (
        <Circle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
          {description}
        </div>
      </div>
      {cta && !done && (
        <Button variant="outline" size="sm" asChild>
          {cta.external ? (
            <a href={cta.href} target="_blank" rel="noopener noreferrer">
              {cta.label} <ExternalLink className="size-3" />
            </a>
          ) : (
            <Link to={cta.href ?? "#"}>
              {cta.label} <ArrowRight className="size-3" />
            </Link>
          )}
        </Button>
      )}
    </div>
  );
}

export default function ProductsIndex() {
  const {
    products,
    assigned,
    total,
    planTitle,
    modelLimit,
    onboardingDone,
    metafieldDefsReady,
    libraryCount,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const limitReached = assigned >= modelLimit;
  const allDone = metafieldDefsReady && assigned > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Product 3D Models
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {assigned} of {total} products have a 3D model assigned.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              <Sparkles className="size-3 mr-1" />
              {planTitle} plan
            </Badge>
            <Badge variant={limitReached ? "destructive" : "outline"}>
              {assigned} / {modelLimit} models
            </Badge>
            {planTitle === FREE_PLAN_NAME && (
              <Button asChild size="sm">
                <Link to="/app/pricing">Upgrade</Link>
              </Button>
            )}
          </div>
        </div>

        {!onboardingDone && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-base">Getting started</CardTitle>
                <CardDescription>
                  Three quick steps to publish 3D models on your storefront.
                </CardDescription>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="dismiss_onboarding" />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss"
                >
                  <X className="size-4" />
                </Button>
              </Form>
            </CardHeader>
            <CardContent className="divide-y">
              <OnboardingStep
                done={metafieldDefsReady}
                title="Set up metafield definitions"
                description="Create custom.model_3d (file) and custom.viewer_3d_config (JSON) with storefront read access."
                cta={{ label: "Open Setup", href: "/app/setup" }}
              />
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
              />
              <OnboardingStep
                done={allDone}
                title="Add the theme block"
                description='In Online Store → Themes → Customize → Product template, add "3D Model Viewer" under Apps.'
              />
            </CardContent>
          </Card>
        )}

        {limitReached && planTitle === FREE_PLAN_NAME && (
          <Card className="border-amber-500 bg-amber-50">
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold">
                  You&rsquo;ve hit the Free plan limit
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {modelLimit} of {modelLimit} models in use. Upgrade to add
                  more.
                </div>
              </div>
              <Button asChild>
                <Link to="/app/pricing">View plans</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Box className="size-4" /> 3D Model Library
              </CardTitle>
              <CardDescription>
                {libraryCount === 0
                  ? "Upload standalone 3D models and embed them on any page via the page block."
                  : `${libraryCount} model${libraryCount === 1 ? "" : "s"} in your library, ready to embed on pages.`}
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/models">Open library</Link>
            </Button>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
            <CardDescription>
              Click a product to upload, replace, or configure its 3D model.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products found in this store.
              </p>
            ) : (
              <ul className="divide-y">
                {products.map((p) => {
                  const href = `/app/products/${shortId(p.id)}`;
                  return (
                    <li
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(href)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(href);
                        }
                      }}
                      className="flex items-center gap-3 py-2.5 px-2 -mx-2 cursor-pointer hover:bg-accent/40 transition-colors"
                    >
                      {p.featuredImageUrl ? (
                        <img
                          src={p.featuredImageUrl}
                          alt={p.featuredImageAlt ?? p.title}
                          className="size-12 object-cover border"
                        />
                      ) : (
                        <div className="size-12 border bg-muted" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {p.title}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          {p.hasModel ? (
                            <>
                              <Box className="size-3 text-green-600" />
                              3D model assigned
                            </>
                          ) : (
                            "No model"
                          )}
                        </div>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/60 shrink-0" />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
