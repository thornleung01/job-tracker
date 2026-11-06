// Optional file backup, a progressive enhancement for browsers with the File System Access API (Chromium): the person
// picks one file once, and "Back up now" writes the JSON export into that same file, no download dialog each time.
//
// Everything outside this file talks to the interface below, so the rest of the app never sees a file handle and a test
// can pass a fake. What is kept is the handle, a reference to the file the person chose, in a small IndexedDB database of
// its own (not the account's data, so exports and "Delete all my data" don't carry it) keyed by the account database name.
// The file's contents never go anywhere but that file.
//
// Why it is safe to overwrite:
//  - createWritable() writes to a temporary copy and replaces the file only when close() succeeds, so a failure part-way
//    (the disk is full, the tab closes) leaves the previous backup as it was. The text is built in full before the writer
//    is opened, and the writer is aborted on any error.
//  - A backup never replaces a good file with less, by accident. Two rules, both checked before anything is written:
//      1. Nothing worth saving (no applications, and no learned rules, contact corrections or feedback): nothing is written.
//         An empty export would only destroy the last good backup, for instance after "Delete all my data", when the person
//         chooses the same file again to get set up.
//      2. The file already holds a Job Tracker export with more applications than this backup: nothing is written until the
//         person agrees (replaceLarger). More applications in the file than in the database is how a wrong or small import,
//         or a wiped browser, looks. A file that isn't an export, or can't be read, is not judged: the browser already asked
//         the person before an existing file was picked for overwriting.

import { applicationsInBackup, type BackupContent } from "./content";

/** What this uses of a FileSystemWritableFileStream. */
export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

type PermissionStateLike = "granted" | "denied" | "prompt";

/** What this uses of a FileSystemFileHandle. */
export interface FileHandleLike {
  name: string;
  createWritable(): Promise<WritableLike>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionStateLike>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionStateLike>;
  /** the file as it is now, to see what an earlier backup holds; a handle without it is not read */
  getFile?(): Promise<{ text(): Promise<string> }>;
}

export interface SaveFilePickerOptions {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}

