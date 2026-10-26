import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

import { authenticate } from "../shopify.server";
import { matchLocale } from "~/i18n/config";
import {
  catalogFor,
  localeCookieHeaders,
  resolveAdminLocale,
} from "~/i18n/i18n.server";

/*
 * The dashboard's language picker posts here (LanguagePicker). Resource route:
 * no page, just the choice.
 *
 * Remembers it in a cookie, so every later request — loaders, actions, a
 * reload — is in that language, and answers with the new catalog so the page
 * can switch at once without reloading. "auto" forgets the choice and goes
 * back to following the Shopify admin's language.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const raw = String(form.get("lang") ?? "auto");
  const lang = raw === "auto" ? "auto" : matchLocale(raw);
  if (!lang) return data({ ok: false as const }, { status: 400 });

  const locale = resolveAdminLocale(request, lang);
  const headers = new Headers();
  for (const cookie of localeCookieHeaders(request, lang)) {
    headers.append("Set-Cookie", cookie);
  }
  return data(
    {
      ok: true as const,
      locale,
      choice: lang,
      messages: locale === "en" ? null : catalogFor(locale),
    },
    { headers },
  );
};
