/**
 * How long staff may write in the Tasks and Projects boxes (task notes,
 * comments, project description, project updates, the long fields of a
 * project's Details).
 *
 * There is no limit people should meet in normal use — a job's notes can run
 * to pages. This is only a safety cap, so one accidental paste (a whole
 * spreadsheet, a log file) can't bloat the database or slow every page that
 * reads the row. 20,000 characters is about eight typed pages.
 *
 * Formatted (HTML) text may carry up to RICH_TEXT_MARKUP_FACTOR times that in
 * markup (utils/richText.js); the schemas size their own `maxlength` for it.
 */
export const STAFF_LONG_TEXT_MAX = 20000;

/** The one message shown when the cap is hit. */
export const longTextTooLong = (what) =>
  `${what} is too long (over ${STAFF_LONG_TEXT_MAX.toLocaleString('en-IN')} characters) — please split it into two.`;
