import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import {
  fieldValue,
  flag,
  useOverlay,
  type OverlayElement,
} from "~/components/polaris/helpers";
import type { SupportPrefill } from "~/routes/api.support";
import { ModalAction } from "~/components/polaris/ModalAction";

type Form = {
  name: string;
  email: string;
  subject: string;
  message: string;
  /** Feature requests only. */
  category: string;
  importance: string;
};

const EMPTY: Form = {
  name: "",
  email: "",
  subject: "",
  message: "",
  category: "viewer",
  importance: "nice",
};

/** Dialog ids, for opening a form from elsewhere with command/commandFor. */
export const SUPPORT_FORM_ID = "support-form";
export const FEATURE_FORM_ID = "feature-request-form";

const CATEGORIES = [
  ["viewer", "3D viewer & display"],
  ["ar", "AR (View in your room)"],
  ["library", "Model library & uploads"],
  ["analytics", "Analytics"],
  ["theme", "Theme & storefront"],
  ["other", "Something else"],
] as const;

const IMPORTANCE = [
  ["nice", "Nice to have"],
  ["important", "Important to my store"],
  ["blocking", "Blocking me from using the app"],
] as const;

const label = (list: readonly (readonly [string, string])[], key: string) =>
  list.find(([k]) => k === key)?.[1] ?? key;

/**
 * The "Support" action in a page header, and the ticket form it opens.
 *
 * Rendered into `s-page`'s `secondary-actions` slot, so it sits in the
 * top-right of every admin page. The form is native Polaris rather than an
 * embedded iframe: an iframe cannot be prefilled from what the app already
 * knows, cannot be validated before it is sent, and renders blank if the ticket
 * host ever refuses to be framed.
 *
 * It posts to /api/support, which forwards to bPlugins' intake. See that route
 * for why the request is made server-side.
 */
export function SupportAction() {
  return (
    <>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        icon="question-circle"
        commandFor={SUPPORT_FORM_ID}
        command="--show"
        accessibilityLabel="Open support ticket form"
      >
        Support
      </s-button>
      <TicketModal kind="support" />
    </>
  );
}

/**
 * The feature-request version of the same form, opened from the dashboard's
 * "Feature requests" row. Same intake and same prefill; its own wording,
 * a category and an importance, so it reads as sharing an idea rather than
 * reporting a problem — and arrives tagged so support can sort it.
 */
export function FeatureRequestModal() {
  return <TicketModal kind="feature" />;
}

