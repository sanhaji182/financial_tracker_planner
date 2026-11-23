const IDB_NAME = 'kb_financial_os_idb';
const IDB_VERSION = 1;
const KV_STORE = 'kv';
const BLOB_STORE = 'blobs';
export const IDB_BLOB_PREFIX = 'idb://';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbGet<T = string>(storeName: string, key: string): Promise<T | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openIdb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IDB write error on restricted WebView environments
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IDB delete error
  }
}

export async function putBlob(id: string, data: string): Promise<void> {
  await idbPut(BLOB_STORE, id, data);
}

export async function getBlob(id: string): Promise<string | null> {
  return idbGet<string>(BLOB_STORE, id);
}

export async function deleteBlob(id: string): Promise<void> {
  await idbDelete(BLOB_STORE, id);
}

export async function resolveBlobValue(val?: string | null): Promise<string> {
  if (!val) return '';
  if (!val.startsWith(IDB_BLOB_PREFIX)) return val;
  const blobKey = val.slice(IDB_BLOB_PREFIX.length);
  const loaded = await getBlob(blobKey);
  return loaded ?? '';
}

export async function mirrorDbSnapshotToIdb(key: string, json: string): Promise<void> {
  await idbPut(KV_STORE, key, json);
}

export async function readMirroredDbSnapshot(key: string): Promise<string | null> {
  return idbGet<string>(KV_STORE, key);
}

export async function clearIndexedDbStorage(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([KV_STORE, BLOB_STORE], 'readwrite');
      tx.objectStore(KV_STORE).clear();
      tx.objectStore(BLOB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore cleanup errors
  }
}
