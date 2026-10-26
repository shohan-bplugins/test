import type { ShopLocale } from "~/lib/shop-locales";

/**
 * The languages the shop sells in, primary first: what the hotspot editor
 * offers translations for. Needs the read_locales scope.
 *
 * Never throws. A shop that hasn't re-approved the app since the scope was
 * added (or any other failure) gets an empty list, and the editor simply
 * doesn't show the language switcher — hotspots keep working in one language.
 */
export async function fetchShopLocales(admin: {
  graphql: (query: string, options?: any) => Promise<Response>;
}): Promise<ShopLocale[]> {
  try {
    const res = await admin.graphql(
      `#graphql
        query ShopLocales {
          shopLocales(published: true) { locale name primary }
        }`,
    );
    const json = await res.json();
    const rows: any[] = json?.data?.shopLocales ?? [];
    return rows
      .filter((r) => typeof r?.locale === "string")
      .map((r) => ({
        locale: String(r.locale),
        name: String(r.name ?? r.locale),
        primary: !!r.primary,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  } catch {
    return [];
  }
}
