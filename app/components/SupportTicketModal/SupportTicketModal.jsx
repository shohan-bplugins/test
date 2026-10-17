import { useEffect, useState } from "react";
import { CustomBox, CustomSpan, CustomButton } from "../../utils/polarisWebComponents";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";

const TICKET_ENDPOINT = "/app/api/ticket";

/**
 * Support / feature-request form, raised as an App Bridge modal so the
 * merchant never leaves the app.
 *
 * `product` and `hasPaidLicense` are not collected here — the action at
 * /app/api/ticket fills both in server-side.
 *
 * Show it with `shopify.modal.show(id)`.
 */
export default function SupportTicketModal({
  id = "supportTicketModal",
  heading = "Contact support",
  defaultSubject = "",
}) {
  // Two fetchers: one GETs the store owner's name/email to prefill the form,
  // the other POSTs the ticket. Keeping them separate means a failed submit
  // doesn't discard the prefill.
  const defaultsFetcher = useFetcher();
  const submitFetcher = useFetcher();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (defaultsFetcher.state === "idle" && !defaultsFetcher.data) {
      defaultsFetcher.load(TICKET_ENDPOINT);
    }
  }, [defaultsFetcher]);

  // Prefill from the shop record, but never overwrite something the merchant
  // has already typed.
  useEffect(() => {
    const defaults = defaultsFetcher.data;
    if (!defaults) return;
    setName((current) => current || defaults.name || "");
    setEmail((current) => current || defaults.email || "");
  }, [defaultsFetcher.data]);

  // The two entry points (support vs. feature request) share this component
  // and differ only by the subject they open with.
  useEffect(() => {
    setSubject((current) => current || defaultSubject);
  }, [defaultSubject]);

  const result = submitFetcher.data;
  const submitting = submitFetcher.state !== "idle";
  const created = result?.success === true;

  // Clear the body once a ticket lands, so a second ticket starts from a blank
  // message rather than re-sending the previous one.
  useEffect(() => {
    if (created) setMessage("");
  }, [created]);

  const canSubmit =
    Boolean(name.trim() && email.trim() && subject.trim() && message.trim()) &&
    !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    submitFetcher.submit(
      { name, email, subject, message },
      { method: "POST", action: TICKET_ENDPOINT, encType: "application/json" },
    );
  };

  return (
    <Modal id={id}>
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          {result ? (
            <s-banner tone={created ? "success" : "critical"}>
              {created
                ? `Ticket #${result.ticketNumber} created. ${result.message}`
                : result.message}
            </s-banner>
          ) : null}

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-text-field
              label="Name"
              value={name}
              onInput={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              autocomplete="name"
              required
              disabled={submitting}
            />
            <s-email-field
              label="Email"
              value={email}
              onInput={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autocomplete="email"
              required
              disabled={submitting}
              details="We'll reply to this email address."
            />
          </s-grid>

          <s-text-field
            label="Subject"
            value={subject}
            onInput={(e) => setSubject(e.target.value)}
            placeholder="Short summary of your issue"
            autocomplete="off"
            required
            disabled={submitting}
          />

          <s-text-area
            label="Message"
            value={message}
            onInput={(e) => setMessage(e.target.value)}
            placeholder="Describe what you need help with, and what you've already tried…"
            rows={5}
            required
            disabled={submitting}
            details="Include your store URL or a player name if it helps."
          />
        </s-stack>
      </s-box>

      <TitleBar title={heading}>
        {/* App Bridge's `shopify` global, touched inside a handler only —
            calling useAppBridge() here would throw during SSR. */}
        <CustomButton onClick={() => shopify.modal.hide(id)}>Close</CustomButton>
        <CustomButton variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Sending…" : "Create ticket"}
        </CustomButton>
      </TitleBar>
    </Modal>
  );
}
