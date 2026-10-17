// Shared input guards for public (storefront-facing) routes.
// These helpers only validate/normalize input; they never change the shape of
// what a route returns for valid requests.

export const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
export const MAX_IDS_PER_REQUEST = 100;
export const GENERIC_ERROR_MESSAGE = "Something went wrong";

export function isObjectId(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function isShopDomain(value) {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    SHOP_DOMAIN_RE.test(value)
  );
}

// Keeps only valid 24-hex ObjectId strings, in their original order
// (duplicates preserved), capped at `max` entries. Non-arrays yield [].
export function sanitizeIdList(input, max = MAX_IDS_PER_REQUEST) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const id of input) {
    if (out.length >= max) break;
    if (isObjectId(id)) out.push(id);
  }
  return out;
}

// Parses a JSON-encoded id array from a query param value without throwing.
export function parseIdsParam(raw, max = MAX_IDS_PER_REQUEST) {
  if (typeof raw !== "string" || !raw) return [];
  try {
    return sanitizeIdList(JSON.parse(raw), max);
  } catch {
    return [];
  }
}

// Returns the `shop` query param when it is a valid myshopify domain, else null.
// Callers use this for optional, backward-compatible shop scoping: older
// extension versions do not send `shop`, so absence must not filter anything.
export function getShopScope(url) {
  const shop = url?.searchParams?.get("shop");
  return isShopDomain(shop) ? shop : null;
}

// Reads a JSON body without throwing; returns `fallback` on any parse error.
export async function safeJson(request, fallback = null) {
  try {
    return await request.json();
  } catch {
    return fallback;
  }
}

export function truncate(value, max) {
  if (typeof value !== "string") return value;
  return value.length > max ? value.slice(0, max) : value;
}

// Fetches Audio rows for the given (already sanitized) ids with one query and
// returns them in the same order as `ids`, one entry per id (null when not
// found) — matching the legacy per-id findUnique output shape.
export async function findAudiosInOrder(prisma, ids, select) {
  if (!ids.length) return [];
  const rows = await prisma.audio.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { ...select, id: true },
  });
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
  return ids.map((id) => {
    const row = byId.get(id.toLowerCase());
    if (!row) return null;
    if (select.id) return row;
    // Strip the id we added for mapping when the caller didn't select it.
    const { id: _omit, ...rest } = row;
    return rest;
  });
}