function TicketModal({ kind }: { kind: "support" | "feature" }) {
  const feature = kind === "feature";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  // Null until a ticket lands; then the intake's own confirmation, so the
  // merchant gets the reference number they will be quoting back at us.
  const [sent, setSent] = useState<{
    ticketNumber: number | null;
    message: string;
  } | null>(null);
  const shopify = useAppBridge();

  // Two fetchers: one reads the defaults, one posts the ticket. Sharing one
  // would let the loader's response overwrite the submit result and vice versa.
  const prefill = useFetcher<SupportPrefill>();
  const submit = useFetcher<{
    ok: boolean;
    error?: string;
    ticketNumber?: number | null;
    message?: string;
  }>();

  /*
   * The third argument matters: this dialog is opened from elsewhere — the
   * header button and the dashboard's rows target it by id with
   * command/commandFor. Syncing state off the element's own `show` event is
   * what makes the prefill below run in that case too.
   */
  const ref = useOverlay<OverlayElement>(
    open,
    () => setOpen(false),
    () => setOpen(true),
  );
  const sending = submit.state !== "idle";

  // Once the merchant edits a field, nothing prefills over the top of it — the
  // two sources below arrive asynchronously and would otherwise overwrite
  // whatever had been typed in the meantime.
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setTouched(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  /*
   * Prefill on open, not on mount. This component is on every admin page, so
   * loading defaults up front would mean an extra request and a call to
   * shopify.user() on every single page view for a dialog most merchants never
   * open.
   */
  useEffect(() => {
    if (!open) return;
    setSent(null);
    setTouched(false);
    prefill.load("/api/support");

    /*
     * The signed-in staff member, when Shopify will say who that is. It is the
     * better answer than the shop owner — it names the person actually asking —
     * so it overwrites the loader's values rather than only filling blanks.
     * It is also optional, which is why the loader provides a fallback at all.
     */
    shopify.user().then(
      (user) => {
        if (!user?.name && !user?.email) return;
        setForm((f) => ({
          ...f,
          name: user.name || f.name,
          email: user.email || f.email,
        }));
      },
      () => {
        // No user details available; the shop-level prefill stands.
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Shop owner and contact email: only ever fills a blank, so it cannot land on
  // top of what shopify.user() already supplied or what has been typed.
  useEffect(() => {
    const data = prefill.data;
    if (!data || touched) return;
    setForm((f) => ({
      ...f,
      name: f.name || data.name,
      email: f.email || data.email,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.data]);

  useEffect(() => {
    if (submit.state !== "idle" || !submit.data) return;
    if (submit.data.ok) {
      setSent({
        ticketNumber: submit.data.ticketNumber ?? null,
        message: feature
          ? "Your idea is with the team. We read every request and use them to decide what to build next."
          : (submit.data.message ??
            "Your support ticket has been created successfully."),
      });
      setForm(EMPTY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.state, submit.data]);

  function send() {
    const fd = new FormData();
    fd.set("name", form.name);
    fd.set("email", form.email);
    if (feature) {
      // Same intake as support tickets, tagged in the subject and with the
      // category and importance spelled out, so requests can be filtered and
      // weighed without anyone having to ask.
      fd.set("subject", `[Feature request] ${form.subject.trim()}`);
      fd.set(
        "message",
        `${form.message.trim()}\n\nCategory: ${label(CATEGORIES, form.category)}\nImportance: ${label(IMPORTANCE, form.importance)}`,
      );
    } else {
      fd.set("subject", form.subject);
      fd.set("message", form.message);
    }
    submit.submit(fd, { method: "post", action: "/api/support" });
  }

  const error = submit.data && !submit.data.ok ? submit.data.error : null;

  return (
    <s-modal
      ref={ref as never}
      id={feature ? FEATURE_FORM_ID : SUPPORT_FORM_ID}
      heading={feature ? "Request a feature" : "Create support ticket"}
      size="large"
      accessibilityLabel={
        feature ? "Request a feature form" : "Create support ticket form"
      }
    >
      {sent ? (
        <s-banner
          tone="success"
          heading={
            feature
              ? "Thanks for the idea!"
              : sent.ticketNumber
                ? `Ticket #${sent.ticketNumber} created`
                : "Ticket sent"
          }
        >
          <s-paragraph>{sent.message}</s-paragraph>
          <s-paragraph>
            {feature
              ? "If we have questions, or when it ships, we’ll email you at the address you gave."
              : "You’ll get a reply by email at the address you gave."}
          </s-paragraph>
        </s-banner>
      ) : (
        <s-stack direction="block" gap="base">
          {feature ? (
            <s-banner tone="info">
              <s-paragraph>
                Have an idea that would make Easy 3D Viewer better for your
                store? Tell us what you’d like to do and why — the most useful
                requests are the ones that explain the problem behind them.
              </s-paragraph>
            </s-banner>
          ) : null}

          {error ? (
            <s-banner
              tone="critical"
              heading={
                feature
                  ? "Couldn’t send your request"
                  : "Couldn’t send your ticket"
              }
            >
              <s-paragraph>{error}</s-paragraph>
            </s-banner>
          ) : null}

          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 200px), 1fr))"
            gap="base"
          >
            <s-text-field
              label="Name"
              required={flag(true)}
              value={form.name}
              onInput={(e) => set("name", fieldValue(e))}
            />
            <s-email-field
              label="Email"
              required={flag(true)}
              details="Where we’ll reply."
              value={form.email}
              onInput={(e) => set("email", fieldValue(e))}
            />
          </s-grid>

          <s-text-field
            label={feature ? "Feature title" : "Subject"}
            required={flag(true)}
            placeholder={
              feature
                ? "e.g. Add hotspots with notes on the 3D model"
                : "3D model isn’t showing on my product page"
            }
            value={form.subject}
            onInput={(e) => set("subject", fieldValue(e))}
          />

          {feature ? (
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 200px), 1fr))"
              gap="base"
            >
              <s-select
                label="Category"
                value={form.category}
                onInput={(e) => set("category", fieldValue(e))}
              >
                {CATEGORIES.map(([k, v]) => (
                  <s-option key={k} value={k}>
                    {v}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label="How important is it?"
                value={form.importance}
                onInput={(e) => set("importance", fieldValue(e))}
              >
                {IMPORTANCE.map(([k, v]) => (
                  <s-option key={k} value={k}>
                    {v}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          ) : null}

          <s-text-area
            label={feature ? "Describe the feature" : "Message"}
            required={flag(true)}
            rows={6}
            placeholder={
              feature
                ? "What would you like to do, and what problem would it solve for your store or your shoppers?"
                : "Which product or model is affected, what you did, and what happened instead."
            }
            details={
              feature
                ? "Examples, links or how another app does it all help."
                : "The more detail the better — we reply by email."
            }
            value={form.message}
            onInput={(e) => set("message", fieldValue(e))}
          />
        </s-stack>
      )}

      {sent ? (
        <ModalAction
          slot="primary-action"
          variant="primary"
          onClick={() => setOpen(false)}
        >
          Done
        </ModalAction>
      ) : (
        <ModalAction
          slot="primary-action"
          variant="primary"
          loading={sending}
          onClick={send}
        >
          {feature ? "Send request" : "Send ticket"}
        </ModalAction>
      )}
      {!sent ? (
        <ModalAction slot="secondary-actions" onClick={() => setOpen(false)}>
          Cancel
        </ModalAction>
      ) : null}
    </s-modal>
  );
}
