import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import {
  getAssignedModelGidsCached,
  getOrCreateUser,
} from "~/lib/billing.server";
import { checkDefsReadyCached } from "~/lib/metafields.server";
import {
  checkThemeBlocksCached,
  invalidateThemeBlocks,
  placeBlockAfterBuyButton,
} from "~/lib/theme-blocks.server";

import { evaluateReviewPrompt } from "~/lib/review-prompt.server";

import { BackButton } from "~/components/BackButton";
import { useReviewPrompt } from "~/components/ReviewPrompt";
import { SupportAction } from "~/components/SupportAction";
import { flag, useRouteNav } from "~/components/polaris/helpers";

/**
 * Onboarding is derived, not stored: each step asks the store whether it is
 * already true, so a merchant who did the work outside the wizard (or reinstalls
 * onto a configured store) sees it ticked rather than being walked through it
 * again. `AppUser.onboardingStep` only records how far the wizard has been
 * *seen*, which is what stops the dashboard bouncing here forever.
 */
type StepState = {
  defsReady: boolean;
  hasModel: boolean;
  blockAdded: boolean;
};

type LoaderData = StepState & {
  assigned: number;
  libraryCount: number;
  onboardingDone: boolean;
  shopHandle: string;
  apiKey: string;
};

const TOTAL_STEPS = 3;

function doneCount(s: StepState): number {
  return [s.defsReady, s.hasModel, s.blockAdded].filter(Boolean).length;
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  // Nothing below reads `user` before the block resolves, so it belongs in it
  // rather than ahead of it — one Mongo round trip (~250ms) off the response.
  const [user, defsReady, assignedModels, libraryCount, themeBlocks] =
    await Promise.all([
      getOrCreateUser(shop),
      checkDefsReadyCached(admin, shop),
      getAssignedModelGidsCached(admin, shop),
      prisma.model3D.count({ where: { shop } }),
      checkThemeBlocksCached(admin, shop),
    ]);

  /*
   * Reaching this page is what marks the wizard as seen; the dashboard
   * redirects here only while the counter is 0, so this is what makes it a
   * one-time nudge.
   *
   * Written beside the response rather than in front of it: the value returned
   * below is `user.onboardingDone`, which this does not touch, and the redirect
   * that depends on the counter is evaluated on the *next* request by which
   * time the write has long landed. Awaiting it put a Mongo write on the
   * critical path of the first page a new merchant ever sees.
   */
  if (user.onboardingStep === 0) {
    void prisma.appUser
      .update({ where: { id: user.id }, data: { onboardingStep: 1 } })
      .catch((err) => {
        console.error("[onboarding] marking wizard as seen failed", err);
      });
  }

  return {
    defsReady,
    hasModel: assignedModels.count > 0 || libraryCount > 0,
    blockAdded: themeBlocks.productBlockAdded,
    assigned: assignedModels.count,
    libraryCount,
    onboardingDone: user.onboardingDone,
    shopHandle: shop.split(".")[0] ?? "",
    // The theme-editor deep link in step 3 is built in the browser and needs the
    // client id. Same route into the page as app.tsx's own `apiKey`: it is a
    // public value, and `required()` in shopify.server.ts guarantees it is set.
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
  };
};

