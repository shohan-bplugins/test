import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData } from "react-router";
import {
  ArrowRight,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Gauge,
  Layers,
  Maximize2,
  Palette,
  Play,
  Puzzle,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
} from "lucide-react";

import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import appStylesUrl from "~/app.css?url";
import { ViewerPreview, type ViewerConfig } from "~/components/ViewerPreview";
// Client-safe: billing-constants.ts is plain arithmetic and formatting, with no
// database or Shopify imports, unlike billing.server.ts beside it.
import { formatMoney } from "~/lib/billing-constants";
import {
  LAUNCH_OFFER,
  LAUNCH_OFFER_PERCENT_LABEL,
  launchOfferActive,
  launchOfferPrice,
} from "~/lib/launch-offer";
import { DEFAULT_CONFIG, REPEAT_MODES, TONE_MAPPINGS } from "~/lib/viewer-config";
import { resolveAppOrigin } from "~/lib/app-origin.server";

/*
 * The public showcase — /demo.
 *
 * Unauthenticated and indexable: this is the page a merchant lands on from the
 * App Store listing, an ad, or a support reply, to find out what the viewer
 * actually feels like before installing anything.
 *
 * Every viewer on this page is the real <ViewerPreview> — the same component the
 * admin's settings preview and the public /viewer/:id embed render, driven by the
 * same ViewerConfig shape the app saves per model. Nothing here is a screenshot
 * or a video, which is the whole point: the playground below lets a visitor move
 * the actual settings and watch the actual renderer respond.
 *
 * (The storefront widget in extensions/viewer-3d is a separate, framework-free
 * implementation of the same config — see the DEFAULTS note in viewer-3d.js.
 * This page shows the React one because it is the one that can be driven from
 * React state.)
 */

export const links: LinksFunction = () => [
  // Same pairing as /viewer/:id: app.css is Tailwind plus the viewer's styling,
  // and view3d's stylesheet styles the canvas chrome. Neither is global — see
  // the note in root.tsx.
  { rel: "stylesheet", href: appStylesUrl },
  { rel: "stylesheet", href: view3dStylesUrl },
];

export const loader = ({ request }: LoaderFunctionArgs) => ({
  // For the copy-paste embed snippet. Resolved server-side rather than from
  // window.location so the snippet shows the app's canonical https origin even
  // when the page itself is reached over a proxy — see app-origin.server.ts,
  // where getting this wrong silently breaks the iframe's fullscreen/AR grants.
  appOrigin: resolveAppOrigin(request),
  // Whether the launch discount is still open. Decided here rather than in the
  // component so the server render and the hydration agree on it; a bare
  // Date.now() inside the tree would be evaluated twice, minutes apart, and
  // around the deadline the two would disagree.
  //
  // The edge cache below means a copy rendered just before the deadline can
  // outlive it by the stale window. That is fine for a day-granularity offer on
  // a marketing page — what a merchant is actually charged is decided by
  // billing.server.ts when the subscription is created, not by this flag.
  offerActive: launchOfferActive(),
});

// A marketing page with no per-visitor content: cache it at the edge, revalidate
// in the background.
export const headers: HeadersFunction = () => ({
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
});

export const meta: MetaFunction = () => [
  { title: "Easy 3D Viewer: live demo of 3D & AR product models for Shopify" },
  {
    name: "description",
    content:
      "Spin, zoom, recolour and inspect real 3D product models in your browser, then see the same viewer inside a Shopify product page. No install needed to try it.",
  },
  { property: "og:title", content: "Easy 3D Viewer: live demo" },
  {
    property: "og:description",
    content:
      "Interactive 3D and AR product models for Shopify. Try the real viewer, move the real settings, see it on a product page.",
  },
  { property: "og:type", content: "website" },
];

const APP_LISTING_URL = "https://apps.shopify.com/easy-3d-viewer";
const DOCS_URL = "https://apps.bplugins.com/docs/3d-viewer/";
const SUPPORT_URL = "https://bplugins.com/support";
const PRIVACY_URL = "https://apps.bplugins.com/privacy-policy-bplugins-3d-viewer/";

/*
 * The launch discount is defined in ~/lib/launch-offer, because this page is
 * not the only thing that has to agree about it: the app's own Pricing page
 * quotes the same numbers and the `subscribe` action applies them to the actual
 * Shopify charge. It used to be declared here, and the result was an offer this
 * page advertised that the Pricing page had no way to grant.
 */

type DemoPlan = {
  name: string;
  price: number;
  trialDays: number;
  blurb: string;
  features: string[];
  popular?: boolean;
};

/*
 * The plans, as the app sells them.
 *
 * Copied by hand from SEED_PLANS in app/lib/billing.server.ts rather than
 * imported from it: that module talks to the database and is server-only, while
 * this page is public, cached at the edge and renders for a visitor who has
 * never installed anything. The admin's own pricing page reads the real Plan
 * rows and stays the authority — so a price changed there has to be changed
 * here too.
 */
const PLANS: DemoPlan[] = [
  {
    name: "Free",
    price: 0,
    trialDays: 0,
    blurb: "Enough to put 3D on your best-selling products and see what it does.",
    features: [
      "3 products with a 3D model",
      "3 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Standard email support",
    ],
  },
  {
    name: "Starter",
    price: 8.88,
    trialDays: 7,
    blurb: "For small catalogs ready to show more products in 3D.",
    features: [
      "15 products with a 3D model",
      "15 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Priority email support",
    ],
  },
  {
    name: "Growth",
    price: 18.88,
    trialDays: 7,
    blurb: "For growing stores rolling 3D out across the catalog.",
    popular: true,
    features: [
      "100 products with a 3D model",
      "100 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Priority email support",
    ],
  },
  {
    name: "Advance",
    price: 35.88,
    trialDays: 7,
    blurb: "For high-volume catalogs with no caps.",
    features: [
      "Unlimited products with a 3D model",
      "Unlimited models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Premium priority support",
    ],
  },
];

/*
 * Demo models.
 *
 * These are the Khronos glTF Sample Assets, served from jsDelivr's GitHub
 * mirror rather than committed here: they run to several megabytes each, they
 * are not this app's artwork, and a CDN with CORS enabled is exactly what a
 * merchant's own models get from Shopify's file storage — so the loading
 * behaviour a visitor sees on this page is the behaviour they will get.
 *
 * Every asset below is CC0 or CC BY 4.0 (commercial use permitted); the
 * attribution CC BY requires is rendered in the credits section at the foot of
 * the page, so don't add a model here without adding its `credit` entry too.
 * Deliberately excluded: DamagedHelmet and anything else carrying a
 * NonCommercial clause.
 *
 * The product names and prices are invented shop-window dressing for the
 * storefront mock; the real asset name stays in `credit.asset`.
 */
