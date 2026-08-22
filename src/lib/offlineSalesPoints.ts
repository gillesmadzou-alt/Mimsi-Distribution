import { getPendingJobs } from '@/lib/offlineQueue';
import type { SalesPoint } from '@/lib/supabase';

/**
 * Adds locally queued point-of-sale changes to a server or cache snapshot.
 * Offline-created rows receive their final UUID before being queued, so they
 * can safely be selected in other offline forms and later inserted as-is.
 */
export async function mergePendingSalesPoints(points: SalesPoint[]): Promise<SalesPoint[]> {
  const byId = new Map(points.map((point) => [point.id, point]));
  const jobs = await getPendingJobs();

  for (const job of jobs) {
    for (const step of job.steps) {
      if (step.table !== 'sales_points') continue;

      if (step.operation === 'insert' && !Array.isArray(step.body)) {
        const point = step.body as unknown as SalesPoint;
        if (point.id) byId.set(point.id, point);
      }

      if (step.operation === 'update' && step.filter?.column === 'id' && !Array.isArray(step.body)) {
        const id = String(step.filter.value);
        const existing = byId.get(id);
        if (existing) byId.set(id, { ...existing, ...step.body } as SalesPoint);
      }

      if (step.operation === 'delete' && step.filter?.column === 'id') {
        byId.delete(String(step.filter.value));
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
