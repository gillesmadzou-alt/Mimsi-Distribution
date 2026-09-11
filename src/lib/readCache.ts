import Dexie, { type Table } from 'dexie';

// Migré vers Dexie.js (même base IndexedDB `read_cache_db`, même store
// `page_data`, même version 1 — les données déjà en cache chez les
// utilisateurs restent lisibles, rien à migrer). Dexie remplace le
// boilerplate IndexedDB fait main par une API basée sur des promesses, avec
// une gestion d'erreurs (quota dépassé, base bloquée...) plus robuste que
// les callbacks onsuccess/onerror répétés dans chaque fonction.
interface PageDataRow {
  data: unknown;
  ts: number;
}

class ReadCacheDB extends Dexie {
  page_data!: Table<PageDataRow, string>;

  constructor() {
    super('read_cache_db');
    // Store sans keyPath (clé hors-ligne, comme l'ancien
    // `db.createObjectStore(STORE)` sans options) : la clé passe en second
    // argument de `put`/`get`, pas dans l'objet lui-même.
    this.version(1).stores({ page_data: '' });
  }
}

const db = new ReadCacheDB();

// Le mode hors-ligne complet garde la copie locale 30 jours. Se déconnecter
// la vide (voir AuthContext).
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function cachePageData<T>(page: string, data: T): Promise<void> {
  try {
    await db.page_data.put({ data, ts: Date.now() }, page);
  } catch {
    // Quota dépassé ou stockage indisponible — le cache est un
    // best-effort, jamais bloquant pour l'utilisateur.
  }
}

export async function getCachedPageData<T>(page: string): Promise<{ data: T; ts: number } | null> {
  try {
    const entry = await db.page_data.get(page);
    if (!entry) return null;
    if (Date.now() - entry.ts > MAX_CACHE_AGE_MS) {
      try {
        await db.page_data.delete(page);
      } catch {}
      return null;
    }
    return entry as { data: T; ts: number };
  } catch {
    return null;
  }
}

export async function getAllCachedData(): Promise<Record<string, { data: unknown; ts: number }>> {
  try {
    const keys = await db.page_data.toCollection().keys();
    const results: Record<string, { data: unknown; ts: number }> = {};
    for (const key of keys) {
      const entry = await db.page_data.get(String(key));
      if (entry) results[String(key)] = entry;
    }
    return results;
  } catch {
    return {};
  }
}

export async function clearPageCache(page?: string): Promise<void> {
  try {
    if (page) {
      await db.page_data.delete(page);
    } else {
      await db.page_data.clear();
    }
  } catch {}
}
