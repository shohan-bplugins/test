import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { useLanguageChoice, useT } from "~/i18n";
import { localeLabel, SUPPORTED_LOCALES } from "~/i18n/config";
import { fieldValue } from "~/components/polaris/helpers";
import type { action } from "~/routes/app.language";

/**
 * The language switch, on Home and on Setup. "Automatic" follows the Shopify
 * admin's language (the default, and what happens with no choice made); any
 * other option pins the app to that language until changed back.
 *
 * Switches in place: the route answers with the new catalog, the provider
 * swaps it in, and loaders re-run (a fetcher submission revalidates) so text
 * the server formats — dates, messages — follows on the next render.
 *
 * Built so a merchant who picks a language they can't read can still get back:
 *  - every language is listed by flag and in its own script, and English is
 *    always written "English";
 *  - the label adds "Language" in English to the translated word;
 *  - each switch shows a toast whose undo button names the previous language
 *    the same way ("↩ 🇺🇸 English"), readable whatever the new language is.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const t = useT("shared");
  const shopify = useAppBridge();
  const { locale, choice, setLanguage } = useLanguageChoice();
  const fetcher = useFetcher<typeof action>();
  const applied = useRef<unknown>(null);
  // What was showing before the switch in flight, for the undo button.
  const previous = useRef<{ locale: string; choice: string } | null>(null);

  const choose = (lang: string) => {
    previous.current = { locale, choice };
    fetcher.submit({ lang }, { method: "post", action: "/app/language" });
  };

  useEffect(() => {
    const result = fetcher.data;
    if (!result || !result.ok || applied.current === result) return;
    applied.current = result;
    setLanguage({
      locale: result.locale,
      messages: result.messages,
      choice: result.choice,
    });
    const before = previous.current;
    if (!before || before.choice === result.choice) return;
    shopify.toast.show(`🌐 ${localeLabel(result.locale)} ✓`, {
      duration: 10000,
      action: `↩ ${localeLabel(before.locale)}`,
      onAction: () => choose(before.choice),
    });
    // choose is recreated each render; the toast only needs the one it closed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, setLanguage, shopify]);

  // Shows the pending choice straight away rather than snapping back while
  // the request is in flight.
  const pending = fetcher.formData?.get("lang");
  const value = typeof pending === "string" ? pending : choice;
  const label = locale === "en" ? t("language") : `${t("language")} · Language`;

  return (
    <s-select
      label={label}
      labelAccessibilityVisibility={compact ? "exclusive" : "visible"}
      details={compact ? undefined : t("languageHelp")}
      icon="globe"
      value={value}
      onInput={(e) => choose(fieldValue(e) || "auto")}
    >
      <s-option value="auto">{`🌐 ${t("languageAuto")}`}</s-option>
      {SUPPORTED_LOCALES.map((l) => (
        <s-option key={l.code} value={l.code}>
          {localeLabel(l.code)}
        </s-option>
      ))}
    </s-select>
  );
}
