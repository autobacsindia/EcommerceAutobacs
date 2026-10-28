/**
 * Google Meet links — the one kind of call link chat accepts (the API applies
 * the same rule in chatService.MEET_URL). Pure helpers, no data access, so
 * message rendering can use them without pulling in the chat queries.
 */
export const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[\w=&%.-]*)?$/;

/** The first Google Meet meeting link in some text, or null. A look-alike host never matches. */
export const meetLinkIn = (text: string): string | null =>
  /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[\w=&%.-]*)?(?![\w.-])/.exec(text)?.[0] ?? null;
