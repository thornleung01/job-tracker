// One place that opens and closes the throwaway databases tests use. Each test file builds a pool and exports its own names
// from it; closing every database a test opened is what keeps one test's data from reaching the next.
import "fake-indexeddb/auto";
import { openDatabase, type JobTrackerDB } from "../../src/db/schema";

export interface DbPool {
  /** A new, empty database with a name no other call has used. */
  open(label?: string): JobTrackerDB;
  /** Closes everything `open` made. */
  closeAll(): void;
}

export function createDbPool(prefix: string): DbPool {
  let counter = 0;
  const opened: JobTrackerDB[] = [];
  return {
    open(label = "") {
      const db = openDatabase(`${prefix}-${Date.now()}-${counter++}${label ? `-${label}` : ""}`);
      opened.push(db);
      return db;
    },
    closeAll() {
      while (opened.length) opened.pop()!.close();
    },
  };
}
