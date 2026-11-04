/*
 * Where the bulk upload keeps its files between page loads.
 *
 * IndexedDB rather than localStorage because it stores the File itself — a
 * reload throws away every File object the page had, and without the bytes
 * there is nothing to resume. Every call fails soft: in a browser that blocks
 * storage for the admin's iframe the queue still works, it just doesn't
 * outlive the page.
 */

const DB_NAME = "viewer3d-uploads";
const STORE = "items";

export type StoredUpload = {
  key: string;
  shop: string;
  name: string;
  size: number;
  /** Dropped once the file has landed; nothing left to send. */
  file: Blob | null;
  status: "queued" | "uploading" | "processing" | "done" | "error";
  /** Whether the server should optimise it. Kept so a resumed file honours it. */
  optimize?: boolean;
  /** Set once landed, from the server's answer. */
  originalSize?: number;
  uploadedSize?: number;
  error?: string;
  addedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadUploads(shop: string): Promise<StoredUpload[]> {
  const all = (await run<StoredUpload[]>("readonly", (s) => s.getAll())) ?? [];
  return all
    .filter((u) => u.shop === shop)
    .sort((a, b) => a.addedAt - b.addedAt);
}

export function saveUploads(items: StoredUpload[]): Promise<unknown> {
  return run("readwrite", (s) => {
    for (const item of items) s.put(item);
  });
}

export function deleteUploads(keys: string[]): Promise<unknown> {
  return run("readwrite", (s) => {
    for (const key of keys) s.delete(key);
  });
}
