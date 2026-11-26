/**
 * Team chat text limits — one place for the route validators and the service.
 * A message over the cap is refused with a clear message, never cut short.
 * Must equal Front-end/web/src/components/chat/chatLimits.ts.
 */
export const MESSAGE_MAX_LENGTH = 20000;
export const SPACE_DESCRIPTION_MAX = 1000;

export const messageTooLong = () =>
  `Message is too long (max ${MESSAGE_MAX_LENGTH.toLocaleString('en-IN')} characters) — please split it into two.`;
