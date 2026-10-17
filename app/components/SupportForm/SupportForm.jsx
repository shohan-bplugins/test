import React, { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  MESSAGE_MIN,
  SUBJECT_MIN,
  validateSupportTicket,
} from "./validateSupportTicket";

// Reusable support ticket form. Name/email start with the merchant's details
// but stay editable. Submits to /app/support-ticket, which forwards the ticket
// to tickets.bplugins.com and sets the product + paid-license flag itself.
export default function SupportForm({
  defaultName = "",
  defaultEmail = "",
  initialSubject = "",
  onSuccess,
}) {
  const fetcher = useFetcher();
  const [values, setValues] = useState({
    name: defaultName,
    email: defaultEmail,
    subject: initialSubject,
    message: "",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [serverError, setServerError] = useState("");
  const isSubmitting = fetcher.state !== "idle";

  // Merchant details can arrive after mount; fill them in only if untouched.
  useEffect(() => {
    setValues((v) => ({
      ...v,
      name: v.name || defaultName,
      email: v.email || defaultEmail,
    }));
  }, [defaultName, defaultEmail]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      setTicket(fetcher.data);
      setServerError("");
      setValues((v) => ({ ...v, subject: "", message: "" }));
      setSubmitted(false);
      setErrors({});
      onSuccess?.(fetcher.data);
    } else {
      if (fetcher.data.errors) setErrors(fetcher.data.errors);
      setServerError(
        fetcher.data.message || "Something went wrong. Please try again.",
      );
    }
  }, [fetcher.state, fetcher.data]);

  const setField = (field) => (e) => {
    const next = { ...values, [field]: e.currentTarget.value };
    setValues(next);
    // After the first submit attempt, re-check as the merchant types.
    if (submitted) setErrors(validateSupportTicket(next));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    setServerError("");
    const found = validateSupportTicket(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    fetcher.submit(
      {
        name: values.name.trim(),
        email: values.email.trim(),
        subject: values.subject.trim(),
        message: values.message.trim(),
      },
      {
        method: "POST",
        action: "/app/support-ticket",
        encType: "application/json",
      },
    );
  };

  if (ticket) {
    return (
      <s-stack gap="base">
        <s-banner
          tone="success"
          heading={`Ticket #${ticket.ticketNumber} created`}
        >
          {ticket.message ||
            "Your support ticket has been created successfully."}{" "}
          Our support team will contact you at{" "}
          <s-text type="strong">{values.email}</s-text>.
        </s-banner>
        <s-stack direction="inline">
          <s-button onClick={() => setTicket(null)}>
            Submit another ticket
          </s-button>
        </s-stack>
      </s-stack>
    );
  }

  return (
    <s-stack gap="base">
      {serverError ? (
        <s-banner tone="critical" heading="Ticket not sent">
          {serverError}
        </s-banner>
      ) : null}

      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))"
        gap="base"
      >
        <s-text-field
          label="Name"
          value={values.name}
          error={errors.name}
          autocomplete="name"
          required
          onInput={setField("name")}
        ></s-text-field>
        <s-email-field
          label="Email"
          value={values.email}
          error={errors.email}
          autocomplete="email"
          details="We'll reply to this address."
          required
          onInput={setField("email")}
        ></s-email-field>
      </s-grid>

      <s-text-field
        label="Subject"
        value={values.subject}
        error={errors.subject}
        details={`At least ${SUBJECT_MIN} characters.`}
        required
        onInput={setField("subject")}
      ></s-text-field>

      <s-text-area
        label="Message"
        value={values.message}
        error={errors.message}
        rows={5}
        details={`At least ${MESSAGE_MIN} characters. Describe the issue and the steps to reproduce it.`}
        required
        onInput={setField("message")}
      ></s-text-area>

      <s-stack direction="inline" justifyContent="end">
        <s-button
          variant="primary"
          icon="email"
          loading={isSubmitting || undefined}
          onClick={handleSubmit}
        >
          Submit ticket
        </s-button>
      </s-stack>
    </s-stack>
  );
}
