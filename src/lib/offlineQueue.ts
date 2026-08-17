import { supabase } from './supabase';

export interface QueueStep {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete' | 'rpc';
  body: Record<string, unknown> | Record<string, unknown>[];
  filter?: { column: string; value: unknown };
  dependsOn?: string;
  injectField?: string;
  selectSingle?: boolean;
}

export interface QueuedJob {
  id: string;
  label: string;
  page: string;
  steps: QueueStep[];
  createdAt: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  error?: string;
}

const DB_NAME = 'offline_queue_db';
const STORE = 'jobs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function enqueueJob(label: string, page: string, steps: QueueStep[]): Promise<string> {
  const job: QueuedJob = {
    id: genId(),
    label,
    page,
    steps,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return job.id;
}

export async function getPendingJobs(): Promise<QueuedJob[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const jobs = (req.result as QueuedJob[]).filter((j) => j.status === 'pending' || j.status === 'failed');
      resolve(jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function countPendingJobs(): Promise<number> {
  const jobs = await getPendingJobs();
  return jobs.length;
}

export async function updateJob(job: QueuedJob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteJob(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function executeStep(step: QueueStep, results: Map<string, unknown>): Promise<unknown> {
  let body = step.body;
  if (step.dependsOn && step.injectField) {
    const parentResult = results.get(step.dependsOn) as Record<string, unknown> | undefined;
    const injectedId = parentResult?.id;
    if (!injectedId) throw new Error(`Dependency ${step.dependsOn} did not return an id`);
    if (Array.isArray(body)) {
      body = body.map((row) => ({ ...row, [step.injectField!]: injectedId }));
    } else {
      body = { ...body, [step.injectField!]: injectedId };
    }
  }

  let query = supabase.from(step.table);
  let data: unknown;
  let error: unknown;

  if (step.operation === 'insert') {
    const res = step.selectSingle
      ? await (query as any).insert(body).select().single()
      : await (query as any).insert(body);
    data = res.data; error = res.error;
  } else if (step.operation === 'update') {
    if (!step.filter) throw new Error(`Update step ${step.id} is missing filter`);
    const res = await (query as any).update(body).eq(step.filter.column, step.filter.value);
    data = res.data; error = res.error;
  } else if (step.operation === 'rpc') {
    const res = await supabase.rpc(step.table, body as Record<string, unknown>);
    data = res.data; error = res.error;
  } else {
    if (!step.filter) throw new Error(`Delete step ${step.id} is missing filter`);
    const res = await (query as any).delete().eq(step.filter.column, step.filter.value);
    data = res.data; error = res.error;
  }

  if (error) throw error;
  return data;
}

export async function processJob(job: QueuedJob): Promise<void> {
  job.status = 'syncing';
  job.error = undefined;
  await updateJob(job);

  try {
    const results = new Map<string, unknown>();
    for (const step of job.steps) {
      const result = await executeStep(step, results);
      if (step.selectSingle) {
        results.set(step.id, result);
      }
    }
    await deleteJob(job.id);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    await updateJob(job);
    throw err;
  }
}

const inFlightJobIds = new Set<string>();

export async function processAllPending(): Promise<{ processed: number; failed: number }> {
  const jobs = await getPendingJobs();
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    if (inFlightJobIds.has(job.id)) continue;
    inFlightJobIds.add(job.id);
    try {
      await processJob(job);
      processed++;
    } catch {
      failed++;
    } finally {
      inFlightJobIds.delete(job.id);
    }
  }
  return { processed, failed };
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function buildSteps(): StepBuilder {
  return new StepBuilder();
}

class StepBuilder {
  private steps: QueueStep[] = [];

  insert(table: string, body: Record<string, unknown> | Record<string, unknown>[], opts?: { id?: string; dependsOn?: string; injectField?: string; selectSingle?: boolean }): this {
    const id = opts?.id ?? genId();
    this.steps.push({
      id,
      table,
      operation: 'insert',
      body,
      dependsOn: opts?.dependsOn,
      injectField: opts?.injectField,
      selectSingle: opts?.selectSingle ?? false,
    });
    return this;
  }

  insertSingle(table: string, body: Record<string, unknown>, opts?: { id?: string; dependsOn?: string; injectField?: string }): this {
    return this.insert(table, body, { ...opts, selectSingle: true });
  }

  update(table: string, body: Record<string, unknown>, filter: { column: string; value: unknown }): this {
    this.steps.push({
      id: genId(),
      table,
      operation: 'update',
      body,
      filter,
    });
    return this;
  }

  rpc(fn: string, args: Record<string, unknown>): this {
    this.steps.push({
      id: genId(),
      table: fn,
      operation: 'rpc',
      body: args,
    });
    return this;
  }

  delete(table: string, filter: { column: string; value: unknown }): this {
    this.steps.push({
      id: genId(),
      table,
      operation: 'delete',
      filter,
    });
    return this;
  }

  getSteps(): QueueStep[] {
    return [...this.steps];
  }
}
