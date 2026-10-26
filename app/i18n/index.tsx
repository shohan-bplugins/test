/**
 * Dashboard translations, in React.
 *
 *   const t = useT("models");
 *   t("heading")                          // "3D Model Library"
 *   t("count", { count: 3 })              // "3 models" (count_one/count_other)
 *   t.rich("hint", { b: (c) => <s-text type="strong">{c}</s-text> })
 *
 * English is bundled (locales/en/*.json); the merchant's language arrives from
 * the app layout's loader (routes/app.tsx), so only one other language is ever
 * sent to the browser. Anything missing in that language falls back to
 * English, then to the key.
 *
 * The locale is the first one the layout reports, and changes only when the
 * merchant picks another (useSetLanguage, from the language picker). A later
 * revalidation can come back with a different guess — client navigations
 * don't carry Shopify's ?locale= — so loader updates are deliberately ignored;
 * that stops the UI switching language mid-session on its own.
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_LOCALE, localeDir } from "./config";
import {
  catalogFromGlob,
  interpolate,
  resolveMessage,
  splitRich,
  type Catalog,
  type Messages,
  type Vars,
} from "./format";

const EN: Catalog = catalogFromGlob(
  import.meta.glob<Messages>("./locales/en/*.json", {
    eager: true,
    import: "default",
  }),
  "en",
);

type I18nState = {
  locale: string;
  messages: Catalog;
  /** The language picker's value: a chosen locale, or "auto". */
  choice: string;
};

type I18nContextValue = I18nState & {
  setLanguage: (next: { locale: string; messages: Catalog | null; choice: string }) => void;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  messages: EN,
  choice: "auto",
  setLanguage: () => {},
});

const withEnglish = (locale: string, messages?: Catalog | null) =>
  locale === "en" || !messages ? EN : messages;

export function I18nProvider({
  locale,
  messages,
  choice = "auto",
  children,
}: {
  locale: string;
  /** The locale's catalog from the loader; omitted or empty for English. */
  messages?: Catalog | null;
  choice?: string;
  children: ReactNode;
}) {
  // First answer wins until the merchant picks; see the note at the top.
  const [state, setState] = useState<I18nState>(() => ({
    locale,
    messages: withEnglish(locale, messages),
    choice,
  }));
  const setLanguage = useCallback<I18nContextValue["setLanguage"]>((next) => {
    setState({
      locale: next.locale,
      messages: withEnglish(next.locale, next.messages),
      choice: next.choice,
    });
    document.documentElement.lang = next.locale;
    document.documentElement.dir = localeDir(next.locale);
  }, []);
  const value = useMemo(() => ({ ...state, setLanguage }), [state, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The picker's value and the switch, for the language picker. */
export function useLanguageChoice() {
  const { locale, choice, setLanguage } = useContext(I18nContext);
  return { locale, choice, setLanguage };
}

/** The dashboard's locale, e.g. for Intl.DateTimeFormat. */
export function useLocale(): string {
  return useContext(I18nContext).locale;
}

export type TFunction = {
  (key: string, vars?: Vars): string;
  /** Message with <tag>chunk</tag> parts rendered by `tags[tag](chunk)`. */
  rich: (
    key: string,
    tags: Record<string, (chunk: string) => ReactNode>,
    vars?: Vars,
  ) => ReactNode;
};

export function makeT(locale: string, messages: Catalog, ns: string): TFunction {
  const t = ((key: string, vars?: Vars) =>
    interpolate(resolveMessage(messages, EN, locale, ns, key, vars), locale, vars)) as TFunction;
  t.rich = (key, tags, vars) => {
    const text = t(key, vars);
    return splitRich(text).map((part, i) =>
      typeof part === "string" ? (
        <Fragment key={i}>{part}</Fragment>
      ) : (
        <Fragment key={i}>{tags[part.tag] ? tags[part.tag](part.text) : part.text}</Fragment>
      ),
    );
  };
  return t;
}

/** The translator for one namespace (one JSON file per locale). */
export function useT(ns: string): TFunction {
  const { locale, messages } = useContext(I18nContext);
  return useMemo(() => makeT(locale, messages, ns), [locale, messages, ns]);
}
