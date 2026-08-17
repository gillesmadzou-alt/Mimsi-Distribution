const DB_NAME = 'read_cache_db';
const STORE = 'page_data';
const DB_VERSION = 1;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cachePageData<T>(page: string, data: T): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ data, ts: Date.now() }, page);
    await tx.done;
  } catch {}
}

export async function getCachedPageData<T>(page: string): Promise<{ data: T; ts: number } | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const result = await tx.objectStore(STORE).get(page);
    const entry = result as { data: T; ts: number } | undefined;
    if (!entry) return null;
    if (Date.now() - entry.ts > MAX_CACHE_AGE_MS) {
      try {
        const delTx = db.transaction(STORE, 'readwrite');
        delTx.objectStore(STORE).delete(page);
        await delTx.done;
      } catch {}
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function getAllCachedData(): Promise<Record<string, { data: unknown; ts: number }>> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keys = await store.getAllKeys();
    const results: Record<string, { data: unknown; ts: number }> = {};
    for (const key of keys) {
      const entry = (await store.get(key)) as { data: unknown; ts: number } | undefined;
      if (entry) results[String(key)] = entry;
    }
    return results;
  } catch {
    return {};
  }
}

export async function clearPageCache(page?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    if (page) {
      tx.objectStore(STORE).delete(page);
    } else {
      tx.objectStore(STORE).clear();
    }
    await tx.done;
  } catch {}
}
