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