const SAMPLE_BASE =
  "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models";

type DemoModel = {
  id: string;
  name: string;
  category: string;
  price: string;
  blurb: string;
  url: string;
  sizeMB: number;
  badge?: string;
  // KHR_materials_variants names as they appear inside the file — these are what
  // config.variant selects, so they have to match exactly.
  variants?: string[];
  clips?: string[];
  config: Partial<ViewerConfig>;
  credit: {
    asset: string;
    author: string;
    license: string;
    licenseUrl: string;
  };
};

const CC_BY = "CC BY 4.0";
const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";
const CC0 = "CC0 1.0";
const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

const SOFA: DemoModel = {
  id: "sofa",
  name: "Glam Three-Seater",
  category: "Furniture",
  price: "$2,480",
  blurb:
    "Five colourways live inside one file. You pick which one this viewer shows in the app's settings, so it stays one upload rather than five.",
  url: `${SAMPLE_BASE}/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb`,
  sizeMB: 3.1,
  badge: "5 colourways",
  variants: ["Champagne", "Navy", "Gray", "Black", "Pale Pink"],
  config: { yaw: 25, pitch: 6, exposure: 1.1 },
  credit: {
    asset: "GlamVelvetSofa",
    author: "Wayfair, LLC (Eric Chadwick)",
    license: CC_BY,
    licenseUrl: CC_BY_URL,
  },
};

const CHAIR: DemoModel = {
  id: "chair",
  name: "Sheen Lounge Chair",
  category: "Furniture",
  price: "$1,180",
  blurb:
    "Velvet is the texture photography struggles with most. Under a real light rig the sheen moves as the chair turns.",
  url: `${SAMPLE_BASE}/SheenChair/glTF-Binary/SheenChair.glb`,
  sizeMB: 4.0,
  badge: "2 fabrics",
  variants: ["Mango Velvet", "Peacock Velvet"],
  config: { yaw: -20, pitch: 8, exposure: 1.15 },
  credit: {
    asset: "SheenChair",
    author: "Wayfair, LLC (Eric Chadwick)",
    license: CC0,
    licenseUrl: CC0_URL,
  },
};

const SNEAKER: DemoModel = {
  id: "sneaker",
  name: "Everyday Sneaker",
  category: "Footwear",
  price: "$165",
  blurb:
    "Three colourways, stitching and sole tread you can actually get close to. Built by Shopify as a reference commerce asset.",
  url: `${SAMPLE_BASE}/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb`,
  sizeMB: 7.5,
  badge: "3 colourways",
  variants: ["midnight", "beach", "street"],
  config: { yaw: 35, pitch: 12, exposure: 1 },
  credit: {
    asset: "MaterialsVariantsShoe",
    author: "Shopify",
    license: CC_BY,
    licenseUrl: CC_BY_URL,
  },
};

const TOY_CAR: DemoModel = {
  id: "toycar",
  name: "Die-Cast Racer",
  category: "Toys",
  price: "$39",
  blurb:
    "Clearcoat paint, tinted glass and chrome trim: the three materials that flatten out worst in a product photo.",
  url: `${SAMPLE_BASE}/ToyCar/glTF-Binary/ToyCar.glb`,
  sizeMB: 4.4,
  config: { yaw: -35, pitch: 18, exposure: 1.2 },
  credit: {
    asset: "ToyCar",
    author: "Guido Odendahl, Eric Chadwick",
    license: CC0,
    licenseUrl: CC0_URL,
  },
};

const FOX: DemoModel = {
  id: "fox",
  name: "Animated Fox",
  category: "Animated sample",
  price: "80 KB",
  blurb:
    "A rigged model with three baked clips. Turn the clip switcher on and the viewer plays them, cross-fading between clips instead of cutting.",
  url: `${SAMPLE_BASE}/Fox/glTF-Binary/Fox.glb`,
  sizeMB: 0.08,
  badge: "Animated",
  clips: ["Survey", "Walk", "Run"],
  config: {
    yaw: 30,
    pitch: 10,
    // The clip switcher is what makes a model animate at all — see the
    // defaultAnimationIndex note in lib/viewer-config.ts. Index 3 is "Run",
    // counted the 1-based way the merchant-facing setting counts.
    showAnimationSelector: true,
    defaultAnimationIndex: 3,
  },
  credit: {
    asset: "Fox",
    author: "tomkranis, @AsoboStudio, @scurest",
    license: CC_BY,
    licenseUrl: CC_BY_URL,
  },
};

const MODELS: DemoModel[] = [SOFA, CHAIR, SNEAKER, TOY_CAR, FOX];

const BACKGROUNDS = [
  { value: "#ffffff", label: "White" },
  { value: "#f4f4f5", label: "Light grey" },
  { value: "#eaf1fe", label: "Brand tint" },
  { value: "#12151c", label: "Charcoal" },
];

/* ---------------------------------------------------------------- helpers */

function buildConfig(
  model: DemoModel,
  overrides?: Partial<ViewerConfig>,
): ViewerConfig {
  return { ...DEFAULT_CONFIG, ...model.config, ...overrides };
}

/*
 * Mounts its children only once they are close to the viewport.
 *
 * This page carries three viewers, and a View3D instance is not a cheap thing to
 * have sitting around: it takes a WebGL context on construction, starts
 * downloading and parsing its model immediately, and — with autoRotate on —
 * draws every frame forever whether or not anyone can see it. Building all three
 * up front is several megabytes and three render loops competing for one GPU
 * before the visitor has scrolled anywhere.
 *
 * So the same policy the storefront widget applies to a collection page applies
 * here (see the lazy-mounting note in extensions/viewer-3d/assets/viewer-3d.js):
 * register the slot, build the viewer when it comes into range, and leave it
 * built afterwards.
 */
