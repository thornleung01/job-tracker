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
