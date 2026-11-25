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

/**
 * Staff notes and reasons outside Tasks/Projects — lead follow-up notes, a Meta
 * lead's "why late" / question / answer, a leaver's reason, written training
 * answers. 5,000 characters is about two typed pages: far more than anyone
 * writes in a note, still a firm cap against an accidental huge paste.
 * Mirrored by STAFF_NOTE_MAX in Front-end/web/src/lib/textLimit.ts.
 */
export const STAFF_NOTE_MAX = 5000;

/** The one message shown when the cap is hit. */
export const longTextTooLong = (what) =>
  `${what} is too long (over ${STAFF_LONG_TEXT_MAX.toLocaleString('en-IN')} characters) — please split it into two.`;
