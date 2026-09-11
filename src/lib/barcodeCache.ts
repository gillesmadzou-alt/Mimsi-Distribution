import Dexie, { type Table } from 'dexie';
import { Barcode } from './supabase';

// Migré vers Dexie.js (même base `barcode_cache_db`, même store
// `available_barcodes` avec keyPath `id`, même version 1 — aucune donnée
// déjà en cache n'est perdue).
class BarcodeCacheDB extends Dexie {
  available_barcodes!: Table<Barcode, string>;

  constructor() {
    super('barcode_cache_db');
    this.version(1).stores({ available_barcodes: 'id' });
  }
}

const db = new BarcodeCacheDB();

export async function cacheBarcodes(barcodes: Barcode[]): Promise<void> {
  await db.transaction('rw', db.available_barcodes, async () => {
    await db.available_barcodes.clear();
    await db.available_barcodes.bulkPut(barcodes);
  });
}

export async function getCachedBarcodes(): Promise<Barcode[]> {
  return db.available_barcodes.toArray();
}

export async function addCachedBarcode(barcode: Barcode): Promise<void> {
  await db.available_barcodes.put(barcode);
}

export async function removeCachedBarcode(id: string): Promise<void> {
  await db.available_barcodes.delete(id);
}

export async function clearCachedBarcodes(): Promise<void> {
  await db.available_barcodes.clear();
}
