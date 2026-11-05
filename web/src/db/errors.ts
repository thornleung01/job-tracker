/** A request the app refuses, with a sentence that is safe to show. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
