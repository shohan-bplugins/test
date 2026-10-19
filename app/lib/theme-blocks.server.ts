import { APP_HANDLE } from "./app-config";

/** Just the one method these helpers need off the authenticated admin client. */
type AdminClient = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

import {
  createShopCache,
  SHOP_CACHE_TTL_MS,
} from "~/lib/shop-cache.server";

export type ThemeBlockStatus = {
  productBlockAdded: boolean;
  pageBlockAdded: boolean;
  addedCount: number;
  totalBlocks: number;
  themeId: string | null;
};

/*
 * Reading and writing a theme template used to go through the REST Asset
 * endpoint (/admin/api/<v>/themes/<id>/assets.json). That had to change: the
 * REST Admin API is legacy, and Shopify requires apps submitted to the App Store
 * to be built exclusively on the GraphQL Admin API. Both halves now go through
 * `theme.files` and `themeFilesUpsert`, which take the theme's GID rather than a
 * numeric id — see `themeGid` below.
 */

/*
 * Shopify's JSON templates are JSONC, not JSON. The admin writes an
 * auto-generated `/* ... *\/` header into them — Dawn's templates/product.json
 * opens with one — and JSON.parse rejects that outright. Both readers in this
 * file used to hand the raw file straight to JSON.parse, so on any theme with
 * that header "Add block for me" threw a SyntaxError into addThemeBlock's catch
 * (surfacing as an unusable `Unexpected token '/'` message) and
 * checkThemeBlocks silently counted zero blocks no matter what was installed.
 *
 * Comments may only be stripped outside string literals: the same Dawn template
 * carries three `//` sequences inside strings, and a naive strip would corrupt
 * the file this module is about to write back.
 */
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end === -1 ? input.length : end + 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = input.indexOf("\n", i + 2);
      if (newline === -1) break;
      i = newline - 1;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Index of the first character of the JSON body — everything before it is the
 * generated comment header, which is preserved verbatim on write so this module
 * does not quietly strip a warning Shopify put there on purpose.
 */
function jsonBodyStart(raw: string): number {
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const next = raw[i + 1];
    if (char === "/" && next === "*") {
      const end = raw.indexOf("*/", i + 2);
      if (end === -1) return raw.length;
      i = end + 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = raw.indexOf("\n", i + 2);
      if (newline === -1) return raw.length;
      i = newline;
      continue;
    }
    if (!/\s/.test(char)) return i;
  }
  return raw.length;
}

/** Parses a theme JSON template, comment header and all. */
function parseThemeTemplate(raw: string): any {
  return JSON.parse(stripJsonComments(raw.slice(jsonBodyStart(raw))));
}

function makeBlockId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * GraphQL wants "gid://shopify/OnlineStoreTheme/123". Callers hand us whichever
 * they happen to hold — `checkThemeBlocks` returns the numeric id (it is what
 * the theme-editor URL needs), while a GID may arrive straight from another
 * query — so normalise instead of demanding one.
 */
function themeGid(themeId: string): string {
  return themeId.startsWith("gid://")
    ? themeId
    : `gid://shopify/OnlineStoreTheme/${themeId}`;
}

/** The numeric tail of a theme id, for building admin URLs. */
function themeNumericId(themeId: string): string {
  return themeId.startsWith("gid://")
    ? themeId.split("/").pop() ?? themeId
    : themeId;
}

async function getThemeFile(
  admin: AdminClient,
  themeId: string,
  filename: string,
): Promise<string | null> {
  const res = await admin.graphql(
    `#graphql
      query ThemeFile($themeId: ID!, $filenames: [String!]!) {
        theme(id: $themeId) {
          files(filenames: $filenames, first: 1) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText { content }
              }
            }
          }
        }
      }`,
    { variables: { themeId: themeGid(themeId), filenames: [filename] } },
  );
  const json: any = await res.json();
  const content = json?.data?.theme?.files?.nodes?.[0]?.body?.content;
  return typeof content === "string" ? content : null;
}

