// Runs before every test file. Web storage lives as long as the file, so without this a value one test wrote (the last
// provider hint, a flag) would be there for the next, and the result would depend on the order the tests run in.
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
});
