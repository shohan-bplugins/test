import type { fetchActiveSubscriptionCached } from "~/lib/billing.server";

type Admin = Parameters<typeof fetchActiveSubscriptionCached>[0];

/*
 * Product variant changes made from the 3D editor: add an option to a product
 * that only has its default variant, create a variant, update one's price /
 * compare-at price / SKU, delete one. Every call goes through the Admin API's
 * bulk variant mutations, so Shopify validates the rest (duplicate
 * combinations, option limits…) and its message is passed back.
 */

/** Unlimited = Shopify's "don't track quantity"; otherwise a stock level to set. */
export type Stock = { unlimited: true } | { unlimited: false; quantity?: number };

export type VariantOp =
  | { op: "addOption"; options: { name: string; values: string[] }[] }
  | { op: "addValues"; name: string; values: string[] }
  | { op: "removeValue"; name: string; value: string }
  | { op: "removeOption"; name: string }
  | {
      op: "setPrices";
      variantIds: string[];
      price?: string;
      compareAtPrice?: string | null;
      stock?: Stock;
    }
  | { op: "create"; options: Record<string, string>; price?: string }
  | {
      op: "update";
      variantId: string;
      price?: string;
      compareAtPrice?: string | null;
      sku?: string;
      stock?: Stock;
    }
  | { op: "delete"; variantId: string };

export type VariantResult =
  | { ok: true; done: "optionCreated" | "valuesAdded" | "valueRemoved" | "optionRemoved" | "pricesSet" | "created" | "updated" | "deleted" }
  | { ok: false; error: string };

const PRICE = /^\d{1,9}(\.\d{1,2})?$/;
const productGid = (id: string) => `gid://shopify/Product/${id}`;
const variantGid = (id: string) => `gid://shopify/ProductVariant/${id}`;
const clean = (v: unknown, max = 255) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const bad = (error: string): VariantResult => ({ ok: false, error });

async function mutate(
  admin: Admin,
  query: string,
  variables: Record<string, unknown>,
  field: string,
): Promise<string | null> {
  const res = await admin.graphql(query, { variables });
  const json: any = await res.json();
  if (json?.errors?.length) {
    return json.errors.map((e: any) => e.message).join("; ");
  }
  const errors = json?.data?.[field]?.userErrors ?? [];
  return errors.length ? errors.map((e: any) => e.message).join("; ") : null;
}

function parseStock(raw: any): Stock | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw.unlimited === true) return { unlimited: true };
  if (raw.quantity === undefined || raw.quantity === "") return { unlimited: false };
  const q = Number(raw.quantity);
  return Number.isInteger(q) && q >= 0 && q <= 999_999_999
    ? { unlimited: false, quantity: q }
    : null;
}

/** Parses and validates the posted operation; null when it is malformed. */
export function parseVariantOp(raw: any): VariantOp | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.op === "addOption") {
    // Shopify allows three options per product, and rejects a repeated name.
    const options: { name: string; values: string[] }[] = [];
    for (const o of Array.isArray(raw.options) ? raw.options.slice(0, 3) : []) {
      const name = clean(o?.name);
      const values = [
        ...new Set(
          (Array.isArray(o?.values) ? o.values : [])
            .map((v: unknown) => clean(v))
            .filter(Boolean),
        ),
      ].slice(0, 100) as string[];
      if (!name || !values.length) return null;
      if (options.some((x) => x.name.toLowerCase() === name.toLowerCase())) return null;
      options.push({ name, values });
    }
    return options.length ? { op: "addOption", options } : null;
  }
  if (raw.op === "addValues") {
    const name = clean(raw.name);
    const values = [
      ...new Set(
        (Array.isArray(raw.values) ? raw.values : [])
          .map((v: unknown) => clean(v))
          .filter(Boolean),
      ),
    ].slice(0, 100) as string[];
    return name && values.length ? { op: "addValues", name, values } : null;
  }
  if (raw.op === "removeValue") {
    const name = clean(raw.name);
    const value = clean(raw.value);
    return name && value ? { op: "removeValue", name, value } : null;
  }
  if (raw.op === "removeOption") {
    const name = clean(raw.name);
    return name ? { op: "removeOption", name } : null;
  }
  if (raw.op === "setPrices") {
    const ids: string[] = [
      ...new Set<string>(
        (Array.isArray(raw.variantIds) ? raw.variantIds : []).map((v: unknown) => String(v)),
      ),
    ];
    // One bulk mutation takes at most 250 variants.
    if (!ids.length || ids.length > 250 || !ids.every((v) => /^\d+$/.test(v))) return null;
    const price = clean(raw.price, 20);
    if (price && !PRICE.test(price)) return null;
    const compare = clean(raw.compareAtPrice, 20);
    if (compare && !PRICE.test(compare)) return null;
    const stock = parseStock(raw.stock);
    if (stock === null) return null;
    const out: VariantOp = { op: "setPrices", variantIds: ids };
    if (price) out.price = price;
    if (raw.compareAtPrice !== undefined) out.compareAtPrice = compare || null;
    if (stock) out.stock = stock;
    // Nothing to change is not a request.
    return out.price || out.compareAtPrice !== undefined || out.stock ? out : null;
  }
  if (raw.op === "create") {
    const entries = Object.entries(raw.options ?? {})
      .map(([k, v]) => [clean(k), clean(v)] as const)
      .filter(([k, v]) => k && v);
    if (!entries.length) return null;
    const price = clean(raw.price, 20);
    if (price && !PRICE.test(price)) return null;
    return {
      op: "create",
      options: Object.fromEntries(entries),
      ...(price ? { price } : {}),
    };
  }
  if (raw.op === "update") {
    if (!/^\d+$/.test(String(raw.variantId ?? ""))) return null;
    const out: VariantOp = { op: "update", variantId: String(raw.variantId) };
    if (raw.price !== undefined) {
      const price = clean(raw.price, 20);
      if (!PRICE.test(price)) return null;
      out.price = price;
    }
    if (raw.compareAtPrice !== undefined) {
      const c = clean(raw.compareAtPrice, 20);
      if (c && !PRICE.test(c)) return null;
      out.compareAtPrice = c || null;
    }
    if (raw.sku !== undefined) out.sku = clean(raw.sku, 255);
    const stock = parseStock(raw.stock);
    if (stock === null) return null;
    if (stock) out.stock = stock;
    return out;
  }
  if (raw.op === "delete") {
    return /^\d+$/.test(String(raw.variantId ?? ""))
      ? { op: "delete", variantId: String(raw.variantId) }
      : null;
  }
  return null;
}