async function putThemeFile(
  admin: AdminClient,
  themeId: string,
  filename: string,
  value: string,
): Promise<void> {
  const res = await admin.graphql(
    `#graphql
      mutation ThemeFileUpsert(
        $themeId: ID!
        $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      ) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        themeId: themeGid(themeId),
        files: [{ filename, body: { type: "TEXT", value } }],
      },
    },
  );
  const json: any = await res.json();

  // Two separate failure channels, and only checking one is how a write that
  // silently did nothing would still report success: `errors` is a rejected
  // query (bad field, missing scope), `userErrors` a rejected *write* (locked
  // theme, invalid Liquid).
  const topLevel = json?.errors;
  if (Array.isArray(topLevel) && topLevel.length) {
    throw new Error(topLevel.map((e: any) => e?.message).join("; "));
  }
  const userErrors = json?.data?.themeFilesUpsert?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e: any) => e.message).join("; "));
  }
  if (!json?.data?.themeFilesUpsert?.upsertedThemeFiles?.length) {
    throw new Error("Shopify accepted the request but wrote no file.");
  }
}

export type AddThemeBlockResult =
  | { ok: true; editorUrl: string }
  | { ok: false; error: string };

export async function addThemeBlock(
  admin: AdminClient,
  shop: string,
  themeId: string,
  templateKey: "templates/product.json" | "templates/page.json",
  blockHandle: "product_viewer" | "page_viewer",
): Promise<AddThemeBlockResult> {
  try {
    const assetValue = await getThemeFile(admin, themeId, templateKey);

    if (!assetValue) {
      return {
        ok: false,
        error:
          "Your theme uses vintage Liquid templates and doesn't support programmatic block insertion. Please add the block manually in the Theme Editor.",
      };
    }

    const header = assetValue.slice(0, jsonBodyStart(assetValue));
    const template = parseThemeTemplate(assetValue);
    const sections = template.sections || {};

    let appsSectionId = Object.keys(sections).find(
      (k) => sections[k]?.type === "apps",
    );

    if (!appsSectionId) {
      appsSectionId = `apps-${makeBlockId()}`;
      sections[appsSectionId] = {
        type: "apps",
        blocks: {},
        block_order: [],
        settings: {},
      };
      template.sections = sections;
      template.order = [...(template.order || []), appsSectionId];
    }

    const blockId = `${blockHandle}-${makeBlockId()}`;
    sections[appsSectionId].blocks[blockId] = {
      type: `shopify://apps/${APP_HANDLE}/blocks/${blockHandle}`,
      settings: {},
    };
    sections[appsSectionId].block_order = [
      ...(sections[appsSectionId].block_order || []),
      blockId,
    ];

    await putThemeFile(
      admin,
      themeId,
      templateKey,
      `${header}${JSON.stringify(template, null, 2)}\n`,
    );

    return {
      ok: true,
      editorUrl: `https://${shop}/admin/themes/${themeNumericId(themeId)}/editor`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to add block to theme." };
  }
}

/*
 * Block-type names for the buy button, most specific first. Dawn calls it
 * `buy_buttons`; forks and third-party themes do not all agree, and a theme is
 * free to call it anything, so a miss here is expected rather than an error —
 * we leave the template alone and tell the merchant to drag it.
 */
const BUY_BUTTON_PATTERNS = [
  /buy[-_ ]?buttons?/i,
  /add[-_ ]?to[-_ ]?cart/i,
  /product[-_ ]?form/i,
];

function findBlockId(
  blocks: Record<string, any>,
  order: string[],
  match: (type: string) => boolean,
): string | null {
  for (const id of order) {
    const type = blocks?.[id]?.type;
    if (typeof type === "string" && match(type)) return id;
  }
  return null;
}

export type PlaceBlockResult =
  | { ok: true; moved: boolean; reason?: string }
  | { ok: false; error: string };

/**
 * Moves the viewer block to sit directly after the theme's buy button.
 *
 * Deliberately a *reorder*, never an insert. The block itself is put there by
 * Shopify's own deep link, which means the `type` string — the one part of a
 * JSON template this app cannot derive with any confidence, since its exact
 * shape (and whether it carries the theme extension's uuid) is undocumented —
 * is written by Shopify and only ever matched here, never constructed. See
 * APP-STORE-REVIEW-AUDIT.md §10 for why installing it ourselves was dropped.
 *
 * It writes the published theme, so it does nothing unless there is something
 * to do: a block already in position, a block the merchant put somewhere other
 * than the buy button's own section, or a theme with no recognisable buy button
 * all return without a write.
 */
