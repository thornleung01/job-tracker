// The email classification pipeline, ported from the Python jobtracker package.
export * from "./classify";
export * from "./extract";
export * from "./mailtext";
export * from "./links";
export * from "./match";
export { loadRules, compileRules, rulesVersion, hashText, type Rules } from "./rules";
