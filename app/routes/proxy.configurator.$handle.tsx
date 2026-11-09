import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "~/shopify.server";
import { resolveAppOrigin } from "~/lib/app-origin.server";
import {
  getConfiguratorStrings,
  getStorefrontStrings,
  resolveStorefrontLocale,
} from "~/lib/storefront-i18n.server";
import {
  CONFIGURATOR_NAMESPACE,
  DRAFT_KEY,
  RENDER_KEY,
} from "~/lib/configurator/constants";

/*
 * The Product configurator as a standalone page, for themes that can't take
 * app blocks (vintage themes, page builders, custom storefront pages):
 *
 *   https://<shop>/apps/viewer-3d/configurator/<handle>
 *     -> <app>/proxy/configurator/<handle>     ([app_proxy] in shopify.app.toml)
 *
 * Embedded with an <iframe> (see app/lib/configurator/embed-snippet.ts). It is
 * served through the app proxy on purpose: the page then lives on the shop's own
 * domain, so /cart/add.js adds to the shopper's real cart, and the parent page
 * can be told to refresh its cart count.
 *
 * The response is Liquid (no theme layout), so Shopify renders the product, its
 * prices in the shopper's currency and the add-to-cart form exactly as the app
 * block does. The configurator data (app-owned metafields) and the model are
 * resolved here through the Admin API and handed to the page.
 *
 * The markup mirrors extensions/viewer-3d/blocks/product_configurator.liquid —
 * keep the two in step — and it runs the same configurator.js / viewer-3d.js.
 *
 * Query parameters (all optional) stand in for the block's settings:
 *   media=3d|image  height=300..800  bg=ffffff  position=left|right
 *   variant_style=pills|dropdown  vendor=1  sku=1  buy_now=0  quantity=0
 *   description=0  lang=<locale>  variant=<id>
 */

// Changes on every deploy (the process restarts), so shoppers get new assets.
const ASSET_VERSION = Date.now().toString(36);

const HANDLE = /^[\p{L}\p{N}_-]{1,255}$/u;

/** HTML-attribute escaped, and Liquid-inert: braces become entities. */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

const parseJson = (raw: unknown): any => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

type Settings = {
  media: "3d" | "image";
  height: number;
  bg: string;
  position: "left" | "right";
  variantStyle: "pills" | "dropdown";
  vendor: boolean;
  sku: boolean;
  buyNow: boolean;
  quantity: boolean;
  description: boolean;
};