export async function placeBlockAfterBuyButton(
  admin: AdminClient,
  themeId: string,
  templateKey: string,
  blockHandle: string,
): Promise<PlaceBlockResult> {
  try {
    const raw = await getThemeFile(admin, themeId, templateKey);
    if (!raw) {
      return { ok: false, error: "Couldn't read your product template." };
    }

    const header = raw.slice(0, jsonBodyStart(raw));
    const template = parseThemeTemplate(raw);
    const sections = template?.sections ?? {};

    const marker = blockHandle.toLowerCase();

    for (const section of Object.values(sections) as any[]) {
      const blocks = section?.blocks;
      if (!blocks || !Array.isArray(section?.block_order)) continue;

      const order: string[] = section.block_order;
      const buyId = findBlockId(blocks, order, (type) =>
        BUY_BUTTON_PATTERNS.some((re) => re.test(type)),
      );
      if (!buyId) continue;

      // The buy button pins which section is the product section; our block has
      // to already be in that same one. Relocating it across sections would
      // change what wraps it, which is the merchant's call, not ours.
      const ourId = findBlockId(blocks, order, (type) =>
        type.toLowerCase().includes(marker),
      );
      if (!ourId) {
        return {
          ok: true,
          moved: false,
          reason: "block-outside-product-section",
        };
      }

      const target = order.indexOf(buyId) + 1;
      if (order[target] === ourId) {
        return { ok: true, moved: false, reason: "already-in-place" };
      }

      // Splice out first, then re-read the buy button's index: removing our
      // block shifts everything after it down one, and computing the insertion
      // point before the removal is how it lands one slot too far.
      const without = order.filter((id) => id !== ourId);
      const at = without.indexOf(buyId) + 1;
      section.block_order = [
        ...without.slice(0, at),
        ourId,
        ...without.slice(at),
      ];

      await putThemeFile(
        admin,
        themeId,
        templateKey,
        `${header}${JSON.stringify(template, null, 2)}\n`,
      );
      return { ok: true, moved: true };
    }

    return { ok: true, moved: false, reason: "no-buy-button" };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Couldn't reposition the block." };
  }
}

function numericIdFromGid(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : null;
}

const TEMPLATE_FILENAMES = ["templates/product.json", "templates/page.json"];

function countBlockOccurrences(content: string, marker: string): number {
  try {
    const parsed = parseThemeTemplate(content);
    const sections = parsed?.sections ?? {};
    let count = 0;
    for (const section of Object.values(sections) as any[]) {
      const blocks = section?.blocks ?? {};
      for (const block of Object.values(blocks) as any[]) {
        const type = block?.type;
        if (typeof type === "string" && type.toLowerCase().includes(marker)) {
          count++;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

const themeBlocksCache = createShopCache<ThemeBlockStatus>(SHOP_CACHE_TTL_MS);

/**
 * `checkThemeBlocks` through a per-shop cache. It crawls the published theme's
 * templates, which is the most expensive of these checks, and it too only feeds
 * a checklist tick. addThemeBlock drops the entry, so inserting the block from
 * the app updates the checklist immediately.
 */
export async function checkThemeBlocksCached(
  admin: AdminClient,
  shop: string,
): Promise<ThemeBlockStatus> {
  return themeBlocksCache.read(shop, () => checkThemeBlocks(admin));
}

/** Called after any write that adds or removes the app's theme blocks. */
export function invalidateThemeBlocks(shop: string): void {
  themeBlocksCache.invalidate(shop);
}

export async function checkThemeBlocks(admin: AdminClient): Promise<ThemeBlockStatus> {
  const empty: ThemeBlockStatus = {
    productBlockAdded: false,
    pageBlockAdded: false,
    addedCount: 0,
    totalBlocks: 2,
    themeId: null,
  };

  try {
    const res = await admin.graphql(
      `#graphql
        query ThemeBlockCheck($filenames: [String!]!) {
          themes(first: 1, roles: [MAIN]) {
            nodes {
              id
              files(filenames: $filenames) {
                nodes {
                  filename
                  body {
                    ... on OnlineStoreThemeFileBodyText {
                      content
                    }
                  }
                }
              }
            }
          }
        }`,
      { variables: { filenames: TEMPLATE_FILENAMES } },
    );
    const json = await res.json();
    const theme = json?.data?.themes?.nodes?.[0];
    const files = theme?.files?.nodes ?? [];
    const themeId = numericIdFromGid(theme?.id);

    let productCount = 0;
    let pageCount = 0;
    for (const file of files) {
      const content = file?.body?.content;
      if (typeof content !== "string") continue;
      if (file.filename?.startsWith("templates/product")) {
        productCount += countBlockOccurrences(content, "product_viewer");
      } else if (file.filename?.startsWith("templates/page")) {
        pageCount += countBlockOccurrences(content, "page_viewer");
      }
    }

    const productBlockAdded = productCount > 0;
    const pageBlockAdded = pageCount > 0;
    return {
      productBlockAdded,
      pageBlockAdded,
      addedCount: (productBlockAdded ? 1 : 0) + (pageBlockAdded ? 1 : 0),
      totalBlocks: 2,
      themeId,
    };
  } catch {
    return empty;
  }
}
