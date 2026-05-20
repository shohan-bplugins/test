import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { CheckCircle2, XCircle, Wand2 } from "lucide-react";

type DefinitionStatus = {
  key: string;
  exists: boolean;
  storefrontAccess: boolean;
};

type LoaderData = {
  modelDef: DefinitionStatus;
  configDef: DefinitionStatus;
};

async function checkDefinition(
  admin: any,
  namespace: string,
  key: string,
): Promise<DefinitionStatus> {
  const res = await admin.graphql(
    `#graphql
      query MetafieldDef($namespace: String!, $key: String!) {
        metafieldDefinitions(
          first: 1
          namespace: $namespace
          key: $key
          ownerType: PRODUCT
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
    { variables: { namespace, key } },
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

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin } = await authenticate.admin(request);
  const [modelDef, configDef] = await Promise.all([
    checkDefinition(admin, "custom", "model_3d"),
    checkDefinition(admin, "custom", "viewer_3d_config"),
  ]);
  return { modelDef, configDef };
};

async function createDefinition(
  admin: any,
  input: {
    name: string;
    namespace: string;
    key: string;
    type: string;
    description: string;
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
          ownerType: "PRODUCT",
          pin: true,
          access: { storefront: "PUBLIC_READ" },
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
): Promise<string | null> {
  const defRes = await admin.graphql(
    `#graphql
      query DefId($namespace: String!, $key: String!) {
        metafieldDefinitions(
          first: 1
          namespace: $namespace
          key: $key
          ownerType: PRODUCT
        ) {
          edges { node { id } }
        }
      }`,
    { variables: { namespace, key } },
  );
  const defJson = await defRes.json();
  const id = defJson?.data?.metafieldDefinitions?.edges?.[0]?.node?.id;
  if (!id) return `Definition ${namespace}.${key} not found`;

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
          ownerType: "PRODUCT",
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
  const { admin } = await authenticate.admin(request);

  const errors: string[] = [];

  const modelErr =
    (await createDefinition(admin, {
      name: "3D Model",
      namespace: "custom",
      key: "model_3d",
      type: "file_reference",
      description: "GLB / GLTF 3D model file rendered by the viewer block.",
    })) ?? (await enableStorefrontAccess(admin, "custom", "model_3d"));
  if (modelErr) errors.push(`custom.model_3d: ${modelErr}`);

  const configErr =
    (await createDefinition(admin, {
      name: "3D Viewer Config",
      namespace: "custom",
      key: "viewer_3d_config",
      type: "json",
      description: "Per-product egjs-view3d viewer configuration (JSON).",
    })) ?? (await enableStorefrontAccess(admin, "custom", "viewer_3d_config"));
  if (configErr) errors.push(`custom.viewer_3d_config: ${configErr}`);

  if (errors.length) return { ok: false, error: errors.join(" | ") };
  return {
    ok: true,
    message: "Metafield definitions ready with storefront read access",
  };
};

function StatusRow({ def, label }: { def: DefinitionStatus; label: string }) {
  const ready = def.exists && def.storefrontAccess;
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          <code>custom.{def.key}</code>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        {ready ? (
          <>
            <CheckCircle2 className="size-4 text-green-600" /> Ready
          </>
        ) : def.exists ? (
          <>
            <XCircle className="size-4 text-amber-500" /> No storefront access
          </>
        ) : (
          <>
            <XCircle className="size-4 text-red-500" /> Missing
          </>
        )}
      </div>
    </div>
  );
}

export default function Setup() {
  const { modelDef, configDef } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? "Done");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const bothReady =
    modelDef.exists &&
    modelDef.storefrontAccess &&
    configDef.exists &&
    configDef.storefrontAccess;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Three steps to get the storefront viewer working end-to-end.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>1. Metafield definitions</CardTitle>
            <CardDescription>
              The block reads these from each product. They must exist and
              have storefront read access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatusRow def={modelDef} label="3D Model (file)" />
            <div className="border-t" />
            <StatusRow def={configDef} label="3D Viewer Config (JSON)" />

            {!bothReady && (
              <Form method="post" className="pt-3">
                <Button type="submit" disabled={submitting}>
                  <Wand2 />{" "}
                  {submitting
                    ? "Creating…"
                    : "Create / fix definitions"}
                </Button>
              </Form>
            )}

            {bothReady && (
              <p className="text-sm text-green-700 pt-2 flex items-center gap-1.5">
                <CheckCircle2 className="size-4" /> Both definitions are ready.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Add the theme block</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Online Store → Themes → <strong>Customize</strong>. Switch to the
              Product template, click <strong>Add section</strong>, scroll to
              <strong> Apps</strong>, and add <strong>3D Model Viewer</strong>.
            </p>
            <p>
              For static pages, use the <strong>3D Model Viewer (page)</strong>
              block and paste a model URL in its settings.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Upload models per product</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Open <a href="/app/products" className="text-primary underline">Product 3D Models</a>,
              click a product, and upload its .glb file. Tweak any viewer
              setting in the same screen and watch the live preview update.
            </p>
            <p className="text-muted-foreground">
              Recommended formats: <strong>.glb</strong> (single-file binary
              glTF). Keep files under ~10&nbsp;MB for fast page loads.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
