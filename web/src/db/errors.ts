// The two kinds of error the UI shows to a person. ActionError carries its own sentence (a request the app refuses);
// MissingRecordError means the thing is gone, and the UI words that itself. Anything else is an unexpected failure.

/** A request the app refuses, with a sentence that is safe to show. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/** The application (or email, or rule) does not exist. Not named NotFoundError: Dexie wraps errors with that name. */
export class MissingRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingRecordError";
  }
}