/** The wizard's three steps, read the same way the loader reads them. */
async function allStepsDone(
  admin: Parameters<typeof getAssignedModelGidsCached>[0],
  shop: string,
): Promise<boolean> {
  try {
    const [defsReady, assignedModels, libraryCount, themeBlocks] =
      await Promise.all([
        checkDefsReadyCached(admin, shop),
        getAssignedModelGidsCached(admin, shop),
        prisma.model3D.count({ where: { shop } }),
        checkThemeBlocksCached(admin, shop),
      ]);
    return (
      doneCount({
        defsReady,
        hasModel: assignedModels.count > 0 || libraryCount > 0,
        blockAdded: themeBlocks.productBlockAdded,
      }) === TOTAL_STEPS
    );
  } catch (error) {
    console.error("[onboarding] step check failed", error);
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  // "Later" is not a state change — the merchant just wants the dashboard, and
  // the checklist must still be waiting for them. Recording it as done here is
  // what made "Finish later" mean "never again".
  if (intent === "later") {
    return framedRedirect(request, "/app");
  }

  // Finishing and skipping are the same state change: the merchant is telling us
  // they are through with the checklist, so stop redirecting them into it.
  if (intent === "finish" || intent === "skip") {
    await prisma.appUser.update({
      where: { shop },
      data: { onboardingDone: true, onboardingStep: TOTAL_STEPS },
    });
    /*
     * Finishing with every step ticked is a review moment. The dashboard is
     * where it is asked, so the moment travels there in the URL; the dashboard
     * still checks every review rule itself. Skipping is not a success.
     */
    if (intent === "finish" && (await allStepsDone(admin, shop))) {
      return framedRedirect(request, "/app?reviewMoment=onboarding-finished");
    }
    return framedRedirect(request, "/app");
  }

  /*
   * The deep link adds the block in a *separate* tab, so nothing in this route
   * ever learns about it: the loader doesn't re-run and checkThemeBlocksCached
   * would hand back its 60s-old answer if it did. Dropping the cache entry and
   * returning a plain result (not a redirect) makes React Router revalidate the
   * loader, which is what ticks the step.
   *
   * This is also where placement is settled. Shopify's deep link appends the
   * block to the product section and offers no way to ask for an index, so the
   * viewer lands below the description rather than under the buy button. Now
   * that the block exists we can move it — re-reading the status first so the
   * cache the loader is about to hit is the one we just warmed.
   */
  if (intent === "recheck") {
    invalidateThemeBlocks(shop);
    const status = await checkThemeBlocksCached(admin, shop);

    if (!status.productBlockAdded) {
      return {
        ok: false,
        error:
          "Still can't see the block. Add it in the theme editor and press Save.",
      };
    }
    // The viewer is now on the storefront: a review moment.
    const reviewPrompt = await evaluateReviewPrompt(
      admin,
      shop,
      "theme-block-confirmed",
      {
        productBlockAdded: status.productBlockAdded,
        pageBlockAdded: status.pageBlockAdded,
      },
    );

    if (!status.themeId) {
      return { ok: true, message: "Block found", reviewPrompt };
    }

    const placed = await placeBlockAfterBuyButton(
      admin,
      status.themeId,
      "templates/product.json",
      "product_viewer",
    );

    if (!placed.ok) {
      // The block is there, which is what the step is about; failing to move it
      // is a worse message than none, so say the true half.
      console.error("[onboarding] repositioning the block failed", placed.error);
      return { ok: true, message: "Block found", reviewPrompt };
    }
    if (placed.moved) {
      return {
        ok: true,
        message: "Block found — moved below your buy button",
        reviewPrompt,
      };
    }
    return {
      ok: true,
      reviewPrompt,
      message:
        placed.reason === "already-in-place"
          ? "Block found — already below your buy button"
          : "Block found — drag it where you want it in the theme editor",
    };
  }

  return { ok: false, error: "Unknown action" };
};

function StepCard({
  index,
  done,
  active,
  icon,
  title,
  description,
  children,
}: {
  index: number;
  done: boolean;
  active: boolean;
  icon: string;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderStyle="solid"
      // Only the step the merchant should act on next is emphasised. A finished
      // step and a not-yet-reachable one both recede, so the page always has
      // exactly one visual entry point.
      borderColor={active && !done ? "strong" : "base"}
      borderRadius="base"
      background={done ? "subdued" : "base"}
    >
      <s-stack direction="inline" gap="base" alignItems="start">
        {done ? (
          <s-icon type="check-circle-filled" tone="success" />
        ) : (
          <s-badge tone={active ? "info" : "neutral"}>{String(index)}</s-badge>
        )}

        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-icon type={icon as any} color="subdued" />
            <s-text type="strong">{title}</s-text>
            {done ? <s-badge tone="success">Done</s-badge> : null}
          </s-stack>

          <s-text color="subdued">{description}</s-text>

          {children ? (
            <s-stack direction="inline" gap="small" alignItems="center">
              {children}
            </s-stack>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export default function Onboarding() {
  const {
    defsReady,
    hasModel,
    blockAdded,
    assigned,
    libraryCount,
    shopHandle,
    apiKey,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  useReviewPrompt(
    actionData && "reviewPrompt" in actionData ? actionData.reviewPrompt : null,
  );
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const routeTo = useRouteNav();

  // Step 1 reuses the Setup route's action rather than restating how the three
  // metafield definitions are created and made storefront-readable.
  const setupFetcher = useFetcher<{
    ok: boolean;
    message?: string;
    error?: string;
  }>();
  const creatingDefs = setupFetcher.state !== "idle";
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    const data = setupFetcher.data;
    if (!data) return;
    if (data.ok) shopify.toast.show(data.message ?? "Metafields ready");
    else if (data.error) shopify.toast.show(data.error, { isError: true });
  }, [setupFetcher.data, shopify]);

  useEffect(() => {
    if (!actionData) return;
    // `later`, `finish` and `skip` all redirect, so the only response that ever
    // reaches here is `recheck`.
    if ((actionData as any).ok) {
      shopify.toast.show((actionData as any).message ?? "Theme re-checked");
    } else if ((actionData as any).error) {
      shopify.toast.show((actionData as any).error, { isError: true });
    }
  }, [actionData, shopify]);

  const done = doneCount({ defsReady, hasModel, blockAdded });
  const allDone = done === TOTAL_STEPS;
  const themeEditorUrl = shopHandle
    ? `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product`
    : null;

  /*
   * Shopify's app block deep link: the editor opens with the block already
   * placed in the product template's main section, so the merchant only has to
   * press Save.
   *
   * `addAppBlockId` takes `{api_key}/{block_handle}` — api_key being the app's
   * *client_id* from shopify.app.toml, not the theme extension's uid, which is
   * the easy thing to get wrong here. The handle is the block's filename in
   * extensions/viewer-3d/blocks/.
   *
   * `target=mainSection` puts it inside the product section rather than in a
   * detached Apps section at the foot of the page. Shopify appends it to that
   * section's blocks, so it lands below the buy button; there is no parameter
   * for a precise index, so exact placement stays a drag in the editor.
   *
   * It only works on JSON templates — a vintage Liquid theme opens the editor
   * and ignores the parameter, leaving "Open theme editor" as the way through.
   */
  const addBlockUrl =
    themeEditorUrl && apiKey
      ? `${themeEditorUrl}&addAppBlockId=${apiKey}/product_viewer&target=mainSection`
      : null;

  function post(intent: string, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("intent", intent);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    submit(fd, { method: "post" });
  }

  return (
    /*
      The heading is the page's name in the hierarchy — "Get started", matching
      its entry in the app nav — so the breadcrumb reads Dashboard > Get started.
      It used to be a sentence that changed with progress, which made the page
      title differ from every other reference to it and left the back arrow
      pointing at an unnamed parent. The encouraging line moved into the section
      below, where the rest of the supporting copy already lives.
    */
    <s-page heading="Get started">
      <BackButton to="/app" label="Dashboard" />
      <SupportAction />

      <s-section>
        <s-stack direction="block" gap="base">
          <s-heading>
            {allDone
              ? "You're ready to sell in 3D"
              : "Let's get your first 3D model live"}
          </s-heading>
          <s-paragraph color="subdued">
            {allDone
              ? "Everything is configured. Open the dashboard to manage models, or fine-tune a product's viewer."
              : "Three steps: connect the metafields the viewer reads, add a model, then place the block on your theme."}
          </s-paragraph>

          {/*
            Progress is stated rather than drawn. Polaris ships no progress bar
            web component, and a hand-rolled one would be the single element on
            the page not built from admin tokens — the thing a Built for Shopify
            review notices. A badge carries the same information natively.
          */}
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={allDone ? "success" : "info"}>
              {`${done} of ${TOTAL_STEPS} done`}
            </s-badge>
            <s-text color="subdued">Setup takes about 3 minutes</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          <StepCard
            index={1}
            done={defsReady}
            active={!defsReady}
            icon="settings"
            title="Connect the viewer metafields"
            description={
              defsReady ? (
                <>
                  <code>custom.model_3d</code> and{" "}
                  <code>custom.viewer_3d_config</code> exist and are readable by
                  your storefront.
                </>
              ) : (
                <>
                  The viewer reads each product’s model and settings from two
                  metafields. This creates them with storefront read access —
                  nothing on your store changes.
                </>
              )
            }
          >
            {defsReady ? (
              <s-button href="/app/setup" onClick={routeTo("/app/setup")}>
                Review in Setup
              </s-button>
            ) : (
              <s-button
                variant="primary"
                icon="wand"
                loading={flag(creatingDefs)}
                onClick={() =>
                  setupFetcher.submit(new FormData(), {
                    method: "post",
                    action: "/app/setup",
                  })
                }
              >
                Create definitions
              </s-button>
            )}
          </StepCard>

          <StepCard
            index={2}
            done={hasModel}
            active={defsReady && !hasModel}
            icon="package"
            title="Add your first 3D model"
            description={
              hasModel ? (
                <>
                  {assigned} product{assigned === 1 ? "" : "s"} with a model,{" "}
                  {libraryCount} in your library. Each product carries one
                  model, and a model belongs to one product.
                </>
              ) : (
                <>
                  Upload a <code>.glb</code> or <code>.gltf</code> to a product,
                  or add one to the library to embed on any page. Every viewer
                  setting is previewed live before you save.
                </>
              )
            }
          >
            <s-button
              variant={hasModel ? "secondary" : "primary"}
              icon="package"
              href="/app/products"
              onClick={routeTo("/app/products")}
            >
              Pick a product
            </s-button>
            <s-button
              icon="three-d-environment"
              href="/app/models"
              onClick={routeTo("/app/models")}
            >
              Model library
            </s-button>
          </StepCard>

          <StepCard
            index={3}
            done={blockAdded}
            active={defsReady && hasModel && !blockAdded}
            icon="rocket"
            title="Show the viewer on your storefront"
            description={
              blockAdded ? (
                <>
                  The <s-text type="strong">3D Viewer — Product</s-text> block
                  is on your published theme’s product template.
                </>
              ) : (
                <>
                  Add the <s-text type="strong">3D Viewer — Product</s-text>{" "}
                  block to your product template. We can open the theme editor
                  with the block already placed — all that’s left is Save.
                </>
              )
            }
          >
            {!blockAdded && addBlockUrl ? (
              /*
                A real link rather than window.open() in a click handler. This
                page runs inside the admin's iframe, where a scripted pop-up is
                at the mercy of the embedder and silently does nothing when it
                is refused; an anchor with target="_blank" is the path App
                Bridge handles for us, and is what every other open-in-a-tab
                button in this app uses.
              */
              <s-button
                variant="primary"
                icon="wand"
                href={addBlockUrl}
                target="_blank"
              >
                Add block for me
              </s-button>
            ) : null}
            {themeEditorUrl ? (
              <s-button href={themeEditorUrl} target="_blank" icon="external">
                Open theme editor
              </s-button>
            ) : null}
            {!blockAdded ? (
              <s-button
                variant="tertiary"
                icon="refresh"
                loading={flag(submitting)}
                onClick={() => post("recheck")}
              >
                I’ve added it — check again
              </s-button>
            ) : null}
          </StepCard>
        </s-stack>
      </s-section>

      <s-section heading={allDone ? "All set" : "Need a hand?"}>
        <s-paragraph color="subdued">
          {allDone
            ? "You can always come back to this checklist from the Get started link in the app nav."
            : "The documentation covers file requirements, every viewer setting, AR, and embedding outside Shopify."}
        </s-paragraph>

        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button
            variant={allDone ? "primary" : "secondary"}
            loading={flag(submitting)}
            onClick={() => post(allDone ? "finish" : "later")}
          >
            {allDone ? "Go to dashboard" : "Finish later"}
          </s-button>
          <s-button
            icon="book"
            href="/app/documentation"
            onClick={routeTo("/app/documentation")}
          >
            Documentation
          </s-button>
          {!allDone ? (
            <s-button
              variant="tertiary"
              loading={flag(submitting)}
              onClick={() => post("skip")}
            >
              Skip onboarding
            </s-button>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
