export const PA_NAMESPACE = "audio_player_by_bplugins";
export const PA_KEY_ASSIGNED_ID = "assigned_audio_id";
export const PA_KEY_ASSIGNED_IDS = "assigned_audio_ids";

// Parse the ordered audio IDs assigned to a product, preferring the multi-value
// list metafield and falling back to the legacy single-value metafield.
export function parseAssignedIds(listValue, legacyValue) {
  const isValid = (v) => typeof v === "string" && v.length === 24;
  // Drop duplicate ids so the same player isn't rendered twice on the
  // storefront or double-counted in analytics totals/rankings.
  const dedupe = (arr) => Array.from(new Set(arr));

  if (typeof listValue === "string" && listValue.length) {
    try {
      const arr = JSON.parse(listValue);
      if (Array.isArray(arr)) return dedupe(arr.filter(isValid));
    } catch {
      // fall through to legacy
    }
  }
  if (isValid(legacyValue)) return [legacyValue];
  return [];
}

// Fetch all products that have an assigned audio. Returns one row per
// (product, audioId): [{ productId, productTitle, audioId }, ...].
// Hard cap: 5 pages × 250 = 1,250 products.
export async function loadProductAssignments(admin) {
  const out = [];
  let cursor = null;

  for (let i = 0; i < 5; i++) {
    const res = await admin.graphql(
      `#graphql
      query ProductsWithAssignment($cursor: String) {
        products(first: 250, after: $cursor) {
          edges {
            cursor
            node {
              id
              title
              assignedList: metafield(namespace: "${PA_NAMESPACE}", key: "${PA_KEY_ASSIGNED_IDS}") {
                value
              }
              assigned: metafield(namespace: "${PA_NAMESPACE}", key: "${PA_KEY_ASSIGNED_ID}") {
                value
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { cursor } },
    );
    const j = await res.json();
    if (j?.errors) {
      console.error("ProductsWithAssignment errors:", j.errors);
      break;
    }
    const edges = j?.data?.products?.edges ?? [];
    edges.forEach((e) => {
      const node = e?.node;
      const ids = parseAssignedIds(
        node?.assignedList?.value,
        node?.assigned?.value,
      );
      ids.forEach((audioId) => {
        out.push({
          productId: node.id,
          productTitle: node.title ?? "Untitled product",
          audioId,
        });
      });
    });
    const pageInfo = j?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return out;
}

// Back-compat: distinct audio IDs only.
export async function loadProductAssignedAudioIds(admin) {
  const assignments = await loadProductAssignments(admin);
  return Array.from(new Set(assignments.map((a) => a.audioId)));
}
