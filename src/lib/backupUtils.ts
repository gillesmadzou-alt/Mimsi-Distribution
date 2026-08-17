import { supabase } from '@/lib/supabase';
import { getAllCachedData, cachePageData } from '@/lib/readCache';
import { precacheAllData } from '@/lib/precache';

export const BACKUP_TABLE_COUNT = 34;

const BACKUP_TABLES = [
  'profiles',
  'drivers',
  'sales_points',
  'delivery_batches',
  'batch_sales_points',
  'batch_pot_types',
  'deposits',
  'returns',
  'return_pot_types',
  'receivables',
  'receivable_payments',
  'production_records',
  'stock_movements',
  'stock_handovers',
  'delivery_events',
  'pot_types',
  'suppliers',
  'ingredients',
  'dough_batches',
  'dough_deliveries',
  'field_observations',
  'delivery_expenses',
  'attendance_records',
  'work_schedules',
  'leave_periods',
  'personnel_change_requests',
  'compliance_checks',
  'compliance_discrepancies',
  'compliance_comments',
  'barcodes',
  'qr_codes',
  'app_notifications',
  'audit_logs',
  'driver_locations',
];

export interface BackupPayload {
  exported_at: string;
  tables: string[];
  row_counts: Record<string, number>;
  errors?: string[];
  data: Record<string, unknown[]>;
  cached_data?: Record<string, { data: unknown; ts: number }>;
}

export async function backupAllDataProgress(
  onProgress?: (tablesDone: number) => void,
  onPrecacheProgress?: (done: number, total: number) => void,
): Promise<BackupPayload> {
  const backup: Record<string, unknown[]> = {};
  const errors: string[] = [];

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const table = BACKUP_TABLES[i];
    try {
      const { data, error } = await supabase.from(table).select('*').limit(10000);
      if (error) {
        console.error(`backup read failed for ${table}:`, error);
        errors.push(`${table}: erreur de lecture`);
      } else {
        backup[table] = data ?? [];
      }
    } catch {
      errors.push(`${table}: erreur inattendue`);
    }
    onProgress?.(i + 1);
  }

  await precacheAllData((p) => {
    onPrecacheProgress?.(p.done, p.total);
  });

  const cached_data = await getAllCachedData();

  const payload: BackupPayload = {
    exported_at: new Date().toISOString(),
    tables: Object.keys(backup),
    row_counts: Object.fromEntries(Object.entries(backup).map(([k, v]) => [k, v.length])),
    errors: errors.length > 0 ? errors : undefined,
    data: backup,
    cached_data: Object.keys(cached_data).length > 0 ? cached_data : undefined,
  };

  return payload;
}

export function downloadBackup(payload: BackupPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = payload.exported_at.slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `mimsi-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function backupAllData(): Promise<BackupPayload> {
  const payload = await backupAllDataProgress();
  downloadBackup(payload);
  return payload;
}
