export const SUBJECT_MIN = 5;
export const MESSAGE_MIN = 10;
// Upper bounds keep oversized payloads out of the ticket system.
export const NAME_MAX = 200;
export const EMAIL_MAX = 254;
export const SUBJECT_MAX = 300;
export const MESSAGE_MAX = 20000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared by the SupportForm (instant feedback) and the support-ticket action
// (never trust the client). Returns { field: message } for invalid fields.
export function validateSupportTicket({ name, email, subject, message }) {
  const errors = {};
  if (!name?.trim()) errors.name = "Name is required.";
  else if (name.trim().length > NAME_MAX)
    errors.name = `Name must be at most ${NAME_MAX} characters.`;
  if (!email?.trim()) errors.email = "Email is required.";
  else if (email.trim().length > EMAIL_MAX)
    errors.email = "Enter a valid email address.";
  else if (!EMAIL_RE.test(email.trim()))
    errors.email = "Enter a valid email address.";
  if ((subject?.trim().length || 0) < SUBJECT_MIN)
    errors.subject = `Subject must be at least ${SUBJECT_MIN} characters.`;
  else if (subject.trim().length > SUBJECT_MAX)
    errors.subject = `Subject must be at most ${SUBJECT_MAX} characters.`;
  if ((message?.trim().length || 0) < MESSAGE_MIN)
    errors.message = `Message must be at least ${MESSAGE_MIN} characters.`;
  else if (message.trim().length > MESSAGE_MAX)
    errors.message = `Message must be at most ${MESSAGE_MAX} characters.`;
  return errors;
}