/**
 * Sets the available quantity of each variant at its first stocked location.
 * Needs write_inventory. Only runs for a tracked stock level with a quantity;
 * "unlimited" was already handled by turning tracking off.
 */
async function applyQuantity(
  admin: Admin,
  variantIds: string[],
  stock: Stock | undefined,
): Promise<string | null> {
  if (!stock || stock.unlimited || stock.quantity === undefined) return null;
  const res = await admin.graphql(
    `#graphql
      query VariantLocations($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } } } }
          }
        }
      }`,
    { variables: { ids: variantIds.map(variantGid) } },
  );
  const json: any = await res.json();
  if (json?.errors?.length) return json.errors.map((e: any) => e.message).join("; ");
  const quantities: Record<string, unknown>[] = [];
  for (const node of json?.data?.nodes ?? []) {
    const locationId = node?.inventoryItem?.inventoryLevels?.nodes?.[0]?.location?.id;
    if (locationId) {
      quantities.push({
        inventoryItemId: node.inventoryItem.id,
        locationId,
        quantity: stock.quantity,
      });
    }
  }
  if (!quantities.length) return "No stocked location found for this variant.";
  return mutate(
    admin,
    `#graphql
      mutation SetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { field message }
        }
      }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities,
      },
    },
    "inventorySetQuantities",
  );
}

export async function applyVariantOp(
  admin: Admin,
  productId: string,
  op: VariantOp,
  messages: { lastVariant: string },
): Promise<VariantResult> {
  const product = productGid(productId);

  if (op.op === "addOption") {
    const error = await mutate(
      admin,
      `#graphql
        mutation AddOption($productId: ID!, $options: [OptionCreateInput!]!) {
          productOptionsCreate(
            productId: $productId
            options: $options
            variantStrategy: CREATE
          ) {
            userErrors { field message }
          }
        }`,
      {
        productId: product,
        options: op.options.map((o) => ({
          name: o.name,
          values: o.values.map((name) => ({ name })),
        })),
      },
      "productOptionsCreate",
    );
    return error ? bad(error) : { ok: true, done: "optionCreated" };
  }

  if (op.op === "addValues") {
    // The editor knows options by name; the mutation wants the option's id.
    const res = await admin.graphql(
      `#graphql
        query ProductOptions($id: ID!) { product(id: $id) { options { id name } } }`,
      { variables: { id: product } },
    );
    const found = ((await res.json()) as any)?.data?.product?.options?.find(
      (o: any) => o.name === op.name,
    );
    if (!found) return bad(messages.lastVariant);
    const error = await mutate(
      admin,
      `#graphql
        mutation AddOptionValues($productId: ID!, $option: OptionUpdateInput!, $values: [OptionValueCreateInput!]!) {
          productOptionUpdate(
            productId: $productId
            option: $option
            optionValuesToAdd: $values
            variantStrategy: MANAGE
          ) {
            userErrors { field message }
          }
        }`,
      {
        productId: product,
        option: { id: found.id },
        values: op.values.map((name) => ({ name })),
      },
      "productOptionUpdate",
    );
    return error ? bad(error) : { ok: true, done: "valuesAdded" };
  }

  if (op.op === "removeValue" || op.op === "removeOption") {
    const res = await admin.graphql(
      `#graphql
        query ProductOptionIds($id: ID!) {
          product(id: $id) { options { id name optionValues { id name } } }
        }`,
      { variables: { id: product } },
    );
    const options: any[] = ((await res.json()) as any)?.data?.product?.options ?? [];
    const option = options.find((o) => o.name === op.name);
    if (!option) return bad(messages.lastVariant);
    // Shopify keeps at least one option, and one value per option.
    if (op.op === "removeOption") {
      if (options.length <= 1) return bad(messages.lastVariant);
      const error = await mutate(
        admin,
        `#graphql
          mutation RemoveOption($productId: ID!, $options: [ID!]!) {
            productOptionsDelete(productId: $productId, options: $options) {
              userErrors { field message }
            }
          }`,
        { productId: product, options: [option.id] },
        "productOptionsDelete",
      );
      return error ? bad(error) : { ok: true, done: "optionRemoved" };
    }
    const value = option.optionValues?.find((v: any) => v.name === op.value);
    if (!value || option.optionValues.length <= 1) return bad(messages.lastVariant);
    const error = await mutate(
      admin,
      `#graphql
        mutation RemoveOptionValue($productId: ID!, $option: OptionUpdateInput!, $values: [ID!]!) {
          productOptionUpdate(
            productId: $productId
            option: $option
            optionValuesToDelete: $values
          ) {
            userErrors { field message }
          }
        }`,
      { productId: product, option: { id: option.id }, values: [value.id] },
      "productOptionUpdate",
    );
    return error ? bad(error) : { ok: true, done: "valueRemoved" };
  }

  if (op.op === "setPrices") {
    const hasFields =
      op.price !== undefined || op.compareAtPrice !== undefined || !!op.stock;
    if (hasFields && (op.price !== undefined || op.compareAtPrice !== undefined || op.stock)) {
      const error = await mutate(
        admin,
        `#graphql
          mutation SetPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }`,
        {
          productId: product,
          variants: op.variantIds.map((id) => ({
            id: variantGid(id),
            ...(op.price !== undefined ? { price: op.price } : {}),
            ...(op.compareAtPrice !== undefined ? { compareAtPrice: op.compareAtPrice } : {}),
            ...(op.stock ? { inventoryItem: { tracked: !op.stock.unlimited } } : {}),
          })),
        },
        "productVariantsBulkUpdate",
      );
      if (error) return bad(error);
    }
    const stockError = await applyQuantity(admin, op.variantIds, op.stock);
    return stockError ? bad(stockError) : { ok: true, done: "pricesSet" };
  }

  if (op.op === "create") {
    const error = await mutate(
      admin,
      `#graphql
        mutation CreateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }`,
      {
        productId: product,
        variants: [
          {
            optionValues: Object.entries(op.options).map(([optionName, name]) => ({
              optionName,
              name,
            })),
            ...(op.price ? { price: op.price } : {}),
          },
        ],
      },
      "productVariantsBulkCreate",
    );
    return error ? bad(error) : { ok: true, done: "created" };
  }

  if (op.op === "update") {
    const variant: Record<string, unknown> = { id: variantGid(op.variantId) };
    if (op.price !== undefined) variant.price = op.price;
    if (op.compareAtPrice !== undefined) variant.compareAtPrice = op.compareAtPrice;
    const inventoryItem: Record<string, unknown> = {};
    if (op.sku !== undefined) inventoryItem.sku = op.sku;
    if (op.stock) inventoryItem.tracked = !op.stock.unlimited;
    if (Object.keys(inventoryItem).length) variant.inventoryItem = inventoryItem;
    const error = await mutate(
      admin,
      `#graphql
        mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }`,
      { productId: product, variants: [variant] },
      "productVariantsBulkUpdate",
    );
    if (error) return bad(error);
    const stockError = await applyQuantity(admin, [op.variantId], op.stock);
    return stockError ? bad(stockError) : { ok: true, done: "updated" };
  }

  // delete — never the product's last variant
  const countRes = await admin.graphql(
    `#graphql
      query VariantCount($id: ID!) { product(id: $id) { variantsCount { count } } }`,
    { variables: { id: product } },
  );
  const count = ((await countRes.json()) as any)?.data?.product?.variantsCount?.count;
  if (typeof count === "number" && count <= 1) return bad(messages.lastVariant);
  const error = await mutate(
    admin,
    `#graphql
      mutation DeleteVariant($productId: ID!, $variantsIds: [ID!]!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
          userErrors { field message }
        }
      }`,
    { productId: product, variantsIds: [variantGid(op.variantId)] },
    "productVariantsBulkDelete",
  );
  return error ? bad(error) : { ok: true, done: "deleted" };
}

/**
 * Runs a posted `{ intent: "variant", op, … }` body and words the outcome with
 * the "editor" namespace's messages, ready to hand back to VariantsPanel.
 */
export async function runVariantOp(
  admin: Admin,
  productId: string,
  body: unknown,
  t: (key: string) => string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const op = parseVariantOp(body);
  if (!op) return { ok: false, error: t("errVariant") };
  const done = await applyVariantOp(admin, productId, op, { lastVariant: t("errLastVariant") });
  if (!done.ok) return { ok: false, error: done.error };
  const message = {
    optionCreated: t("variantOptionCreated"),
    valuesAdded: t("variantValuesAdded"),
    valueRemoved: t("variantValueRemoved"),
    optionRemoved: t("variantOptionRemoved"),
    pricesSet: t("variantPricesSet"),
    created: t("variantCreated"),
    updated: t("variantSaved"),
    deleted: t("variantDeleted"),
  }[done.done];
  return { ok: true, message };
}

/** Largest snapshot accepted as a variant image. */
export const MAX_VARIANT_IMAGE_BYTES = 8 * 1024 * 1024;
/** Waiting for a new image to finish processing: up to ~15 s. */
const IMAGE_READY_TRIES = 30;
const IMAGE_READY_WAIT_MS = 500;

/**
 * Makes `image` (a snapshot of the 3D model) the image of each given variant:
 * staged upload, create it in Files, wait for it to be ready, add it to the
 * product's media, then point every variant at it.
 */
export async function setVariantImage(
  admin: Admin,
  productId: string,
  variantIds: string[],
  image: File,
  alt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error });
  const stagedRes = await admin.graphql(
    `#graphql
      mutation VariantImageStage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: image.name || "variant-3d.jpg",
            mimeType: image.type || "image/jpeg",
            resource: "IMAGE",
            fileSize: String(image.size),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const staged: any = await stagedRes.json();
  const target = staged?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    const errs = staged?.data?.stagedUploadsCreate?.userErrors ?? [];
    return fail(errs.map((e: any) => e.message).join("; ") || "Upload failed");
  }

  const fd = new FormData();
  for (const p of target.parameters) fd.append(p.name, p.value);
  fd.append("file", image);
  const up = await fetch(target.url, { method: "POST", body: fd });
  if (!up.ok) return fail("Upload failed");

  // 1. Create the image in Files. fileCreate hands back its id straight away;
  //    productVariantsBulkUpdate's own `media` + `mediaSrc` does not, and drops
  //    the variant link while the image still processes.
  const createRes = await admin.graphql(
    `#graphql
      mutation VariantImageCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "IMAGE",
            alt: clean(alt, 512),
          },
        ],
      },
    },
  );
  const created: any = await createRes.json();
  const createErrors = created?.data?.fileCreate?.userErrors ?? [];
  if (createErrors.length) return fail(createErrors.map((e: any) => e.message).join("; "));
  const mediaId: string | undefined = created?.data?.fileCreate?.files?.[0]?.id;
  if (!mediaId) return fail("Upload failed");

  // 2. Wait until Shopify has processed it — it can't be attached to the
  //    product or a variant before it is READY.
  for (let i = 0; ; i++) {
    const res = await admin.graphql(
      `#graphql
        query VariantImageStatus($id: ID!) {
          node(id: $id) { ... on MediaImage { status } }
        }`,
      { variables: { id: mediaId } },
    );
    const status = ((await res.json()) as any)?.data?.node?.status;
    if (status === "READY") break;
    if (status === "FAILED") return fail("Shopify couldn't process the image");
    if (i >= IMAGE_READY_TRIES) return fail("The image is still processing. Try again in a moment.");
    await new Promise((r) => setTimeout(r, IMAGE_READY_WAIT_MS));
  }

  // 3. Add it to the product's media. Only fileUpdate takes referencesToAdd;
  //    fileCreate rejects it.
  const linkError = await mutate(
    admin,
    `#graphql
      mutation VariantImageLink($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) {
          userErrors { field message }
        }
      }`,
    { files: [{ id: mediaId, referencesToAdd: [productGid(productId)] }] },
    "fileUpdate",
  );
  if (linkError) return fail(linkError);

  // 4. Make it each variant's image (replacing whatever image it had).
  const error = await mutate(
    admin,
    `#graphql
      mutation VariantImageSet($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
    {
      productId: productGid(productId),
      variants: variantIds.map((id) => ({ id: variantGid(id), mediaId })),
    },
    "productVariantsBulkUpdate",
  );
  return error ? fail(error) : { ok: true };
}