function WhenVisible({
  height,
  label,
  children,
}: {
  height: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (or SSR hydration on an ancient browser): show it
    // rather than leave a permanently empty box.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <div ref={ref}>
      {shown ? (
        children
      ) : (
        <div
          className="flex items-center justify-center border bg-muted/30 text-sm text-muted-foreground"
          style={{ height }}
        >
          <span className="flex items-center gap-2">
            <Box className="size-4 opacity-60" />
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        // Clipboard access is refused outright in a few contexts (insecure
        // origins, some in-app browsers); a demo page has nothing useful to say
        // about that, so it just stays un-copied rather than throwing.
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/*
 * ---------------------------------------------------------------------------
 * The admin's settings panel, rebuilt for a page that has no admin.
 *
 * The playground below is meant to be the settings screen a merchant gets after
 * installing, not a marketing approximation of it: the same eight groups in the
 * same order, the same labels, the same help text, the same control types and
 * the same colours. It was a set of hand-rolled sliders and swatches, which
 * taught a visitor a UI that does not exist.
 *
 * It cannot simply import ViewerSettings.tsx. That component is built from
 * Polaris web components (`s-box`, `s-switch`, `s-number-field`), which are
 * defined by polaris.js — loaded by App Bridge, which only runs inside the
 * Shopify admin iframe. On a public page those elements would never upgrade and
 * the panel would render as unstyled, inert markup.
 *
 * So the primitives below restate Polaris's *appearance* over plain elements:
 * the tokens in ADMIN are read off the admin itself (see
 * app-store-screenshots/04-settings.png). If ViewerSettings.tsx gains or renames
 * a setting, this panel has to follow it by hand — that duplication is the price
 * of showing the real thing outside the admin, and it is the same bargain
 * extensions/viewer-3d/assets/viewer-3d.js already makes with DEFAULT_CONFIG.
 */
const ADMIN = {
  text: "#303030",
  subdued: "#616161",
  border: "#E3E3E3",
  switchOn: "#303030",
  switchOff: "#E3E3E3",
};

const FIELD_BOX =
  "mt-1 flex w-full items-center gap-1 rounded-lg border bg-white px-2 focus-within:border-[#8A8A8A]";

function AdminGroup({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: typeof Palette;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-white" style={{ borderColor: ADMIN.border }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#FAFAFA]"
      >
        <span className="flex items-center gap-2">
          <Icon className="size-3.5" style={{ color: ADMIN.subdued }} />
          <span
            className="text-[13px] font-semibold"
            style={{ color: ADMIN.text }}
          >
            {title}
          </span>
        </span>
        {open ? (
          <ChevronUp className="size-3.5" style={{ color: ADMIN.subdued }} />
        ) : (
          <ChevronDown className="size-3.5" style={{ color: ADMIN.subdued }} />
        )}
      </button>
      {open ? (
        <div
          className="space-y-4 border-t px-3 py-3"
          style={{ borderColor: ADMIN.border }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Details({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-[12px] leading-snug" style={{ color: ADMIN.subdued }}>
      {children}
    </p>
  );
}

/*
 * Switch first, then label — the order Polaris lays a switch row out, and the
 * reason the help text below is indented past the control rather than starting
 * at the left edge of the row.
 */
function AdminSwitch({
  label,
  details,
  checked,
  onChange,
}: {
  label: string;
  details?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          className="relative inline-block h-[18px] w-8 shrink-0 rounded-full transition-colors"
          style={{ background: checked ? ADMIN.switchOn : ADMIN.switchOff }}
        >
          <span
            className="absolute top-[2px] size-[14px] rounded-full bg-white shadow-sm transition-all"
            style={{ left: checked ? "16px" : "2px" }}
          />
        </span>
        <span className="text-[13px]" style={{ color: ADMIN.text }}>
          {label}
        </span>
      </button>
      {details ? (
        <div className="pl-10">
          <Details>{details}</Details>
        </div>
      ) : null}
    </div>
  );
}

function AdminNumber({
  label,
  details,
  suffix,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  details?: ReactNode;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div style={{ opacity: disabled ? 0.55 : 1 }}>
      <label className="block text-[13px]" style={{ color: ADMIN.text }}>
        {label}
        <span className={FIELD_BOX} style={{ borderColor: ADMIN.border }}>
          <input
            type="number"
            className="h-8 w-full bg-transparent text-[13px] outline-none"
            style={{ color: ADMIN.text }}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              // An emptied field parses as NaN, which would otherwise be written
              // straight into the config and reach the viewer. Same guard as
              // num() in ViewerSettings.tsx.
              const parsed = Number(e.currentTarget.value);
              if (Number.isFinite(parsed)) onChange(parsed);
            }}
          />
          {suffix ? (
            <span className="text-[12px]" style={{ color: ADMIN.subdued }}>
              {suffix}
            </span>
          ) : null}
        </span>
      </label>
      {details ? <Details>{details}</Details> : null}
    </div>
  );
}

function AdminSelect({
  label,
  details,
  value,
  options,
  // The admin's FOV mode stores "auto"/"custom" but lists them capitalised;
  // everything else (tone mapping, repeat mode) shows its raw stored value.
  format = (option) => option,
  onChange,
}: {
  label: string;
  details?: ReactNode;
  value: string;
  options: readonly string[];
  format?: (option: string) => string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="block text-[13px]" style={{ color: ADMIN.text }}>
        {label}
        <select
          className="mt-1 h-8 w-full rounded-lg border bg-white px-2 text-[13px] outline-none"
          style={{ borderColor: ADMIN.border, color: ADMIN.text }}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {format(option)}
            </option>
          ))}
        </select>
      </label>
      {details ? <Details>{details}</Details> : null}
    </div>
  );
}

function AdminText({
  label,
  details,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  details?: ReactNode;
  value: string;
  placeholder?: string;
  type?: "text" | "url";
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="block text-[13px]" style={{ color: ADMIN.text }}>
        {label}
        <span className={FIELD_BOX} style={{ borderColor: ADMIN.border }}>
          <input
            type={type}
            className="h-8 w-full bg-transparent text-[13px] outline-none"
            style={{ color: ADMIN.text }}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </span>
      </label>
      {details ? <Details>{details}</Details> : null}
    </div>
  );
}

/*
 * Polaris's colour field is a swatch that opens a picker, with the hex editable
 * beside it; a native <input type="color"> is the swatch, and the text input
 * keeps the hex typeable for anyone who already knows the value.
 */
function AdminColor({
  label,
  details,
  value,
  onChange,
}: {
  label: string;
  details?: ReactNode;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="block text-[13px]" style={{ color: ADMIN.text }}>
        {label}
        <span className={FIELD_BOX} style={{ borderColor: ADMIN.border }}>
          <input
            type="color"
            aria-label={`${label} swatch`}
            className="size-5 shrink-0 cursor-pointer border-0 bg-transparent p-0"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
          <input
            type="text"
            className="h-8 w-full bg-transparent text-[13px] uppercase outline-none"
            style={{ color: ADMIN.text }}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </span>
      </label>
      {details ? <Details>{details}</Details> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Demo() {
  const { appOrigin, offerActive } = useLoaderData<typeof loader>();

  return (
    <div
      className="min-h-dvh bg-background text-foreground"
      // Inter is already loaded globally by root.tsx (Polaris's copy from
      // Shopify's CDN); Tailwind's preflight would otherwise leave this page on
      // the generic system stack while the admin runs on Inter.
      style={{
        fontFamily:
          'Inter, InterVariable, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <SiteHeader />
      <main>
        <Showcase />
        <Playground />
        <StorefrontMock />
        <Features />
        <EmbedAnywhere appOrigin={appOrigin} />
        <Pricing offerActive={offerActive} />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const NAV = [
    { href: "#showcase", label: "Showcase" },
    { href: "#playground", label: "Playground" },
    { href: "#storefront", label: "On a product page" },
    { href: "#embed", label: "Embed" },
    { href: "#pricing", label: "Pricing" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <a href="/" className="flex items-center gap-2.5 font-semibold">
          {/*
            A plain <img>, and deliberately not <s-image>.

            s-image is a Polaris web component, defined by polaris.js, which is
            loaded by App Bridge and only runs inside the Shopify admin iframe.
            This page is public, so that element never upgrades: it stays an
            unknown inline tag with no content and no box, which is why the logo
            simply was not there.

            The file is this repo's own brand mark (brand/icon-4-viewport.svg,
            copied to public/), which is the same artwork as the App Store
            listing icon. Local rather than the listing image on Shopify's CDN:
            it is 1 KB of vector instead of a 690 KB PNG, stays sharp at any
            size, and cannot break when the listing icon is re-uploaded and its
            CDN key changes.
          */}
          <img
            src="/brand-icon.svg"
            // Decorative: the app's name is right beside it in this same link,
            // so alt text would only make a screen reader say it twice.
            alt=""
            width={32}
            height={32}
            className="size-8 rounded-md"
          />
          Easy 3D Viewer
        </a>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-foreground">
              {item.label}
            </a>
          ))}
          <a href={DOCS_URL} className="hover:text-foreground">
            Docs
          </a>
        </nav>
        <a
          href={APP_LISTING_URL}
          className="ml-auto inline-flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 md:ml-0"
        >
          Add to your store
          <ArrowRight className="size-4" />
        </a>
      </div>
    </header>
  );
}

/*
 * Hero + model switcher.
 *
 * One viewer, re-pointed at whichever model is selected, rather than five
 * viewers behind tabs: switching models is a modelUrl change, which is part of
 * ViewerPreview's init key, so the instance is rebuilt and the old WebGL context
 * handed back. Five parked instances would each keep one.
 */
function Showcase() {
  const [activeId, setActiveId] = useState(SOFA.id);
  const active = MODELS.find((m) => m.id === activeId) ?? SOFA;
  const [background, setBackground] = useState("#f4f4f5");

  const config = useMemo(
    () =>
      buildConfig(active, {
        height: 520,
        background,
        showCameraResetButton: true,
      }),
    [active, background],
  );

  return (
    <section id="showcase" className="border-b">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:py-20">
        <div className="flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" />
            Live demo, nothing to install
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Let shoppers pick your product up and turn it over.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Easy 3D Viewer turns a GLB or glTF file into a spinnable, zoomable,
            AR-ready model on your Shopify product pages. Everything on this page
            is the real viewer, the same renderer and the same settings that
            ship in the theme block.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={APP_LISTING_URL}
              className="inline-flex items-center gap-2 bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Add to your store
              <ArrowRight className="size-4" />
            </a>
            <a
              href="#playground"
              className="inline-flex items-center gap-2 border px-5 py-3 text-sm font-medium hover:bg-muted"
            >
              Try the settings
            </a>
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-7 text-sm sm:grid-cols-4 lg:grid-cols-2">
            {[
              ["GLB & glTF", "Upload straight to Shopify Files"],
              ["iOS & Android", "Quick Look and Scene Viewer"],
              ["0 lines", "of theme code to write"],
              ["20 MB", "max per model"],
            ].map(([value, label]) => (
              <div key={value}>
                <dt className="font-semibold">{value}</dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <ViewerPreview modelUrl={active.url} config={config} />

          <div className="mt-4 flex flex-wrap gap-2">
            {MODELS.map((model) => {
              const isActive = model.id === active.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setActiveId(model.id)}
                  aria-pressed={isActive}
                  className={`border px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className="block font-medium">{model.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {model.sizeMB < 1
                      ? `${Math.round(model.sizeMB * 1024)} KB`
                      : `${model.sizeMB} MB`}
                    {model.badge ? ` · ${model.badge}` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-lg text-sm text-muted-foreground">{active.blurb}</p>
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Backdrop</span>
              {BACKGROUNDS.map((bg) => (
                <button
                  key={bg.value}
                  type="button"
                  title={bg.label}
                  aria-label={`Backdrop: ${bg.label}`}
                  aria-pressed={background === bg.value}
                  onClick={() => setBackground(bg.value)}
                  className={`size-6 border ${
                    background === bg.value
                      ? "ring-2 ring-primary ring-offset-1"
                      : ""
                  }`}
                  style={{ background: bg.value }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/*
 * The settings playground.
 *
 * The panel on the right is the app's own "Viewer settings" card, group for
 * group and label for label (app/components/ViewerSettings.tsx) — see the note
 * above the ADMIN primitives for why it is restated here rather than imported.
 * A visitor who learns this panel has learned the screen they will land on after
 * installing, which a prettier bespoke set of sliders could never deliver.
 *
 * A note on cost, since it is visible: most of these are applied through a live
 * setter on the running instance (exposure, tone mapping, camera pose, clip,
 * variant, skybox) and cost nothing. A few have no live setter and can only take
 * effect at construction: shadow, the axis gizmo, the clip switcher, FOV mode.
 * Toggling those rebuilds the viewer and re-reads the model. That is the same
 * rebuild the admin preview does, and the model comes from the browser cache the
 * second time.
 */
function Playground() {
  const model = CHAIR;
  const initial = () => buildConfig(model, { height: 460, background: "#ffffff" });
  const [cfg, setCfg] = useState<ViewerConfig>(initial);

  const set = <K extends keyof ViewerConfig>(key: K, value: ViewerConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  // Only what differs from the shipped defaults, which is exactly what the app
  // stores against a model — a visitor can read this as "the settings I changed".
  const changed = useMemo(() => {
    const out: Record<string, unknown> = {};
    (Object.keys(cfg) as (keyof ViewerConfig)[]).forEach((key) => {
      if (cfg[key] !== DEFAULT_CONFIG[key]) out[key] = cfg[key];
    });
    return JSON.stringify(out, null, 2);
  }, [cfg]);

  return (
    <section id="playground" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">
            Every model gets its own settings
          </h2>
          <p className="mt-3 text-muted-foreground">
            Lighting, camera, controls and animation are saved per model in the
            app, not per theme and not in code. The panel below is the one you get
            after installing, down to the last switch. Move anything in it and the
            viewer responds the way the storefront will.
          </p>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          {/* Left card mirrors the admin's "Live preview" card. */}
          <div
            className="rounded-lg border bg-white p-4"
            style={{ borderColor: ADMIN.border }}
          >
            <h3 className="text-[13px] font-semibold" style={{ color: ADMIN.text }}>
              Live preview
            </h3>
            <p className="mb-3 text-[12px]" style={{ color: ADMIN.subdued }}>
              Updates instantly. Nothing on this page is saved.
            </p>
            <WhenVisible
              height={cfg.height}
              label="3D viewer loads as you reach it"
            >
              <ViewerPreview modelUrl={model.url} config={cfg} />
            </WhenVisible>
            <details
              className="mt-4 rounded-lg border"
              style={{ borderColor: ADMIN.border }}
            >
              <summary
                className="cursor-pointer px-3 py-2.5 text-[13px] font-semibold"
                style={{ color: ADMIN.text }}
              >
                What the app saves for this model
              </summary>
              <pre
                className="overflow-x-auto border-t px-3 py-3 text-[12px] leading-relaxed"
                style={{ borderColor: ADMIN.border, color: ADMIN.text }}
              >
                {changed === "{}"
                  ? "// nothing changed from the defaults"
                  : changed}
              </pre>
            </details>
          </div>

          {/* Right card mirrors the admin's "Viewer settings" card. */}
          <div
            className="rounded-lg border bg-white p-4"
            style={{ borderColor: ADMIN.border }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  className="text-[13px] font-semibold"
                  style={{ color: ADMIN.text }}
                >
                  Viewer settings
                </h3>
                <p
                  className="mt-0.5 text-[12px] leading-snug"
                  style={{ color: ADMIN.subdued }}
                >
                  The same panel the app shows for every model. In your store
                  these save to the product; here they do not.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-[12px] underline"
                style={{ color: ADMIN.subdued }}
                onClick={() => setCfg(initial)}
              >
                Reset
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <AdminGroup title="Display" icon={Palette} defaultOpen>
                <AdminNumber
                  label="Viewer height"
                  details="Height of the viewer canvas, in pixels."
                  suffix="px"
                  min={200}
                  max={1200}
                  step={10}
                  value={cfg.height}
                  onChange={(v) => set("height", v)}
                />
                <AdminColor
                  label="Background color"
                  details="Solid colour behind the model."
                  value={cfg.background}
                  onChange={(v) => set("background", v)}
                />
                <AdminNumber
                  label="Exposure"
                  details="HDR brightness."
                  min={0}
                  max={5}
                  step={0.05}
                  value={cfg.exposure}
                  onChange={(v) => set("exposure", v)}
                />
                <AdminSelect
                  label="Tone mapping"
                  value={cfg.toneMapping}
                  options={TONE_MAPPINGS}
                  onChange={(v) => set("toneMapping", v)}
                />
                <AdminSwitch
                  label="Default environment map"
                  details="Generated env map for material reflections."
                  checked={cfg.useDefaultEnv}
                  onChange={(v) => set("useDefaultEnv", v)}
                />
                <AdminSwitch
                  label="Blur skybox"
                  checked={cfg.skyboxBlur}
                  onChange={(v) => set("skyboxBlur", v)}
                />
                <AdminSwitch
                  label="Cast shadow under model"
                  checked={cfg.shadow}
                  onChange={(v) => set("shadow", v)}
                />
              </AdminGroup>

              <AdminGroup title="Environment" icon={Sun}>
                <AdminText
                  label="Skybox HDR URL"
                  type="url"
                  placeholder="https://...hdr"
                  details="RGBE .hdr image rendered as the background and used for reflections."
                  value={cfg.skybox}
                  onChange={(v) => set("skybox", v)}
                />
                <AdminText
                  label="Environment map HDR URL"
                  type="url"
                  placeholder="https://...hdr"
                  details="Optional separate HDR for material reflections only."
                  value={cfg.envmap}
                  onChange={(v) => set("envmap", v)}
                />
              </AdminGroup>

              <AdminGroup title="Camera" icon={Camera}>
                <AdminSelect
                  label="FOV mode"
                  details="Auto fits the model. Custom uses the FOV value below."
                  value={cfg.fovMode}
                  options={["auto", "custom"]}
                  format={(option) => (option === "auto" ? "Auto" : "Custom")}
                  onChange={(v) => set("fovMode", v as "auto" | "custom")}
                />
                <AdminNumber
                  label="FOV"
                  suffix="°"
                  details={
                    cfg.fovMode === "auto"
                      ? "Disabled in auto mode."
                      : "Field of view, in degrees."
                  }
                  disabled={cfg.fovMode === "auto"}
                  min={1}
                  max={179}
                  step={1}
                  value={cfg.fov}
                  onChange={(v) => set("fov", v)}
                />
                <AdminNumber
                  label="Initial yaw"
                  suffix="°"
                  min={-180}
                  max={180}
                  step={1}
                  value={cfg.yaw}
                  onChange={(v) => set("yaw", v)}
                />
                <AdminNumber
                  label="Initial pitch"
                  suffix="°"
                  min={-90}
                  max={90}
                  step={1}
                  value={cfg.pitch}
                  onChange={(v) => set("pitch", v)}
                />
                <AdminNumber
                  label="Initial zoom"
                  details="Positive zooms in."
                  min={-50}
                  max={50}
                  step={0.5}
                  value={cfg.initialZoom}
                  onChange={(v) => set("initialZoom", v)}
                />
                <AdminSwitch
                  label="Maintain model size on resize"
                  checked={cfg.maintainSize}
                  onChange={(v) => set("maintainSize", v)}
                />
              </AdminGroup>

              <AdminGroup title="Controls" icon={Settings}>
                <AdminSwitch
                  label="Allow rotate"
                  checked={cfg.rotate}
                  onChange={(v) => set("rotate", v)}
                />
                <AdminSwitch
                  label="Allow translate (pan)"
                  checked={cfg.translate}
                  onChange={(v) => set("translate", v)}
                />
                <AdminSwitch
                  label="Allow zoom"
                  details="Off also hides the zoom in / out buttons."
                  checked={cfg.zoom}
                  onChange={(v) => set("zoom", v)}
                />
                <AdminSwitch
                  label="Auto rotate"
                  checked={cfg.autoRotate}
                  onChange={(v) => set("autoRotate", v)}
                />
                <AdminSwitch
                  label="Page scroll on touch"
                  details="Allow vertical scroll when dragging on the canvas."
                  checked={cfg.scrollable}
                  onChange={(v) => set("scrollable", v)}
                />
                <AdminSwitch
                  label="Page scroll on mouse wheel"
                  checked={cfg.wheelScrollable}
                  onChange={(v) => set("wheelScrollable", v)}
                />
                <AdminSwitch
                  label="Grab cursor on canvas"
                  checked={cfg.useGrabCursor}
                  onChange={(v) => set("useGrabCursor", v)}
                />
              </AdminGroup>

              <AdminGroup title="Control bar" icon={SlidersHorizontal}>
                <AdminSwitch
                  label="Animation clip name / switcher"
                  details="Shows the active clip in the mini toolbar; click it to pick another. Off means the model does not animate at all."
                  checked={cfg.showAnimationSelector}
                  onChange={(v) => set("showAnimationSelector", v)}
                />
                <AdminSwitch
                  label="Axis gizmo (X/Y/Z)"
                  details="Orientation indicator shown in the corner of the viewer."
                  checked={cfg.showAxes}
                  onChange={(v) => set("showAxes", v)}
                />
                <AdminSwitch
                  label="Zoom in / out buttons"
                  details="Hidden while “Allow zoom” is off, under Controls."
                  checked={cfg.showZoomButtons}
                  onChange={(v) => set("showZoomButtons", v)}
                />
                <AdminSwitch
                  label="Camera (snapshot) button"
                  details="Downloads a PNG of the current view."
                  checked={cfg.showScreenshotButton}
                  onChange={(v) => set("showScreenshotButton", v)}
                />
                <AdminSwitch
                  label="Reset view button"
                  details="Returns the camera to its starting angle and zoom."
                  checked={cfg.showCameraResetButton}
                  onChange={(v) => set("showCameraResetButton", v)}
                />
                <AdminSwitch
                  label="Fullscreen button"
                  checked={cfg.showFullscreenButton}
                  onChange={(v) => set("showFullscreenButton", v)}
                />
              </AdminGroup>

              <AdminGroup title="Animation" icon={Play}>
                <AdminNumber
                  label="Default animation index"
                  details="Which clip plays on load, counted as the switcher lists them: 1 = first, 2 = second… 0 = none. Needs “Animation clip name / switcher” (under Control bar) to be on."
                  min={0}
                  max={99}
                  step={1}
                  value={cfg.defaultAnimationIndex}
                  onChange={(v) => set("defaultAnimationIndex", v)}
                />
                <AdminSelect
                  label="Repeat mode"
                  value={cfg.animationRepeatMode}
                  options={REPEAT_MODES}
                  onChange={(v) => set("animationRepeatMode", v)}
                />
              </AdminGroup>

              <AdminGroup title="AR" icon={Smartphone}>
                <AdminSwitch
                  label="WebXR AR (modern Android Chrome)"
                  checked={cfg.webAR}
                  onChange={(v) => set("webAR", v)}
                />
                <AdminSwitch
                  label="Google Scene Viewer (Android)"
                  checked={cfg.sceneViewer}
                  onChange={(v) => set("sceneViewer", v)}
                />
                <AdminSwitch
                  label="Apple Quick Look (iOS)"
                  details="Requires a .usdz model."
                  checked={cfg.quickLook}
                  onChange={(v) => set("quickLook", v)}
                />
                <AdminText
                  label="iOS source URL (.usdz)"
                  type="url"
                  placeholder="https://...usdz"
                  details="Used by Quick Look on iOS Safari. Upload separately to Shopify Files."
                  value={cfg.iosSrc}
                  onChange={(v) => set("iosSrc", v)}
                />
              </AdminGroup>

              <AdminGroup title="Advanced" icon={Box}>
                <AdminText
                  label="Material variant"
                  placeholder="leave empty for default"
                  details={
                    <>
                      Name of a KHR_materials_variants variant in the model.{" "}
                      {model.variants ? (
                        <>This one has: {model.variants.join(", ")}.</>
                      ) : null}
                    </>
                  }
                  value={cfg.variant}
                  onChange={(v) => set("variant", v)}
                />
                <AdminSwitch
                  label="Fix skinned bounding box"
                  details="Recalculate bbox using skeleton weights (rigged models)."
                  checked={cfg.fixSkinnedBbox}
                  onChange={(v) => set("fixSkinnedBbox", v)}
                />
              </AdminGroup>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/*
 * The viewer where it actually lives: a product page.
 *
 * The important thing this section has to get across is what the app does NOT
 * do. It is a theme app extension: it *adds* a block, wherever the merchant
 * drops it in the theme editor. It does not take over the product media gallery,
 * it does not swap the featured image for a model, and it does not touch the
 * theme's own markup — so the mock below keeps a perfectly ordinary gallery and
 * buy button and shows the viewer arriving underneath them as a separate
 * section, which is what a merchant actually gets.
 *
 * The earlier version of this section put the viewer *in place of* the gallery
 * and captioned it "dropped where the gallery is", which promised an
 * integration that does not exist.
 *
 * The product's colour swatches are deliberately NOT wired to the model here.
 * config.variant is a per-model setting applied once at construction (see the
 * material-variant control in the playground, and cfg.variant in
 * extensions/viewer-3d/assets/viewer-3d.js) — nothing listens for the shopper's
 * variant selection, so swatches that recoloured the model would be inventing a
 * feature. The mock therefore sells size, not colour.
 */
function StorefrontMock() {
  const model = SOFA;
  const config = useMemo(
    () => buildConfig(model, { height: 480, background: "#ffffff" }),
    [model],
  );

  return (
    <section id="storefront" className="border-b">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">
            It adds a section. It doesn&apos;t take anything away.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Your product photos, your gallery and your buy button stay exactly as
            your theme built them. The viewer is a separate block you add in the
            theme editor and drag to wherever you want it, on a product page or
            on any other page in the store.
          </p>
        </div>

        <div className="mt-8 border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-full bg-zinc-300" />
            <span className="size-2.5 rounded-full bg-zinc-300" />
            <span className="size-2.5 rounded-full bg-zinc-300" />
            <span className="ml-2 truncate">
              your-store.myshopify.com/products/glam-three-seater
            </span>
          </div>

          <div className="p-5 sm:p-8">
            {/* The theme's own product section — untouched by the app. */}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div>
                <div className="flex aspect-4/3 items-center justify-center border bg-muted/40 text-sm text-muted-foreground">
                  Your product photo
                </div>
                <div className="mt-3 flex gap-3">
                  {["Front", "Side", "Detail", "In room"].map((thumb) => (
                    <span
                      key={thumb}
                      className="flex size-16 items-center justify-center border bg-muted/40 text-[10px] text-muted-foreground"
                    >
                      {thumb}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Your theme&apos;s media gallery, unchanged.
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {model.category}
                </p>
                <h3 className="mt-1 text-2xl font-semibold">{model.name}</h3>
                <p className="mt-2 text-xl">{model.price}</p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Hand-tufted velvet on a solid ash frame. Available in five
                  colourways.
                </p>

                <p className="mt-6 text-sm font-medium">Size</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["2-seater", "3-seater", "Chaise"].map((size, i) => (
                    <span
                      key={size}
                      className={`border px-3 py-1.5 text-sm ${
                        i === 1 ? "border-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {size}
                    </span>
                  ))}
                </div>

                <button
                  type="button"
                  disabled
                  className="mt-6 w-full cursor-not-allowed bg-foreground px-5 py-3 text-sm font-medium text-background opacity-60"
                >
                  Add to cart
                </button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Demo page. The cart button does nothing.
                </p>
              </div>
            </div>

            {/*
              The app's contribution, drawn as what it is in the theme editor: one
              more app block in the section list, with its own heading and its own
              space, sitting below everything the theme already rendered.
            */}
            <div className="mt-8 border-2 border-dashed border-primary/40 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <Puzzle className="size-3.5" />
                  App block: “3D Viewer (Product)”
                </span>
                <span className="text-xs text-muted-foreground">
                  Added in the theme editor · drag it anywhere in the page
                </span>
              </div>

              <h4 className="mt-5 text-lg font-semibold">See it in 3D</h4>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                Drag to rotate, scroll to zoom, or open it in AR on a phone.
              </p>

              <WhenVisible height={480} label="3D viewer loads as you reach it">
                <ViewerPreview modelUrl={model.url} config={config} />
              </WhenVisible>
            </div>
          </div>
        </div>

        <ul className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          {[
            "Nothing is replaced. The block is added above or below the content you already have",
            "Works on product pages through the product block, and on any other page through the page block",
            "Remove the app and the block goes with it; your theme code was never edited",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Features() {
  const FEATURES = [
    {
      icon: Puzzle,
      title: "A block you add, not a takeover",
      body: "The viewer arrives as its own block in the theme editor, on a product page or any other page, and you drag it where you want it. It never replaces your product images or gallery, nothing edits your theme's code, and removing the app removes the block.",
    },
    {
      icon: Smartphone,
      title: "AR on both platforms, already wired",
      body: "iOS Quick Look and Android Scene Viewer are both configured out of the box, so a shopper can stand the product on their own floor from the viewer they are already using.",
    },
    {
      icon: Gauge,
      title: "Built to stay out of your speed score",
      body: "Viewers mount only when they scroll into view, pause their draw loop when they scroll away, and hand back their WebGL context, so a collection page full of models doesn't melt the tab.",
    },
    {
      icon: Layers,
      title: "Material variants and animation",
      body: "A GLB can carry several material variants; you choose which one a viewer shows, so one file covers a whole colourway range. A rigged model's clips get a switcher that cross-fades between them instead of cutting.",
    },
    {
      icon: Maximize2,
      title: "Around 40 settings, saved per model",
      body: "Camera pose, exposure, tone mapping, environment, shadow, which controls appear: each model keeps its own, so a ring and a sofa don't have to be lit the same way.",
    },
    {
      icon: Play,
      title: "Works outside Shopify too",
      body: "Every model gets a public viewer URL you can drop into an iframe on a landing page, a blog post or a marketplace listing, with the background and rotation overridable per placement.",
    },
  ];

  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">
            What you get when you install it
          </h2>
        </div>
        <div className="mt-8 grid gap-px overflow-hidden border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-background p-6">
              <Icon className="size-5 text-primary" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EmbedAnywhere({ appOrigin }: { appOrigin: string }) {
  const snippet = `<iframe
  src="${appOrigin}/viewer/YOUR-MODEL-ID?bg=f4f4f5&autorotate=1"
  width="100%"
  height="520"
  style="border:0"
  loading="lazy"
  allow="fullscreen; xr-spatial-tracking"
  allowfullscreen
></iframe>`;

  return (
    <section id="embed" className="border-b">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-2 lg:py-20">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Embed the same model anywhere else
          </h2>
          <p className="mt-3 text-muted-foreground">
            Each model in your library has its own viewer URL. Paste the snippet
            into a landing page, a blog post or an email-safe landing page and you
            get the same viewer, with the same saved settings.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3">
              <code className="shrink-0 border bg-muted px-1.5 py-0.5 text-xs">
                ?bg=f4f4f5
              </code>
              <span className="text-muted-foreground">
                Match the host page&apos;s background, without re-saving the model.
              </span>
            </li>
            <li className="flex gap-3">
              <code className="shrink-0 border bg-muted px-1.5 py-0.5 text-xs">
                ?autorotate=0
              </code>
              <span className="text-muted-foreground">
                Hold it still where a turning model would be a distraction.
              </span>
            </li>
            <li className="flex gap-3">
              <code className="shrink-0 border bg-muted px-1.5 py-0.5 text-xs">
                allowfullscreen
              </code>
              <span className="text-muted-foreground">
                Keep it on: fullscreen and AR are granted per frame, so an embed
                without it loses both.
              </span>
            </li>
          </ul>
        </div>

        <div className="border bg-[#0d1117]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="text-xs font-medium text-white/60">
              Paste into any HTML page
            </span>
            <CopyButton
              value={snippet}
              className="inline-flex items-center gap-1.5 border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
            />
          </div>
          <pre className="overflow-x-auto px-4 py-4 text-xs leading-relaxed text-[#c9d1d9]">
            {snippet}
          </pre>
        </div>
      </div>
    </section>
  );
}

/*
 * Pricing.
 *
 * Deliberately the last thing before the closing call to action: a visitor who
 * has scrolled this far has already moved the real viewer's real settings, so
 * this is where "what does it cost" is an actual question rather than a bounce.
 *
 * The launch discount only renders while it is running — see `offerActive` in
 * the loader — so the page does not sit there advertising an expired offer for
 * however long it takes someone to notice.
 */
function Pricing({ offerActive }: { offerActive: boolean }) {
  return (
    <section id="pricing" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">
            Pricing that scales with the catalog, not the traffic
          </h2>
          <p className="mt-3 text-muted-foreground">
            Every plan includes every viewer feature — all the settings, AR on
            both platforms, material variants, animation and the public embed
            URL. What changes between plans is how many products you can put a
            model on. There is no per-view or per-visitor charge.
          </p>
        </div>

        {offerActive ? (
          <div className="mt-8 flex flex-col gap-4 border border-primary/40 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-semibold">
                  Launch offer: {LAUNCH_OFFER_PERCENT_LABEL} off your first{" "}
                  {LAUNCH_OFFER.months} months
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Subscribe to any paid plan before {LAUNCH_OFFER.endsLabel} and
                  the discount applies to your first {LAUNCH_OFFER.months}{" "}
                  billing cycles — automatically, with no code to enter. After
                  that the plan renews at its normal price, and you can change or
                  cancel it at any time.
                </p>
              </div>
            </div>
            <a
              href={APP_LISTING_URL}
              className="inline-flex shrink-0 items-center justify-center gap-2 bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Claim the offer
              <ArrowRight className="size-4" />
            </a>
          </div>
        ) : null}

        {/*
          Same hairline grid as the feature cards above: one gap-px grid over a
          border-coloured background, so the dividers between cards are the grid
          gaps rather than per-card borders that double up where two cards meet.
        */}
        <div className="mt-8 grid gap-px overflow-hidden border bg-border md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => {
            const paid = plan.price > 0;
            const discounted = paid && offerActive;

            return (
              <div key={plan.name} className="flex flex-col bg-background p-6">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {plan.popular ? (
                    <span className="border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {plan.blurb}
                </p>

                <div className="mt-5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tracking-tight">
                      ${formatMoney(discounted ? launchOfferPrice(plan.price) : plan.price)}
                    </span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  {discounted ? (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      <span className="line-through">
                        ${formatMoney(plan.price)}
                      </span>{" "}
                      for {LAUNCH_OFFER.months} months, then ${formatMoney(plan.price)}
                      /month
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {paid
                      ? `Includes a ${plan.trialDays}-day free trial`
                      : "Free forever. No card, no trial to remember."}
                  </p>
                </div>

                <a
                  href={APP_LISTING_URL}
                  className={
                    plan.popular
                      ? "mt-5 inline-flex items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                      : "mt-5 inline-flex items-center justify-center gap-2 border px-4 py-2.5 text-sm font-medium hover:bg-muted"
                  }
                >
                  {paid ? "Start free trial" : "Start free"}
                </a>

                <ul className="mt-6 space-y-2.5 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Prices in USD and billed by Shopify on your existing store invoice, so
          there is no separate card to add. Yearly billing is available inside the
          app at ten months&apos; price — two months free.{" "}
          {offerActive
            ? `The ${LAUNCH_OFFER_PERCENT_LABEL} launch discount is applied automatically, with no code, to the first ${LAUNCH_OFFER.months} billing cycles of a paid monthly subscription started before ${LAUNCH_OFFER.endsLabel}.`
            : null}{" "}
          You can move between plans or cancel at any time from the app; your
          models and their settings stay in your library either way.
        </p>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="bg-[#0d1117] text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 lg:flex-row lg:items-center lg:justify-between lg:py-16">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Put your own product in here
          </h2>
          <p className="mt-2 max-w-xl text-white/70">
            Install the app, upload a GLB, add the block. If you don&apos;t have a model
            yet, start with one product, which is usually enough to see whether
            it moves your returns.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={APP_LISTING_URL}
            className="inline-flex items-center gap-2 bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Add to your store
            <ArrowRight className="size-4" />
          </a>
          <a
            href={DOCS_URL}
            className="inline-flex items-center gap-2 border border-white/20 px-5 py-3 text-sm font-medium hover:bg-white/10"
          >
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a href={APP_LISTING_URL} className="hover:underline">
            Shopify App Store
          </a>
          <a href={DOCS_URL} className="hover:underline">
            Documentation
          </a>
          <a href={SUPPORT_URL} className="hover:underline">
            Support
          </a>
          <a href={PRIVACY_URL} className="hover:underline">
            Privacy policy
          </a>
        </div>

        {/*
          CC BY is only satisfied if the attribution actually ships with the page
          that uses the work — hence this block rather than a line in a README.
        */}
        <div className="mt-8 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
          <p>
            Demo models come from the{" "}
            <a
              className="underline"
              href="https://github.com/KhronosGroup/glTF-Sample-Assets"
            >
              Khronos glTF Sample Assets
            </a>{" "}
            and are shown here under their own licences. They are sample assets,
            not products for sale.
          </p>
          <ul className="mt-3 space-y-1">
            {MODELS.map((model) => (
              <li key={model.id}>
                <span className="text-foreground">{model.name}</span>:{" "}
                {model.credit.asset} © {model.credit.author},{" "}
                <a className="underline" href={model.credit.licenseUrl}>
                  {model.credit.license}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            © {new Date().getFullYear()} bPlugins. Shopify is a trademark of
            Shopify Inc., used here only to describe compatibility.
          </p>
        </div>
      </div>
    </footer>
  );
}