function readSettings(q: URLSearchParams): Settings {
  const flag = (key: string, fallback: boolean) => {
    const v = q.get(key);
    return v === null ? fallback : v === "1" || v === "true";
  };
  const height = Number(q.get("height"));
  const bg = (q.get("bg") ?? "").replace(/^#/, "");
  return {
    media: q.get("media") === "image" ? "image" : "3d",
    height: Number.isFinite(height) && height >= 300 && height <= 800 ? Math.round(height) : 550,
    bg: /^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(bg) ? `#${bg}` : "#ffffff",
    position: q.get("position") === "right" ? "right" : "left",
    variantStyle: q.get("variant_style") === "dropdown" ? "dropdown" : "pills",
    vendor: flag("vendor", false),
    sku: flag("sku", false),
    buyNow: flag("buy_now", true),
    quantity: flag("quantity", true),
    description: flag("description", true),
  };
}

type Resolved = {
  renderJson: string;
  draftJson: string | null;
  modelUrl: string;
  draftOnly: boolean;
  viewerConfigJson: string;
};

/** The block's model / config logic, server-side (it reads app-owned metafields). */
async function resolveConfigurator(admin: any, handle: string): Promise<Resolved | null> {
  const res = await admin.graphql(
    `#graphql
      query EmbedConfigurator($handle: String!) {
        product: productByIdentifier(identifier: { handle: $handle }) {
          id
          render: metafield(namespace: "${CONFIGURATOR_NAMESPACE}", key: "${RENDER_KEY}") { value }
          draft: metafield(namespace: "${CONFIGURATOR_NAMESPACE}", key: "${DRAFT_KEY}") { value }
          viewerConfig: metafield(namespace: "custom", key: "viewer_3d_config") { value }
          model: metafield(namespace: "custom", key: "model_3d") {
            reference {
              ... on Model3d { sources { url format } }
              ... on GenericFile { url }
            }
          }
        }
      }`,
    { variables: { handle } },
  );
  const json: any = await res.json();
  const p = json?.data?.product;
  if (!p) return null;

  const render = parseJson(p.render?.value);
  const draft = parseJson(p.draft?.value);
  const hasDraftDiff = !!draft && draft.enabled !== false && (!render || draft.rev !== render.rev);
  const viewerOff = !!render && render.enabled === false;
  const optionsOn = !!render && render.enabled !== false && render.customizer !== "off";

  let modelUrl = "";
  if (optionsOn && render.model) modelUrl = render.models?.[render.model]?.glb ?? "";
  let draftOnly = false;
  if (!modelUrl && !render && hasDraftDiff && draft.model) {
    modelUrl = draft.models?.[draft.model]?.glb ?? "";
    draftOnly = !!modelUrl;
  }
  if (!modelUrl && !viewerOff) {
    const ref = p.model?.reference;
    const source = ref?.sources?.find((s: any) => /^(glb|gltf)$/i.test(String(s.format)));
    modelUrl = source?.url ?? ref?.url ?? "";
  }

  const viewerConfig = parseJson(p.viewerConfig?.value);
  return {
    renderJson: optionsOn ? JSON.stringify(render) : "null",
    draftJson: hasDraftDiff ? JSON.stringify(draft) : null,
    modelUrl,
    draftOnly,
    viewerConfigJson: JSON.stringify(viewerConfig ?? null),
  };
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { liquid, admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const handle = String(params.handle ?? "");
  const notFound = () =>
    liquid(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:24px;color:#666">Product not found.</body></html>`,
      { layout: false, status: 404 },
    );
  if (!HANDLE.test(handle) || !admin) return notFound();

  const resolved = await resolveConfigurator(admin, handle);
  if (!resolved) return notFound();

  const s = readSettings(url.searchParams);
  const locale = resolveStorefrontLocale(
    url.searchParams.get("lang"),
    request.headers.get("Accept-Language"),
  );
  const cs = getConfiguratorStrings(locale);
  const origin = resolveAppOrigin(request);
  const asset = (file: string) => `${origin}/storefront-assets/${file}?v=${ASSET_VERSION}`;
  const { renderJson, draftJson, modelUrl, draftOnly, viewerConfigJson } = resolved;
  const hasModel = !!modelUrl;
  const t = (key: string) => attr(cs[key] ?? key);
  // Loaded as an iframe srcdoc the page has no URL of its own (about:srcdoc),
  // so the embed passes the shopper's ?variant= here and Liquid selects it.
  const variantParam = url.searchParams.get("variant") ?? "";
  const variantId = /^\d{1,20}$/.test(variantParam) ? variantParam : "";

  // Everything injected below is either attr()-escaped (Liquid-inert) or a
  // fixed enum / number, so merchant text can never become Liquid.
  const body = `{%- liquid
  assign p = all_products['${handle}']
  assign current_variant = p.selected_or_first_available_variant
${variantId ? `  for v in p.variants
    if v.id == ${variantId}
      assign current_variant = v
    endif
  endfor
` : ""}  assign first_image = current_variant.featured_image | default: p.featured_image
  assign show_image_first = false
  if first_image
    if ${hasModel ? "false" : "true"} or '${s.media}' == 'image'
      assign show_image_first = true
    endif
  endif
  assign poster_url = ''
  if p.featured_image
    assign poster_url = p.featured_image | image_url: width: 1200
  endif
  # "/" on the primary locale, "/fr" on a subfolder one; cart URLs hang off it.
  assign root = routes.root_url
  if root != '/'
    assign root = root | append: '/'
  endif
-%}
<!doctype html>
<html lang="${attr(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <base target="_top">
  <title>{{ p.title | escape }}</title>
  <link rel="stylesheet" href="${attr(asset("viewer-3d.css"))}">
  <link rel="stylesheet" href="${attr(asset("configurator.css"))}">
  <style>
    html, body { margin: 0; background: transparent; }
    body { padding: 0; color: #111; }
    .e3d-product { padding: 0; }
  </style>
  <script>window.Shopify = window.Shopify || {}; window.Shopify.routes = { root: {{ root | json }} };</script>
</head>
<body>
{%- if p == empty or p == nil -%}
  <p style="font-family:system-ui,sans-serif;padding:24px;color:#666">Product not found.</p>
{%- else -%}
<div
  class="viewer-3d-block e3d-configurator e3d-product e3d-media-${s.position}"
  data-e3d-configurator
  data-e3d-embedded
  data-render="${attr(renderJson)}"
  ${draftJson ? `data-render-draft="${attr(draftJson)}"` : ""}
  data-product="{{ p | json | escape }}"
  data-variant-id="{{ current_variant.id }}"
  data-currency="{{ localization.country.currency.iso_code | escape }}"
  data-locale="${attr(locale)}"
  data-i18n="${attr(JSON.stringify(cs))}"
>
  <div class="e3d-gallery">
    <div class="e3d-stage{% if show_image_first and ${hasModel} %} e3d-showing-image{% endif %}" style="--viewer-height: ${s.height}px;">
      ${
        hasModel
          ? `<div
        id="viewer-3d-embed"
        class="viewer-3d"
        ${draftOnly ? "hidden data-draft-hidden" : ""}
        style="--viewer-height: ${s.height}px; --viewer-bg: ${s.bg}; background: ${s.bg};"
        data-view3d
        data-model-url="${attr(modelUrl)}"
        data-poster-url="{{ poster_url }}"
        data-viewer-height="${s.height}"
        data-viewer-bg="${s.bg}"
        data-placement="product"
        data-track-target="{{ p.id }}"
        data-track-url="/apps/viewer-3d/track"
        data-config="${attr(viewerConfigJson)}"
        data-locale="${attr(locale)}"
        data-i18n="${attr(JSON.stringify(getStorefrontStrings(locale)))}"
      >
        <canvas class="view3d-canvas"></canvas>
      </div>`
          : ""
      }
      {%- for image in p.images -%}
        <img
          class="e3d-image{% if show_image_first and image.id == first_image.id %} is-active{% endif %}"
          data-e3d-image="{{ image.id }}"
          src="{{ image | image_url: width: 1200 }}"
          alt="{{ image.alt | escape }}"
          width="{{ image.width }}"
          height="{{ image.height }}"
          loading="{% if forloop.first %}eager{% else %}lazy{% endif %}"
        >
      {%- endfor -%}
    </div>

    {%- if p.images.size > 1 or ${hasModel} and p.images.size > 0 -%}
      <div class="e3d-thumbs">
        ${
          hasModel
            ? `<button type="button" class="e3d-thumb-btn e3d-thumb-3d{% unless show_image_first %} is-on{% endunless %}" data-e3d-thumb="3d" aria-pressed="{% if show_image_first %}false{% else %}true{% endif %}"${draftOnly ? " hidden data-draft-hidden" : ""}>${t("view_3d")}</button>`
            : ""
        }
        {%- for image in p.images -%}
          <button
            type="button"
            class="e3d-thumb-btn{% if show_image_first and image.id == first_image.id %} is-on{% endif %}"
            data-e3d-thumb="{{ image.id }}"
            aria-pressed="{% if show_image_first and image.id == first_image.id %}true{% else %}false{% endif %}"
          >
            <img src="{{ image | image_url: width: 160, height: 160, crop: 'center' }}" alt="{{ image.alt | escape }}" width="80" height="80" loading="lazy">
          </button>
        {%- endfor -%}
      </div>
    {%- endif -%}
  </div>

  <div class="e3d-info">
    ${s.vendor ? `{%- if p.vendor != blank -%}<p class="e3d-vendor">{{ p.vendor }}</p>{%- endif -%}` : ""}
    <h1 class="e3d-title">{{ p.title }}</h1>

    <p class="e3d-price-line">
      <span class="e3d-price-main" data-e3d-price-main>{{ current_variant.price | money }}</span>
      <s class="e3d-price-compare" data-e3d-price-compare{% unless current_variant.compare_at_price > current_variant.price %} hidden{% endunless %}>
        {%- if current_variant.compare_at_price > current_variant.price %}{{ current_variant.compare_at_price | money }}{% endif -%}
      </s>
    </p>

    ${s.sku ? `{%- if current_variant.sku != blank -%}<p class="e3d-sku">SKU: <span data-e3d-sku>{{ current_variant.sku }}</span></p>{%- endif -%}` : ""}

    {%- unless p.has_only_default_variant -%}
      <div class="e3d-options">
        {%- for option in p.options_with_values -%}
          {%- assign option_index = forloop.index0 -%}
          <fieldset class="e3d-opt" data-option-index="{{ option_index }}">
            <legend class="e3d-label">{{ option.name }}</legend>
            ${
              s.variantStyle === "dropdown"
                ? `<select class="e3d-select" aria-label="{{ option.name | escape }}">
              {%- for value in option.values -%}
                <option value="{{ value | escape }}"{% if option.selected_value == value %} selected{% endif %}>{{ value }}</option>
              {%- endfor -%}
            </select>`
                : `<div class="e3d-pills">
              {%- for value in option.values -%}
                <label class="e3d-pill">
                  <input type="radio" name="e3d-embed-{{ option_index }}" value="{{ value | escape }}"{% if option.selected_value == value %} checked{% endif %}>
                  <span>{{ value }}</span>
                </label>
              {%- endfor -%}
            </div>`
            }
          </fieldset>
        {%- endfor -%}
      </div>
    {%- endunless -%}

    <div class="e3d-panel" data-e3d-panel hidden></div>

    {%- form 'product', p, data-e3d-form: '', class: 'e3d-form' -%}
      <input type="hidden" name="id" value="{{ current_variant.id }}">
      ${
        s.quantity
          ? `<label class="e3d-qty">
        <span class="e3d-label">${t("quantity")}</span>
        <input type="number" name="quantity" value="1" min="1" inputmode="numeric">
      </label>`
          : ""
      }
      <button type="submit" name="add" class="e3d-add" data-e3d-submit{% unless current_variant.available %} disabled{% endunless %}>
        {%- if current_variant.available -%}${t("add_to_cart")}{%- else -%}${t("sold_out")}{%- endif -%}
      </button>
      ${
        s.buyNow
          ? `<button type="button" class="e3d-buy" data-e3d-buy{% unless current_variant.available %} disabled{% endunless %}>${attr(getStorefrontStrings(locale).buy_now ?? "Buy now")}</button>`
          : ""
      }
      <p class="e3d-msg" role="status" data-e3d-msg></p>
    {%- endform -%}

    ${s.description ? `{%- if p.description != blank -%}<div class="e3d-description rte">{{ p.description }}</div>{%- endif -%}` : ""}
  </div>
</div>
${
  hasModel
    ? `<script src="${attr(asset("viewer-3d.js"))}" data-vendor-js="${attr(asset("view3d.pkgd.min.js"))}" data-vendor-css="${attr(asset("view3d-bundle.min.css"))}" defer></script>`
    : ""
}
<script src="${attr(asset("configurator.js"))}" defer></script>
<script>
  /* Tell the embedding page how tall this is, so its iframe never scrolls. */
  (function () {
    if (window.parent === window) return;
    var last = 0;
    function post() {
      var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h && h !== last) {
        last = h;
        window.parent.postMessage({ type: "e3d:height", height: h }, "*");
      }
    }
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
    window.addEventListener("load", post);
    post();
  })();
</script>
{%- endif -%}
</body>
</html>`;

  return liquid(body, {
    layout: false,
    headers: {
      // Configurator data comes from this request, not from Liquid: a cached
      // copy would show yesterday's options after a publish.
      "Cache-Control": "no-store",
    },
  });
};
