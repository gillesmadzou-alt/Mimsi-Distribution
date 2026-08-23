import { supabase } from '@/lib/supabase';
import { cachePageData, getCachedPageData, getAllCachedData } from '@/lib/readCache';

const PRECACHE_KEY = 'mimsi_precache_done';
const PRECACHE_VERSION = 'v28';

interface PrecacheProgress {
  done: number;
  total: number;
}

type ProgressCallback = (progress: PrecacheProgress) => void;

async function fetchAndCache<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  try {
    const data = await fetcher();
    await cachePageData(key, data);
  } catch {
    // skip failed pages
  }
}

export async function precacheAllData(onProgress?: ProgressCallback, userProfile?: { id: string; role: number }): Promise<void> {
  const tasks: { key: string; fn: () => Promise<unknown> }[] = [
    {
      key: 'dashboard',
      fn: async () => {
        const [drivers, bakers, kneaders, batches, deposits, returns, pots, salesPoints, receivables, batchPotTypes, returnPotTypes, production, dough, expenses, stockMovements, consignments] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }),
          supabase.from('deposits').select('id, quantity, amount_fcfa, batch_id, deposited_at, sales_point:sales_points(*)'),
          supabase.from('returns').select('id, quantity, batch_id, empty_pots, empty_lids, returned_at, sales_point:sales_points(*)'),
          supabase.from('pot_types').select('*').eq('is_active', true),
          supabase.from('sales_points').select('id, quota_amount, quota_paid, quota_status, driver_id, name, zone'),
          supabase.from('receivables').select('id, amount_fcfa, amount_paid, status, driver_id, batch_id, sales_point:sales_points(*)'),
          supabase.from('batch_pot_types').select('batch_id, empty_pots, empty_lids, quantity'),
          supabase.from('return_pot_types').select('return_id, pot_type_id, quantity, empty_pots, empty_lids, madeleine_count'),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*), dough_delivery:dough_deliveries(*, kneader:kneaders(*))').order('production_date', { ascending: false }).limit(500),
          supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)').order('delivery_date', { ascending: false }).limit(500),
          supabase.from('delivery_expenses').select('id, amount_fcfa, expense_type, batch_id, deposit_id'),
          supabase.from('stock_movements').select('id, movement_type, quantity, pot_type_id, batch_id, created_at').order('created_at', { ascending: false }).limit(200),
          supabase.from('consignments').select('id, batch_id, quantity_deposited, quantity_returned, sales_point:sales_points(*)'),
        ]);
        return {
          drivers: drivers.data ?? [], bakers: bakers.data ?? [], kneaders: kneaders.data ?? [],
          batches: batches.data ?? [], deposits: deposits.data ?? [], returns: returns.data ?? [],
          batchPotTypes: batchPotTypes.data ?? [], returnPotTypes: returnPotTypes.data ?? [],
          pots: pots.data ?? [], salesPoints: salesPoints.data ?? [], receivables: receivables.data ?? [],
          productionRecords: production.data ?? [], doughDeliveries: dough.data ?? [],
          deliveryExpenses: expenses.data ?? [], stockMovements: stockMovements.data ?? [], consignments: consignments.data ?? [],
        };
      },
    },
    {
      key: 'dashboard_current_driver',
      fn: async () => {
        if (!userProfile || userProfile.role !== 1) return null;
        const { data: driver } = await supabase.from('drivers').select('id').eq('user_id', userProfile.id).maybeSingle();
        if (!driver) return null;
        const driverId = driver.id;
        await fetchAndCache(`dashboard_${userProfile.id}`, async () => {
          const [batches, deposits, returns, salesPoints, receivables, batchPotTypes, returnPotTypes, expenses, stockMovements, consignments] = await Promise.all([
            supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').eq('driver_id', driverId).order('created_at', { ascending: false }),
            supabase.from('deposits').select('id, quantity, amount_fcfa, batch_id, deposited_at, sales_point:sales_points(*)'),
            supabase.from('returns').select('id, quantity, batch_id, empty_pots, empty_lids, returned_at, sales_point:sales_points(*)'),
            supabase.from('sales_points').select('id, quota_amount, quota_paid, quota_status, driver_id, name, zone').eq('driver_id', driverId),
            supabase.from('receivables').select('id, amount_fcfa, amount_paid, status, driver_id, batch_id, sales_point:sales_points(*)').eq('driver_id', driverId),
            supabase.from('batch_pot_types').select('batch_id, empty_pots, empty_lids, quantity'),
            supabase.from('return_pot_types').select('return_id, pot_type_id, quantity, empty_pots, empty_lids, madeleine_count'),
            supabase.from('delivery_expenses').select('id, amount_fcfa, expense_type, batch_id, deposit_id'),
            supabase.from('stock_movements').select('id, movement_type, quantity, pot_type_id, batch_id, created_at').order('created_at', { ascending: false }).limit(200),
            supabase.from('consignments').select('id, batch_id, quantity_deposited, quantity_returned, sales_point:sales_points(*)'),
          ]);
          const batchIds = new Set((batches.data ?? []).map((b) => b.id));
          return {
            drivers: [], bakers: [], kneaders: [],
            batches: batches.data ?? [],
            deposits: (deposits.data ?? []).filter((d) => batchIds.has(d.batch_id)),
            returns: (returns.data ?? []).filter((r) => batchIds.has(r.batch_id)),
            batchPotTypes: (batchPotTypes.data ?? []).filter((bpt) => batchIds.has(bpt.batch_id)),
            returnPotTypes: returnPotTypes.data ?? [],
            pots: [], salesPoints: salesPoints.data ?? [], receivables: receivables.data ?? [],
            productionRecords: [], doughDeliveries: [],
            deliveryExpenses: (expenses.data ?? []).filter((e) => e.batch_id && batchIds.has(e.batch_id)),
            stockMovements: (stockMovements.data ?? []).filter((movement) => movement.batch_id && batchIds.has(movement.batch_id)),
            consignments: (consignments.data ?? []).filter((consignment) => consignment.batch_id && batchIds.has(consignment.batch_id)),
          };
        });
        return null;
      },
    },
    {
      key: `statistics-page:${userProfile?.id ?? 'anonymous'}`,
      fn: async () => {
        const [drivers, kneaders, bakers, batches, deposits, returns, receivables, prod, dough] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }),
          supabase.from('deposits').select('id, quantity, amount_fcfa, batch_id, deposited_at'),
          supabase.from('returns').select('id, quantity, batch_id, returned_at, madeleine_count'),
          supabase.from('receivables').select('id, amount_fcfa, amount_paid, status, driver_id'),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }).limit(500),
          supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)').order('delivery_date', { ascending: false }).limit(500),
        ]);
        const firstError = [drivers, kneaders, bakers, batches, deposits, returns, receivables, prod, dough]
          .map((response) => response.error)
          .find(Boolean);
        if (firstError) throw firstError;
        return {
          drivers: drivers.data ?? [], kneaders: kneaders.data ?? [], bakers: bakers.data ?? [],
          batches: batches.data ?? [], deposits: deposits.data ?? [], returns: returns.data ?? [],
          receivables: receivables.data ?? [], productionRecords: prod.data ?? [], doughDeliveries: dough.data ?? [],
        };
      },
    },
    {
      key: 'stock:personnel',
      fn: async () => {
        const [dRes, bRes] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
        ]);
        return { drivers: dRes.data ?? [], bakers: bRes.data ?? [] };
      },
    },
    {
      key: 'analytics-page',
      fn: async () => {
        const [drivers, bakers, kneaders, batches, deposits, returns, receivables, prod, dough, doughBatches, expenses, oppSales, weddingOrders] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }).limit(1000),
          supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('deposited_at', { ascending: false }).limit(2000),
          supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('returned_at', { ascending: false }).limit(2000),
          supabase.from('receivables').select('*, sales_point:sales_points(*), driver:drivers(*)').order('created_at', { ascending: false }).limit(1000),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }).limit(1000),
          supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)').order('delivery_date', { ascending: false }).limit(1000),
          supabase.from('dough_batches').select('*, kneader:kneaders(*)').order('batch_date', { ascending: false }).limit(500),
          supabase.from('delivery_expenses').select('*').order('expense_date', { ascending: false }).limit(2000),
          supabase.from('opportunistic_sales').select('*, driver:drivers(*), pot_type:pot_types(*)').order('sale_date', { ascending: false }).limit(2000),
          supabase.from('wedding_orders').select('*, driver:drivers(*), pot_type:pot_types(*)').order('order_date', { ascending: false }).limit(1000),
        ]);
        return {
          drivers: drivers.data ?? [], bakers: bakers.data ?? [], kneaders: kneaders.data ?? [],
          batches: batches.data ?? [], deposits: deposits.data ?? [], returns: returns.data ?? [],
          receivables: receivables.data ?? [], productionRecords: prod.data ?? [],
          doughDeliveries: dough.data ?? [], doughBatches: doughBatches.data ?? [],
          expenses: expenses.data ?? [], oppSales: oppSales.data ?? [], weddingOrders: weddingOrders.data ?? [],
        };
      },
    },
    {
      key: 'attendance_people',
      fn: async () => {
        const [profiles, drivers, bakers, kneaders] = await Promise.all([
          supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true),
          supabase.from('drivers').select('id, full_name, status'),
          supabase.from('bakers').select('id, full_name, status'),
          supabase.from('kneaders').select('id, full_name, status'),
        ]);
        const people = [
          ...(profiles.data ?? []).map((person) => ({ id: person.id, full_name: person.full_name, role: person.role, type: 'profile', status: person.is_active ? 'actif' : 'inactif' })),
          ...(drivers.data ?? []).filter((person) => person.status === 'actif').map((person) => ({ id: person.id, full_name: person.full_name, role: 1, type: 'driver', status: person.status })),
          ...(bakers.data ?? []).filter((person) => person.status === 'actif').map((person) => ({ id: person.id, full_name: person.full_name, role: 9, type: 'baker', status: person.status })),
          ...(kneaders.data ?? []).filter((person) => person.status === 'actif').map((person) => ({ id: person.id, full_name: person.full_name, role: 8, type: 'kneader', status: person.status })),
        ];
        return people.sort((a, b) => a.full_name.localeCompare(b.full_name));
      },
    },
    {
      key: 'drivers-page',
      fn: async () => {
        const [drivers, pending] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').eq('entity_type', 'driver').eq('status', 'en_attente').order('created_at', { ascending: false }),
        ]);
        return { drivers: drivers.data ?? [], pending: pending.data ?? [] };
      },
    },
    {
      key: 'receivables',
      fn: async () => {
        const { data } = await supabase
          .from('receivables')
          .select('*, sales_point:sales_points(*), driver:drivers(*), batch:delivery_batches(*)')
          .order('created_at', { ascending: false });
        return data ?? [];
      },
    },
    {
      key: 'receivables:filters',
      fn: async () => {
        const [drivers, salesPoints] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('sales_points').select('*').order('name'),
        ]);
        return { drivers: drivers.data ?? [], salesPoints: salesPoints.data ?? [] };
      },
    },
    {
      key: 'leave-page',
      fn: async () => {
        const [leaves, drivers, profiles] = await Promise.all([
          supabase.from('leave_periods').select('*, driver:drivers!leave_periods_driver_id_fkey(*), profile:profiles!leave_periods_profile_id_fkey(*), notified_profile:profiles!leave_periods_notified_to_fkey(*)').order('start_date', { ascending: false }),
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('profiles').select('*').order('full_name'),
        ]);
        return { leaves: leaves.data ?? [], drivers: drivers.data ?? [], profiles: profiles.data ?? [] };
      },
    },
    {
      key: 'stock:pot_types',
      fn: async () => {
        const [pots, movements, handovers] = await Promise.all([
          supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
          supabase.from('stock_movements').select('*, pot_type:pot_types(*)').order('created_at', { ascending: false }).limit(200),
          supabase.from('stock_handovers').select('*, pot_type:pot_types(*), driver:drivers(*), batch:delivery_batches(*)').order('handover_date', { ascending: false }).limit(200),
        ]);
        return pots.data ?? [];
      },
    },
    {
      key: 'ingredients',
      fn: async () => {
        const [ingredients, batches, kneaders, suppliers] = await Promise.all([
          supabase.from('ingredients').select('*').order('name'),
          supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*)), deliveries:dough_deliveries(*, baker:bakers(*))').order('batch_date', { ascending: false }).limit(100),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('suppliers').select('*').order('last_name'),
        ]);
        return {
          ingredients: ingredients.data ?? [], batches: batches.data ?? [],
          kneaders: kneaders.data ?? [], suppliers: suppliers.data ?? [],
        };
      },
    },
    {
      key: 'sales_points_page',
      fn: async () => {
        const { data } = await supabase.from('sales_points').select('*').order('name');
        return data ?? [];
      },
    },
    {
      key: 'sales_points_drivers',
      fn: async () => {
        const { data } = await supabase.from('drivers').select('id, full_name, zone').order('full_name');
        return data ?? [];
      },
    },
    {
      key: 'returns-page-all:v2',
      fn: async () => {
        const [returns, batches, salesPoints, drivers, potTypes, bakers, consignments] = await Promise.all([
          supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*), return_pot_types(*), consignment:consignments(*, sales_point:sales_points(*), pot_type:pot_types(*), production_record:production_records(*, baker:bakers(*)), driver:drivers(*), batch:delivery_batches(*, driver:drivers(*))), pot_type:pot_types(*), production_record:production_records(*, baker:bakers(*)), driver:drivers(*)').order('returned_at', { ascending: false }),
          supabase.from('delivery_batches').select('*, pot_type:pot_types(*)').in('status', ['actif', 'cloture']).order('created_at', { ascending: false }),
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
          supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
          supabase.from('consignments').select('*, sales_point:sales_points(*), pot_type:pot_types(*), production_record:production_records(*, baker:bakers(*)), driver:drivers(*), batch:delivery_batches(*, driver:drivers(*))').order('deposited_at', { ascending: false }),
        ]);
        return {
          returns: returns.data ?? [], batches: batches.data ?? [], salesPoints: salesPoints.data ?? [],
          drivers: drivers.data ?? [], potTypes: potTypes.data ?? [], bakers: bakers.data ?? [], consignments: consignments.data ?? [],
        };
      },
    },
    {
      key: 'expenses_page',
      fn: async () => {
        const [expenses, salesPoints] = await Promise.all([
          supabase.from('delivery_expenses')
            .select('*, sales_point:sales_points(*), driver:drivers(*), batch:delivery_batches(batch_code)')
            .order('expense_date', { ascending: false })
            .order('created_at', { ascending: false }),
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
        ]);
        return { expenses: expenses.data ?? [], salesPoints: salesPoints.data ?? [] };
      },
    },
    {
      key: 'audit_logs',
      fn: async () => {
        const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
        return data ?? [];
      },
    },
    {
      key: 'compliance_page',
      fn: async () => {
        const [discrepancies, checks] = await Promise.all([
          supabase.from('compliance_discrepancies').select('*').order('detected_at', { ascending: false }).limit(200),
          supabase.from('compliance_checks').select('*, batch:delivery_batches(*, driver:drivers(full_name), pot_type:pot_types(name, unit_price_fcfa))').order('created_at', { ascending: false }).limit(100),
        ]);
        return { discrepancies: discrepancies.data ?? [], checks: checks.data ?? [] };
      },
    },
    {
      key: 'compliance_audit',
      fn: async () => {
        const { data } = await supabase.from('compliance_audit_trail').select('*').order('decided_at', { ascending: false });
        return data ?? [];
      },
    },
    {
      key: 'consignments-page',
      fn: async () => {
        const [consignments, salesPoints, batches] = await Promise.all([
          supabase.from('consignments').select('*, sales_point:sales_points(*)').order('deposited_at', { ascending: false }),
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
          supabase.from('delivery_batches').select('*').eq('status', 'actif').order('created_at', { ascending: false }),
        ]);
        return {
          consignments: consignments.data ?? [], salesPoints: salesPoints.data ?? [], batches: batches.data ?? [],
        };
      },
    },
    {
      key: 'journal-page',
      fn: async () => {
        const [drivers, kneaders, bakers, events, deposits, returns, handovers, production, dough, stockMv] = await Promise.all([
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('delivery_events').select('*, driver:drivers(*), sales_point:sales_points(*), batch:delivery_batches(*)').order('occurred_at', { ascending: false }).limit(300),
          supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*, driver:drivers(*))').order('deposited_at', { ascending: false }).limit(200),
          supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*, driver:drivers(*))').order('returned_at', { ascending: false }).limit(200),
          supabase.from('stock_handovers').select('*, pot_type:pot_types(*), driver:drivers(*), batch:delivery_batches(*)').order('handover_date', { ascending: false }).limit(200),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }).limit(200),
          supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)').order('delivery_date', { ascending: false }).limit(200),
          supabase.from('stock_movements').select('*, pot_type:pot_types(*), driver:drivers(*), baker:bakers(*)').order('created_at', { ascending: false }).limit(200),
        ]);
        return {
          drivers: drivers.data ?? [], kneaders: kneaders.data ?? [], bakers: bakers.data ?? [],
          events: events.data ?? [], deposits: deposits.data ?? [], returns: returns.data ?? [],
          handovers: handovers.data ?? [], production: production.data ?? [],
          dough: dough.data ?? [], stockMv: stockMv.data ?? [],
        };
      },
    },
    {
      key: 'leaderboard_page',
      fn: async () => {
        const [batches, deposits, receivables, doughDeliveries, production] = await Promise.all([
          supabase.from('delivery_batches').select('id, driver_id, quantity, pots_returned, batch_date, driver:drivers(full_name, zone, phone_primary)'),
          supabase.from('deposits').select('batch_id, amount_fcfa, deposited_at'),
          supabase.from('receivables').select('id, driver_id, amount_fcfa, amount_paid, status, created_at'),
          supabase.from('dough_deliveries').select('id, kneader_id, bucket_count, total_weight_kg, delivery_date, kneader:kneaders(full_name, phone)'),
          supabase.from('production_records').select('id, baker_id, quantity, pots_burned, madeleines_good, madeleines_burned, madeleines_broken, madeleines_defective, production_date, baker:bakers(full_name, phone)'),
        ]);
        return { batches: batches.data ?? [], deposits: deposits.data ?? [], receivables: receivables.data ?? [], doughDeliveries: doughDeliveries.data ?? [], production: production.data ?? [] };
      },
    },
    {
      key: 'field_observations',
      fn: async () => {
        const { data } = await supabase
          .from('field_observations')
          .select('*')
          .order('created_at', { ascending: false });
        return data ?? [];
      },
    },
    {
      key: 'reports-page',
      fn: async () => {
        const [b, dep, ret, recv, prod, stock, ing, db, dr, sp, kn, bk, pr, att] = await Promise.all([
          supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }),
          supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*)'),
          supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*)'),
          supabase.from('receivables').select('*, sales_point:sales_points(*), driver:drivers(*)'),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)'),
          supabase.from('stock_movements').select('*, pot_type:pot_types(*), driver:drivers(*), baker:bakers(*)'),
          supabase.from('ingredients').select('*').order('name'),
          supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*))'),
          supabase.from('drivers').select('*').order('full_name'),
          supabase.from('sales_points').select('*').order('name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('profiles').select('*').order('full_name'),
          supabase.from('attendance_records').select('*').order('attendance_date', { ascending: false }).limit(2000),
        ]);
        return { b, dep, ret, recv, prod, stock, ing, db, dr, sp, kn, bk, pr, att };
      },
    },
    {
      key: 'restock-page',
      fn: async () => {
        const [requests, salesPoints, potTypes] = await Promise.all([
          supabase.from('restock_requests').select('*, sales_point:sales_points(*), pot_type:pot_types(*), requester:profiles(full_name)').order('created_at', { ascending: false }),
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
          supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
        ]);
        return { requests: requests.data ?? [], salesPoints: salesPoints.data ?? [], potTypes: potTypes.data ?? [] };
      },
    },
    {
      key: 'opportunistic-sales',
      fn: async () => {
        const [drivers, potTypes, sales, weddings] = await Promise.all([
          supabase.from('drivers').select('id, full_name').order('full_name'),
          supabase.from('pot_types').select('id, name, unit_price_fcfa').eq('is_active', true),
          supabase.from('opportunistic_sales').select('*, driver:drivers(*), pot_type:pot_types(*)').order('sale_date', { ascending: false }),
          supabase.from('wedding_orders').select('*, driver:drivers(*), pot_type:pot_types(*)').order('order_date', { ascending: false }),
        ]);
        return { drivers: drivers.data ?? [], potTypes: potTypes.data ?? [], sales: sales.data ?? [], weddings: weddings.data ?? [] };
      },
    },
    {
      key: 'batches_page',
      fn: async () => {
        const [batches, drivers, pots, points, deposits, bsp, bpt, approvals] = await Promise.all([
          supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }),
          supabase.from('drivers').select('*').eq('status', 'actif').order('full_name'),
          supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
          supabase.from('deposits').select('*, sales_point:sales_points(*), barcode:barcodes(*)').order('deposited_at', { ascending: false }).limit(500),
          supabase.from('batch_sales_points').select('*, sales_point:sales_points(*)'),
          supabase.from('batch_pot_types').select('*, pot_type:pot_types(*)'),
          supabase.from('delivery_batch_approvals').select('*'),
        ]);
        const cachedBatches = (batches.data ?? []).map((batch) => ({
          ...batch,
          deposits: (deposits.data ?? []).filter((deposit) => deposit.batch_id === batch.id),
          sales_points: (bsp.data ?? []).filter((point) => point.batch_id === batch.id),
          batch_pot_types: (bpt.data ?? []).filter((potType) => potType.batch_id === batch.id),
          approval: (approvals.data ?? []).find((approval) => approval.batch_id === batch.id),
        }));
        const stockAlerts = (pots.data ?? [])
          .filter((pot) => (pot.low_stock_threshold ?? 0) > 0 && pot.stock_quantity <= (pot.low_stock_threshold ?? 0))
          .map((pot) => ({ pot_type: pot, current: pot.stock_quantity, threshold: pot.low_stock_threshold ?? 0 }));
        return {
          batches: cachedBatches, drivers: drivers.data ?? [], potTypes: pots.data ?? [],
          salesPoints: points.data ?? [], stockAlerts,
        };
      },
    },
    {
      key: 'production-page',
      fn: async () => {
        const [bakers, kneaders, records, dough, pots, bakerPend, kneaderPend, batchRes] = await Promise.all([
          supabase.from('bakers').select('*').order('full_name'),
          supabase.from('kneaders').select('*').order('full_name'),
          supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*), dough_delivery:dough_deliveries(*, kneader:kneaders(*))').order('production_date', { ascending: false }).limit(100),
          supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*), dough_batch:dough_batches(*)').order('delivery_date', { ascending: false }).limit(100),
          supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
          supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').eq('entity_type', 'baker').eq('status', 'en_attente').order('created_at', { ascending: false }),
          supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').eq('entity_type', 'kneader').eq('status', 'en_attente').order('created_at', { ascending: false }),
          supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*))').order('batch_date', { ascending: false }).limit(50),
        ]);
        return {
          bakers: bakers.data ?? [], kneaders: kneaders.data ?? [], records: records.data ?? [],
          doughDeliveries: dough.data ?? [], doughBatches: batchRes.data ?? [], potTypes: pots.data ?? [],
          pendingBakerReqs: bakerPend.data ?? [], pendingKneaderReqs: kneaderPend.data ?? [],
        };
      },
    },
    {
      key: 'approvals_page',
      fn: async () => {
        const { data } = await supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').order('created_at', { ascending: false });
        return data ?? [];
      },
    },
    {
      key: 'users_page',
      fn: async () => {
        const { data } = await supabase.from('profiles').select('*').order('full_name');
        return data ?? [];
      },
    },
    {
      key: 'org_chart_page',
      fn: async () => {
        const [profiles, bakers, kneaders, drivers] = await Promise.all([
          supabase.from('profiles').select('*').eq('is_active', true).order('role', { ascending: false }),
          supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
          supabase.from('kneaders').select('*').eq('status', 'actif').order('full_name'),
          supabase.from('drivers').select('*').eq('status', 'actif').order('full_name'),
        ]);
        return {
          profiles: profiles.data ?? [], bakers: bakers.data ?? [],
          kneaders: kneaders.data ?? [], drivers: drivers.data ?? [],
        };
      },
    },
    {
      key: 'scheduling_page_people',
      fn: async () => {
        const [drivers, bakers, kneaders] = await Promise.all([
          supabase.from('drivers').select('id, full_name').order('full_name'),
          supabase.from('bakers').select('id, full_name, profile_id').order('full_name'),
          supabase.from('kneaders').select('id, full_name, profile_id').order('full_name'),
        ]);
        return [
          ...(drivers.data ?? []).map((person) => ({ id: person.id, full_name: person.full_name, type: 'driver', profile_id: null })),
          ...(bakers.data ?? []).map((person) => ({ id: person.id, full_name: person.full_name, type: 'baker', profile_id: person.profile_id })),
          ...(kneaders.data ?? []).map((person) => ({ id: person.id, full_name: person.full_name, type: 'kneader', profile_id: person.profile_id })),
        ];
      },
    },
    {
      key: 'scheduling_page',
      fn: async () => {
        const [schedules, leaves] = await Promise.all([
          supabase.from('work_schedules').select('*').order('work_date', { ascending: false }).limit(200),
          supabase.from('leave_periods').select('*').order('start_date', { ascending: false }).limit(200),
        ]);
        return { schedules: schedules.data ?? [], leaves: leaves.data ?? [] };
      },
    },
    {
      key: 'map-page',
      fn: async () => {
        const [points, batches, drivers] = await Promise.all([
          supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
          supabase.from('delivery_batches').select('*'),
          supabase.from('drivers').select('*').order('full_name'),
        ]);
        const batchIds = (batches.data ?? []).map((b) => b.id);
        let deposits: any[] = [];
        let returns: any[] = [];
        if (batchIds.length > 0) {
          const [depsRes, retsRes] = await Promise.all([
            supabase.from('deposits').select('*, sales_point:sales_points(*)').in('batch_id', batchIds),
            supabase.from('returns').select('*, sales_point:sales_points(*)').in('batch_id', batchIds),
          ]);
          deposits = depsRes.data ?? [];
          returns = retsRes.data ?? [];
        }
        return {
          points: points.data ?? [], deposits, returns,
          batches: batches.data ?? [], drivers: drivers.data ?? [],
        };
      },
    },
    {
      key: 'barcodes-page',
      fn: async () => {
        const [pots, barcodes, bakers] = await Promise.all([
          supabase.from('pot_types').select('*').order('name'),
          supabase.from('barcodes').select('*, pot_type:pot_types(*), baker:bakers!baker_id(*), baker2:bakers!baker2_id(*)').order('created_at', { ascending: false }).limit(500),
          supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
        ]);
        return { potTypes: pots.data ?? [], barcodes: barcodes.data ?? [], bakers: bakers.data ?? [] };
      },
    },
    {
      key: 'kiosk:people',
      fn: async () => {
        const [profiles, drivers, bakers, kneaders] = await Promise.all([
          supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true),
          supabase.from('drivers').select('id, full_name, status').eq('status', 'actif'),
          supabase.from('bakers').select('id, full_name, status').eq('status', 'actif'),
          supabase.from('kneaders').select('id, full_name, status').eq('status', 'actif'),
        ]);
        const all = [
          ...(profiles.data ?? []).map((p: { id: string; full_name: string; role: number }) => ({ id: p.id, full_name: p.full_name, role: p.role, type: 'profile' })),
          ...(drivers.data ?? []).map((d: { id: string; full_name: string }) => ({ id: d.id, full_name: d.full_name, role: 10, type: 'driver' })),
          ...(bakers.data ?? []).map((b: { id: string; full_name: string }) => ({ id: b.id, full_name: b.full_name, role: 9, type: 'baker' })),
          ...(kneaders.data ?? []).map((k: { id: string; full_name: string }) => ({ id: k.id, full_name: k.full_name, role: 8, type: 'kneader' })),
        ];
        all.sort((a, b) => a.full_name.localeCompare(b.full_name));
        return all;
      },
    },
    {
      key: 'observations:form-refs',
      fn: async () => {
        const [batches, salesPoints, productions] = await Promise.all([
          supabase.from('delivery_batches').select('id, batch_code').order('batch_date', { ascending: false }).limit(50),
          supabase.from('sales_points').select('id, name').order('name').limit(100),
          supabase.from('production_records').select('id, production_date, notes').order('production_date', { ascending: false }).limit(50),
        ]);
        return {
          batches: batches.data ?? [],
          salesPoints: salesPoints.data ?? [],
          productions: productions.data ?? [],
        };
      },
    },
    {
      key: 'expense:authorizers',
      fn: async () => {
        const { data } = await supabase.from('profiles').select('id, full_name, role, phone, avatar_url, is_active, created_at, updated_at')
          .gte('role', 4).eq('is_active', true).order('full_name');
        return data ?? [];
      },
    },
    {
      key: 'map:live-drivers',
      fn: async () => {
        const { data } = await supabase
          .from('driver_locations')
          .select('*, driver:drivers(full_name, zone)')
          .eq('is_tracking', true);
        return data ?? [];
      },
    },
    {
      key: 'production:profiles:9',
      fn: async () => {
        const { data } = await supabase.from('profiles').select('*').eq('role', 9).order('full_name');
        return data ?? [];
      },
    },
    {
      key: 'production:profiles:8',
      fn: async () => {
        const { data } = await supabase.from('profiles').select('*').eq('role', 8).order('full_name');
        return data ?? [];
      },
    },
  ];

  const total = tasks.length;
  let done = 0;

  for (const task of tasks) {
    await fetchAndCache(task.key, task.fn);
    done++;
    onProgress?.({ done, total });
  }

  try {
    localStorage.setItem(PRECACHE_KEY, PRECACHE_VERSION);
    localStorage.setItem('mimsi_precache_timestamp', String(Date.now()));
  } catch { /* ignore */ }
}

export function isPrecacheDone(): boolean {
  try {
    return localStorage.getItem(PRECACHE_KEY) === PRECACHE_VERSION;
  } catch {
    return false;
  }
}

async function hasCachedData(): Promise<boolean> {
  try {
    const cached = await getAllCachedData();
    return Object.keys(cached).length > 0;
  } catch {
    return false;
  }
}

export function getPrecacheTimestamp(): number | null {
  try {
    const ts = localStorage.getItem('mimsi_precache_timestamp');
    return ts ? Number(ts) : null;
  } catch {
    return null;
  }
}

export async function precacheAttendanceForDate(dateStr: string): Promise<void> {
  await fetchAndCache(`attendance_records_${dateStr}`, async () => {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('attendance_date', dateStr)
      .order('arrival_time', { ascending: true, nullsFirst: false });
    return data ?? [];
  });
  await fetchAndCache(`attendance_review_${dateStr}`, async () => {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('attendance_date', dateStr)
      .order('arrival_time', { ascending: true, nullsFirst: false });
    return data ?? [];
  });
}

export async function precacheRecentAttendance(days: number = 30): Promise<void> {
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    await precacheAttendanceForDate(dateStr);
  }
}
