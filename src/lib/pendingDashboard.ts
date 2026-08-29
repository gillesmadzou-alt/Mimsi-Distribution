import { getPendingJobs } from '@/lib/offlineQueue';

type CachedDashboard = {
  deposits?: any[];
  returns?: any[];
  receivables?: any[];
  productionRecords?: any[];
  doughDeliveries?: any[];
  stockMovements?: any[];
};

const rows = (body: unknown): Record<string, unknown>[] =>
  Array.isArray(body) ? body as Record<string, unknown>[] : [body as Record<string, unknown>];

/** Applies unsynchronised local operations to a dashboard snapshot. */
export async function includePendingDashboardOperations<T extends CachedDashboard>(snapshot: T): Promise<T> {
  const pending = await getPendingJobs();
  if (!pending.length) return snapshot;

  const data: CachedDashboard = {
    ...snapshot,
    deposits: [...(snapshot.deposits ?? [])],
    returns: [...(snapshot.returns ?? [])],
    receivables: [...(snapshot.receivables ?? [])],
    productionRecords: [...(snapshot.productionRecords ?? [])],
    doughDeliveries: [...(snapshot.doughDeliveries ?? [])],
    stockMovements: [...(snapshot.stockMovements ?? [])],
  };

  for (const job of pending) {
    for (const step of job.steps) {
      if (step.operation !== 'insert') continue;
      for (const body of rows(step.body)) {
        const local = { ...body, id: `local-${job.id}-${step.id}`, created_at: job.createdAt };
        if (step.table === 'deposits') {
          data.deposits!.push({ ...local, deposited_at: body.deposited_at ?? job.createdAt });
        } else if (step.table === 'returns') {
          data.returns!.push({ ...local, returned_at: body.returned_at ?? job.createdAt });
        } else if (step.table === 'receivables') {
          data.receivables!.push(local);
        } else if (step.table === 'receivable_payments') {
          const receivable = data.receivables!.find((item) => item.id === body.receivable_id);
          if (receivable) receivable.amount_paid = Number(receivable.amount_paid ?? 0) + Number(body.amount_fcfa ?? body.amount ?? 0);
        } else if (step.table === 'production_records') {
          data.productionRecords!.push({ ...local, production_date: body.production_date ?? job.createdAt.slice(0, 10) });
        } else if (step.table === 'dough_deliveries') {
          data.doughDeliveries!.push({ ...local, delivery_date: body.delivery_date ?? job.createdAt.slice(0, 10) });
        } else if (step.table === 'stock_movements') {
          data.stockMovements!.push(local);
        }
      }
    }
  }

  return data as T;
}