/** Where the handles are kept. The real one is IndexedDB; tests can pass a map. */
export interface HandleStore {
  get(key: string): Promise<FileHandleLike | null>;
  put(key: string, handle: FileHandleLike): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FileBackupDeps {
  /** window.showSaveFilePicker, or undefined when the browser doesn't have it */
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileHandleLike>;
  store: HandleStore;
}

export type BackupWrite =
  /** the file now holds the export */
  | { status: "written"; name: string }
  /** no file has been chosen for this account */
  | { status: "no-file" }
  /** the person didn't allow writing to the file */
  | { status: "permission-denied"; name: string }
  /** the file was moved or deleted, or couldn't be written */
  | { status: "failed"; name: string }
  /** the export couldn't be built, so the file was not touched (the problem is the data, not the file) */
  | { status: "export-failed"; name: string }
  /** there is nothing worth saving, so the file was left as it is */
  | { status: "nothing-to-back-up"; name: string }
  /** the file holds more applications than this backup, so it was left as it is until the person agrees */
  | { status: "would-shrink"; name: string; inFile: number; inBackup: number };

export interface BackupOptions {
  /** the person was told the file holds more applications than this backup, and chose to replace it anyway */
  replaceLarger?: boolean;
}

const DB_NAME = "jobtracker-backup-files";
const STORE_NAME = "handles";

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openHandleDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = make(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** The handles in their own IndexedDB database. */
export const idbHandleStore: HandleStore = {
  async get(key) {
    return ((await run("readonly", (s) => s.get(key))) as FileHandleLike | undefined) ?? null;
  },
  async put(key, handle) {
    await run("readwrite", (s) => s.put(handle, key));
  },
  async delete(key) {
    await run("readwrite", (s) => s.delete(key));
  },
};

export function realFileBackupDeps(): FileBackupDeps {
  const picker = typeof window === "undefined" ? undefined : (window as unknown as { showSaveFilePicker?: FileBackupDeps["showSaveFilePicker"] }).showSaveFilePicker;
  return { showSaveFilePicker: picker?.bind(window), store: idbHandleStore };
}

/** True when this browser can write to a chosen file. Without it the option is not shown. */
export const isFileBackupSupported = (deps: FileBackupDeps = realFileBackupDeps()): boolean => typeof deps.showSaveFilePicker === "function";

/** The name of the file chosen for this account, or null (no file, or the store can't be read). */
export async function backupFileName(dbName: string, deps: FileBackupDeps = realFileBackupDeps()): Promise<string | null> {
  try {
    return (await deps.store.get(dbName))?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Lets the person pick the backup file and remembers it. Returns its name, or null when they cancelled (or the browser
 * has no picker). Needs a click to have just happened.
 */
export async function chooseBackupFile(dbName: string, suggestedName: string, deps: FileBackupDeps = realFileBackupDeps()): Promise<string | null> {
  if (!deps.showSaveFilePicker) return null;
  let handle: FileHandleLike;
  try {
    handle = await deps.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Job Tracker backup", accept: { "application/json": [".json"] } }],
    });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") return null;
    throw e;
  }
  await deps.store.put(dbName, handle);
  return handle.name;
}

/** Stops using the file. The file itself is left where it is. */
export async function forgetBackupFile(dbName: string, deps: FileBackupDeps = realFileBackupDeps()): Promise<void> {
  await deps.store.delete(dbName);
}

/** Write access to the file, asking the person when the browser forgot it (it does after the tab has been closed). Needs a click. */
async function hasWriteAccess(handle: FileHandleLike): Promise<boolean> {
  const mode = { mode: "readwrite" } as const;
  if (!handle.queryPermission && !handle.requestPermission) return true;
  if ((await handle.queryPermission?.(mode)) === "granted") return true;
  return (await handle.requestPermission?.(mode)) === "granted";
}

/** How many applications the file holds now, or null when that can't be told (no getFile, unreadable, or not an export). */
async function applicationsInFile(handle: FileHandleLike): Promise<number | null> {
  try {
    const file = await handle.getFile?.();
    return file ? applicationsInBackup(await file.text()) : null;
  } catch {
    return null;
  }
}

/**
 * Writes the export into the chosen file. `makeContent` runs after write access is confirmed, because the permission
 * question must come straight after the click, and an export of a big database can take a moment. The file is only
 * replaced by a backup that is worth saving and no smaller than what it holds (see the top of this file). Never throws.
 */
export async function backUpToFile(
  dbName: string, makeContent: () => Promise<BackupContent>, deps: FileBackupDeps = realFileBackupDeps(), options: BackupOptions = {},
): Promise<BackupWrite> {
  let handle: FileHandleLike | null;
  try {
    handle = await deps.store.get(dbName);
  } catch {
    return { status: "no-file" };
  }
  if (!handle) return { status: "no-file" };
  const name = handle.name;
  let writer: WritableLike | null = null;
  try {
    if (!(await hasWriteAccess(handle))) return { status: "permission-denied", name };
    let content: BackupContent;
    try {
      content = await makeContent();
    } catch (e) {
      console.error(e);
      return { status: "export-failed", name };
    }
    if (!content.worthSaving) return { status: "nothing-to-back-up", name };
    if (!options.replaceLarger) {
      const inFile = await applicationsInFile(handle);
      if (inFile !== null && inFile > content.applications) return { status: "would-shrink", name, inFile, inBackup: content.applications };
    }
    writer = await handle.createWritable();
    await writer.write(content.text);
    await writer.close();
    return { status: "written", name };
  } catch (e) {
    console.error(e);
    try {
      await writer?.abort?.();
    } catch {
      // the writer is already closed or broken; the old file is untouched either way
    }
    return { status: "failed", name };
  }
}
