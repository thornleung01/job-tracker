// How long the text you type, import or paste may be. One place, so saving, importing and filling the form from a link
// agree: a value that one path accepts can always be saved by the others.

/** What is saved. The local edition cuts at the same lengths (jobtracker/web.py, contacts.py). */
export const MAX_COMPANY_CHARS = 80;
export const MAX_ROLE_CHARS = 100;
export const MAX_NAME_CHARS = 80;
export const MAX_TITLE_CHARS = 100;
export const MAX_LOCATION_CHARS = 80;
export const MAX_NOTE_CHARS = 2000;
/** A posting link; one that is longer is refused (saving) or dropped (importing). */
export const MAX_URL_CHARS = 500;

/** What a guess read from a link, a page or a paste is cut to. Tighter than what is saved, so a guess always saves as it is. */
export const GUESS_COMPANY_CHARS = 60;
export const GUESS_ROLE_CHARS = 90;
export const GUESS_LOCATION_CHARS = MAX_LOCATION_CHARS;

/** The most interview rounds you can set by hand (or the app will count). */
export const MAX_ROUNDS = 20;

/** The most characters read from a pasted job post. */
export const MAX_PASTE_CHARS = 200_000;

// -- the Applications page extras (search, saved views, weekly goal, bulk add) ------------------------------------------

/** A search shorter than this only looks at company and role: it is too short to be worth reading every email for. */
export const SEARCH_MIN_CHARS = 2;
/** The most words of a search that count (more are ignored) and the longest search text read. */
export const SEARCH_MAX_WORDS = 8;
export const SEARCH_MAX_CHARS = 200;

/** Saved views: how many you can keep, and how long a name may be (characters). */
export const SAVED_VIEWS_MAX = 12;
export const SAVED_VIEW_NAME_MAX = 40;

/** The weekly goal is a whole number of applications from 1 to this. */
export const WEEKLY_GOAL_MAX = 50;

/** The most links "Add several links" takes at once. */
export const BULK_ADD_MAX = 10;

/** Search reads this much of an email's subject (the body up to BODY_LIMIT, a note up to MAX_NOTE_CHARS): enough to find what you typed. */
export const SUBJECT_READ_CHARS = 500;

// -- the calendar file and the follow-up draft: text that leaves the app is cut to these lengths -------------------------

/** A stage named in a calendar entry, and the link back to an application. */
export const MAX_STAGE_CHARS = 40;
export const MAX_LINK_CHARS = 300;
/** A compose link's recipient (the standard limit for an address) and subject. */
export const MAX_ADDRESS_CHARS = 254;
export const MAX_SUBJECT_CHARS = 250;

// -- resumes, cover letters and job posting text --------------------------------------------------------------------------

/** The job posting's text kept on an application. */
export const MAX_POSTING_CHARS = 20_000;
/** A document's title, a section heading, one line of it, and how many sections and lines it may have. */
export const MAX_DOC_TITLE_CHARS = 100;
export const MAX_DOC_HEADING_CHARS = 80;
export const MAX_DOC_ITEM_CHARS = 1000;
export const MAX_DOC_SECTIONS = 30;
export const MAX_DOC_ITEMS = 60;
/** The bold lead-in of a bullet or skill, and the right-hand text of a job or school line (a location, or dates). */
export const MAX_DOC_LABEL_CHARS = 60;
export const MAX_DOC_RIGHT_CHARS = 80;
/** The most resume versions you can keep besides the master. */
export const MAX_RESUME_VERSIONS = 5;

/** Days a deleted application, resume or cover letter waits in Recently deleted before it is erased for good. */
export const TRASH_DAYS = 30;

// -- AI: text sent to and read back from the model (the person's own key, called from the browser) -----------------------------

/** The most characters of a resume's text that Convert will send. A longer one is refused with a plain message, not cut. */
export const MAX_AI_INPUT_CHARS = 120_000;
/**
 * The most characters of a resume's text that Convert will send. Its reply is the whole resume again as JSON, and the reply budget
 * (8,000 tokens, roughly 25,000 characters of JSON) can't carry more than this, so a longer text would be billed and then cut off.
 */
export const MAX_CONVERT_CHARS = 20_000;
/** The most characters of a reply that are read. A longer one is treated as cut off. */
export const MAX_AI_OUTPUT_CHARS = 60_000;
/** The most characters of the person's own note ("stress my reporting work") that Tailor sends. */
export const MAX_TAILOR_NOTE_CHARS = 500;
