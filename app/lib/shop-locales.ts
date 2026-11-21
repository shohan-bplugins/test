/** A language the shop has published, from the Admin API's shopLocales. */
export type ShopLocale = {
  /** "fr", "pt-BR": the same code the storefront's request.locale uses. */
  locale: string;
  /** In the merchant's admin language, e.g. "French". */
  name: string;
  primary: boolean;
};
