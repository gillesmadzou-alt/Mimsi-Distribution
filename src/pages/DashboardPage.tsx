import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { supabase, formatFCFA, Driver, DeliveryBatch, PotType, Baker, Kneader, ProductionRecord, DoughDelivery } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import {
  Package, Users, Route, TrendingUp, AlertTriangle,
  Truck, Clock, CheckCircle2, Undo2, Store, Wallet, Filter, X,
  Archive, Disc, ChefHat, Flame, Beaker, Scale, Droplets, UserCheck, PackageX,
  Receipt, PackagePlus, PackageMinus, CloudOff,
} from 'lucide-react';
import CategoryFilter, { PersonnelCategory } from '@/components/CategoryFilter';
import PeriodFilter, { PeriodRange } from '@/components/PeriodFilter';

type EntityFilter = PersonnelCategory;

interface RawData {
  drivers: Driver[];
  bakers: Baker[];
  kneaders: Kneader[];
  batches: (DeliveryBatch & { driver?: Driver; pot_type?: PotType })[];
  deposits: { id: string; quantity: number; amount_fcfa: number; batch_id: string; deposited_at: string }[];
  returns: { id: string; quantity: number; batch_id: string; empty_pots: number; empty_lids: number; returned_at: string }[];
  batchPotTypes: { batch_id: string; empty_pots: number; empty_lids: number; quantity: number }[];
  returnPotTypes: { return_id: string; pot_type_id: string; quantity: number; empty_pots: number; empty_lids: number; madeleine_count: number }[];
  pots: PotType[];
  salesPoints: { id: string; quota_amount: number; quota_paid: number; quota_status: string }[];
  receivables: { id: string; amount_fcfa: number; amount_paid: number; status: string; driver_id: string | null }[];
  productionRecords: ProductionRecord[];
  doughDeliveries: DoughDelivery[];
  deliveryExpenses: { id: string; amount_fcfa: number; expense_type: string; batch_id: string; deposit_id: string | null }[];
  stockMovements: { id: string; movement_type: string; quantity: number; pot_type_id: string | null; created_at: string }[];
}

function inRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}

export default function DashboardPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { fetchWithCache, isOffline } = useOfflineFetch();
  const [raw, setRaw] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [selectedDriver, setSelectedDriver] = useState<string>('all');
  const [selectedBaker, setSelectedBaker] = useState<string>('all');
  const [selectedKneader, setSelectedKneader] = useState<string>('all');
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const cacheKey = profile?.role === 1 ? `dashboard_${profile?.id}` : 'dashboard';
    let result = await fetchWithCache<RawData>(cacheKey, async () => {
      const isDriver = profile?.role === 1;
      let driverId: string | null = null;
      if (isDriver) {
        const { data: d } = await supabase
          .from('drivers')
          .select('id')
          .eq('user_id', profile!.id)
          .maybeSingle();
        driverId = d?.id ?? null;
      }

      const [
        driversRes, bakersRes, kneadersRes, batchesRes, depositsRes, returnsRes,
        potsRes, salesPointsRes, receivablesRes, batchPotTypesRes, returnPotTypesRes,
        productionRes, doughRes, expensesRes, stockMovementsRes,
      ] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('delivery_batches')
          .select('*, driver:drivers(*), pot_type:pot_types(*)')
          .order('created_at', { ascending: false }),
        supabase.from('deposits').select('id, quantity, amount_fcfa, batch_id, deposited_at'),
        supabase.from('returns').select('id, quantity, batch_id, empty_pots, empty_lids, returned_at'),
        supabase.from('pot_types').select('*').eq('is_active', true),
        supabase.from('sales_points').select('id, quota_amount, quota_paid, quota_status, driver_id, name, zone'),
        supabase.from('receivables').select('id, amount_fcfa, amount_paid, status, driver_id'),
        supabase.from('batch_pot_types').select('batch_id, empty_pots, empty_lids, quantity'),
        supabase.from('return_pot_types').select('return_id, pot_type_id, quantity, empty_pots, empty_lids, madeleine_count'),
        supabase.from('production_records')
          .select('*, baker:bakers(*), pot_type:pot_types(*), dough_delivery:dough_deliveries(*, kneader:kneaders(*))')
          .order('production_date', { ascending: false })
          .limit(500),
        supabase.from('dough_deliveries')
          .select('*, kneader:kneaders(*), baker:bakers(*)')
          .order('delivery_date', { ascending: false })
          .limit(500),
        supabase.from('delivery_expenses').select('id, amount_fcfa, expense_type, batch_id, deposit_id'),
        supabase.from('stock_movements').select('id, movement_type, quantity, pot_type_id, created_at').order('created_at', { ascending: false }).limit(200),
      ]);

      let receivables = receivablesRes.data ?? [];
      if (isDriver && driverId) {
        receivables = receivables.filter((r) => r.driver_id === driverId);
      }

      let salesPoints = salesPointsRes.data ?? [];
      if (isDriver && driverId) {
        salesPoints = salesPoints.filter((sp) => sp.driver_id === driverId);
      }

      let batches = batchesRes.data ?? [];
      if (isDriver && driverId) {
        batches = batches.filter((b) => b.driver_id === driverId);
      }

      return {
        drivers: driversRes.data ?? [],
        bakers: bakersRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        batches,
        deposits: depositsRes.data ?? [],
        returns: returnsRes.data ?? [],
        batchPotTypes: batchPotTypesRes.data ?? [],
        returnPotTypes: returnPotTypesRes.data ?? [],
        pots: potsRes.data ?? [],
        salesPoints,
        receivables,
        productionRecords: productionRes.data ?? [],
        doughDeliveries: doughRes.data ?? [],
        deliveryExpenses: expensesRes.data ?? [],
        stockMovements: stockMovementsRes.data ?? [],
      };
    });
    if (!result.data && profile?.role === 1) {
      result = await fetchWithCache<RawData>('dashboard', async () => { throw new Error('offline'); });
    }
    if (result.data) {
      setRaw(result.data);
    } else {
      setLoadError(result.error ?? 'Erreur lors du chargement des donnees.');
    }
    setLoading(false);
  }, [profile?.role, profile?.id, fetchWithCache]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime subscriptions: auto-refresh when any relevant table changes (online only)
  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_batches' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'returns' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivables' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivable_payments' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_expenses' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pot_types' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_points' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_records' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dough_deliveries' }, loadAll)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadAll, isOffline]);

  const period = useMemo(() => {
    if (!periodRange) return { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), label: "Aujourd'hui" };
    return { start: periodRange.startISO.slice(0, 10), end: periodRange.endISO.slice(0, 10), label: periodRange.label };
  }, [periodRange]);

  const stats = useMemo(() => {
    if (!raw) return null;

    const { start, end } = period;

    // --- Baker (fournier) stats ---
    const allBakerRecords = entityFilter === 'fournier'
      ? (selectedBaker !== 'all'
        ? raw.productionRecords.filter((r) => r.baker_id === selectedBaker)
        : raw.productionRecords)
      : [];

    const bakerPeriodRecords = allBakerRecords.filter((r) => inRange(r.production_date, start, end));
    const bakerPots = bakerPeriodRecords.reduce((s, r) => s + r.quantity, 0);
    const bakerBurned = bakerPeriodRecords.reduce((s, r) => s + (r.pots_burned ?? 0), 0);
    const bakerGood = bakerPeriodRecords.reduce((s, r) => s + r.madeleines_good, 0);
    const bakerMBurned = bakerPeriodRecords.reduce((s, r) => s + r.madeleines_burned, 0);
    const bakerMBroken = bakerPeriodRecords.reduce((s, r) => s + (r.madeleines_broken ?? 0), 0);
    const bakerDefective = bakerPeriodRecords.reduce((s, r) => s + r.madeleines_defective, 0);

    // --- Kneader (petrisseur) stats ---
    const allKneaderDough = entityFilter === 'petrisseur'
      ? (selectedKneader !== 'all'
        ? raw.doughDeliveries.filter((d) => d.kneader_id === selectedKneader)
        : raw.doughDeliveries)
      : [];

    const kneaderPeriodDough = allKneaderDough.filter((d) => inRange(d.delivery_date, start, end));
    const kneaderBuckets = kneaderPeriodDough.reduce((s, d) => s + d.bucket_count, 0);
    const kneaderWeight = kneaderPeriodDough.reduce((s, d) => s + Number(d.total_weight_kg), 0);
    const kneaderDeliveriesCount = kneaderPeriodDough.length;

    // --- Driver / general stats ---
    let batchIds: Set<string> | null = null;
    let driverIds: Set<string> | null = null;

    if (entityFilter === 'commercial' && selectedDriver !== 'all') {
      driverIds = new Set([selectedDriver]);
      batchIds = new Set(raw.batches.filter((b) => b.driver_id === selectedDriver).map((b) => b.id));
    }

    const showDriverStats = entityFilter === 'all' || entityFilter === 'commercial';

    // Filter batches by period (batch_date)
    const visibleBatchesAll = batchIds
      ? raw.batches.filter((b) => batchIds.has(b.id))
      : raw.batches;
    const visibleBatches = visibleBatchesAll.filter((b) => inRange(b.batch_date, start, end));

    // Filter deposits by period
    const visibleDepositsAll = batchIds
      ? raw.deposits.filter((d) => batchIds.has(d.batch_id))
      : raw.deposits;
    const visibleDeposits = visibleDepositsAll.filter((d) => inRange((d.deposited_at ?? '').slice(0, 10), start, end));

    // Filter returns by period
    const visibleReturnsAll = batchIds
      ? raw.returns.filter((r) => batchIds.has(r.batch_id))
      : raw.returns;
    const visibleReturns = visibleReturnsAll.filter((r) => inRange((r.returned_at ?? '').slice(0, 10), start, end));

    // For batch pot types, only include batches in period
    const visibleBatchIds = new Set(visibleBatches.map((b) => b.id));
    const visibleBatchPotTypes = raw.batchPotTypes.filter((bpt) => visibleBatchIds.has(bpt.batch_id));

    const totalPotsOut = visibleBatches.filter((b) => b.status === 'actif').reduce((s, b) => s + (b.quantity ?? 0), 0);
    const totalDeposits = visibleDeposits.reduce((s, d) => s + d.quantity, 0);
    const totalReturns = visibleReturns.reduce((s, r) => s + r.quantity, 0);
    const totalEmptyPotsOut = visibleBatchPotTypes.filter((bpt) => {
      const batch = raw.batches.find((b) => b.id === bpt.batch_id);
      return batch?.status === 'actif';
    }).reduce((s, bpt) => s + (bpt.empty_pots ?? 0), 0);
    const totalLidsOut = visibleBatchPotTypes.filter((bpt) => {
      const batch = raw.batches.find((b) => b.id === bpt.batch_id);
      return batch?.status === 'actif';
    }).reduce((s, bpt) => s + (bpt.empty_lids ?? 0), 0);
    const totalReturnedEmptyPots = visibleReturns.reduce((s, r) => s + (r.empty_pots ?? 0), 0);
    const totalReturnedLids = visibleReturns.reduce((s, r) => s + (r.empty_lids ?? 0), 0);

    const visibleReturnIds = new Set(visibleReturns.map((r) => r.id));
    const visibleReturnPotTypes = raw.returnPotTypes.filter((rpt) => visibleReturnIds.has(rpt.return_id));
    const returnPotBreakdown = new Map<string, { quantity: number; empty_pots: number; empty_lids: number; madeleine_count: number }>();
    visibleReturnPotTypes.forEach((rpt) => {
      const ex = returnPotBreakdown.get(rpt.pot_type_id) ?? { quantity: 0, empty_pots: 0, empty_lids: 0, madeleine_count: 0 };
      ex.quantity += rpt.quantity;
      ex.empty_pots += rpt.empty_pots;
      ex.empty_lids += rpt.empty_lids;
      ex.madeleine_count += rpt.madeleine_count;
      returnPotBreakdown.set(rpt.pot_type_id, ex);
    });
    const revenue = visibleDeposits.reduce((s, d) => s + (d.amount_fcfa || 0), 0);
    const visibleExpenses = driverIds
      ? raw.deliveryExpenses.filter((e) => visibleBatchIds.has(e.batch_id))
      : raw.deliveryExpenses;
    const totalExpenses = visibleExpenses.reduce((s, e) => s + (e.amount_fcfa || 0), 0);
    const visibleStockMovements = driverIds
      ? raw.stockMovements.filter((m) => visibleBatchIds.has(m.batch_id))
      : raw.stockMovements;
    const stockIn = visibleStockMovements.filter((m) => m.movement_type === 'entree' || m.movement_type === 'retour').reduce((s, m) => s + m.quantity, 0);
    const stockOut = visibleStockMovements.filter((m) => m.movement_type === 'attribution' || m.movement_type === 'sortie').reduce((s, m) => s + m.quantity, 0);
    const lowStockPots = raw.pots.filter((p) => p.stock_quantity <= p.low_stock_threshold);
    const lowEmptyPots = raw.pots.filter((p) => (p.empty_pots_stock ?? 0) <= p.low_stock_threshold);
    const lowLids = raw.pots.filter((p) => (p.empty_lids_stock ?? 0) <= p.low_stock_threshold);

    const visibleDrivers = driverIds
      ? raw.drivers.filter((d) => driverIds.has(d.id))
      : raw.drivers;

    const salesPoints = raw.salesPoints;

    const visibleReceivables = driverIds
      ? raw.receivables.filter((r) => r.driver_id && driverIds.has(r.driver_id))
      : raw.receivables;
    const receivableTotal = visibleReceivables.reduce((s, r) => s + r.amount_fcfa, 0);
    const receivableCollected = visibleReceivables.reduce((s, r) => s + r.amount_paid, 0);
    const receivableOutstanding = receivableTotal - receivableCollected;
    const receivableCount = visibleReceivables.filter((r) => r.status !== 'solde').length;

    return {
      showDriverStats,
      totalDrivers: visibleDrivers.length,
      activeDrivers: visibleDrivers.filter((d) => d.status === 'actif').length,
      activeBatches: visibleBatches.filter((b) => b.status === 'actif').length,
      totalBatches: visibleBatches.length,
      totalPotsOut,
      totalDeposits,
      totalReturns,
      totalEmptyPotsOut,
      totalLidsOut,
      totalReturnedEmptyPots,
      totalReturnedLids,
      revenue,
      totalExpenses,
      stockIn,
      stockOut,
      lowStockPots,
      lowEmptyPots,
      lowLids,
      recentBatches: visibleBatches.slice(0, 5),
      totalSalesPoints: salesPoints.length,
      quotaPaid: salesPoints.filter((s) => s.quota_status === 'paye').length,
      quotaPartial: salesPoints.filter((s) => s.quota_status === 'partiel').length,
      quotaUnpaid: salesPoints.filter((s) => s.quota_status === 'non_paye').length,
      quotaCollected: salesPoints.reduce((s, p) => s + (p.quota_paid ?? 0), 0),
      quotaDue: salesPoints.reduce((s, p) => s + (p.quota_amount ?? 4000), 0),
      receivableTotal,
      receivableCollected,
      receivableOutstanding,
      receivableCount,
      returnPotBreakdown: Array.from(returnPotBreakdown.entries()).map(([potTypeId, vals]) => ({ potTypeId, ...vals })),
      // Baker stats
      bakerPots,
      bakerBurned,
      bakerGood,
      bakerMBurned,
      bakerMBroken,
      bakerDefective,
      bakerRecords: bakerPeriodRecords.slice(0, 8),
      // Kneader stats
      kneaderBuckets,
      kneaderWeight,
      kneaderDeliveriesCount,
      kneaderDeliveries: kneaderPeriodDough.slice(0, 8),
    };
  }, [raw, entityFilter, selectedDriver, selectedBaker, selectedKneader, period]);

  if (loading || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        {loadError ? (
          <div className="text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 max-w-md text-center">{loadError}</div>
        ) : (
          <span className="text-gray-400">Chargement…</span>
        )}
      </div>
    );
  }

  if (isOffline && !raw) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2 text-gray-400">
        <CloudOff className="w-12 h-12 text-gray-300" />
        <p>Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le tableau de bord.</p>
      </div>
    );
  }

  const filterActive = entityFilter !== 'all' || selectedDriver !== 'all' || selectedBaker !== 'all' || selectedKneader !== 'all';

  const resetFilters = () => {
    setEntityFilter('all');
    setSelectedDriver('all');
    setSelectedBaker('all');
    setSelectedKneader('all');
  };

  // Baker cards (fournier filter)
  const bakerCards = [
    { label: 'Pots produits', value: stats.bakerPots, icon: ChefHat, color: 'from-amber-500 to-orange-600' },
    { label: 'Pots cramés', value: stats.bakerBurned, icon: Flame, color: 'from-red-500 to-red-600' },
    { label: 'Madeleines bonnes', value: stats.bakerGood, icon: CheckCircle2, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Madeleines cramées', value: stats.bakerMBurned, icon: Flame, color: 'from-red-400 to-red-500' },
    { label: 'Madeleines cassées', value: stats.bakerMBroken, icon: PackageX, color: 'from-amber-400 to-amber-500' },
    { label: 'Madeleines mauvais état', value: stats.bakerDefective, icon: AlertTriangle, color: 'from-orange-400 to-orange-500' },
  ];

  // Kneader cards (petrisseur filter)
  const kneaderCards = [
    { label: 'Seaux livrés', value: stats.kneaderBuckets, icon: Beaker, color: 'from-blue-500 to-blue-600' },
    { label: 'Pâte livrée (kg)', value: stats.kneaderWeight.toFixed(2), icon: Scale, color: 'from-cyan-500 to-cyan-600' },
    { label: 'Livraisons', value: stats.kneaderDeliveriesCount, icon: Droplets, color: 'from-amber-500 to-orange-600' },
  ];

  // Driver / general cards
  const driverCards = [
    { label: 'Commerciaux actifs', value: `${stats.activeDrivers}/${stats.totalDrivers}`, icon: Users, color: 'from-blue-500 to-blue-600' },
    { label: 'Tournées', value: stats.totalBatches, icon: Route, color: 'from-amber-500 to-orange-600' },
    { label: 'Tournées actives', value: stats.activeBatches, icon: Route, color: 'from-orange-400 to-orange-500' },
    { label: 'Pots en circulation', value: stats.totalPotsOut, icon: Package, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Pots vides en tournée', value: stats.totalEmptyPotsOut, icon: Archive, color: 'from-amber-500 to-amber-600' },
    { label: 'Couvercles en tournée', value: stats.totalLidsOut, icon: Disc, color: 'from-cyan-500 to-cyan-600' },
    { label: 'Pots déposés', value: stats.totalDeposits, icon: CheckCircle2, color: 'from-teal-500 to-teal-600' },
    { label: 'Retours / Invendus', value: stats.totalReturns, icon: Undo2, color: 'from-rose-500 to-rose-600' },
    { label: 'Pots vides revenus', value: stats.totalReturnedEmptyPots, icon: Archive, color: 'from-orange-400 to-orange-500' },
    { label: 'Couvercles revenus', value: stats.totalReturnedLids, icon: Disc, color: 'from-sky-400 to-sky-500' },
    { label: 'Chiffre d\'affaires', value: formatFCFA(stats.revenue), icon: TrendingUp, color: 'from-violet-500 to-violet-600' },
    { label: 'Dépenses livraison', value: formatFCFA(stats.totalExpenses), icon: Receipt, color: 'from-red-400 to-red-500' },
    { label: 'Stock entré', value: stats.stockIn, icon: PackagePlus, color: 'from-green-400 to-green-500' },
    { label: 'Stock sorti', value: stats.stockOut, icon: PackageMinus, color: 'from-orange-400 to-orange-500' },
    { label: 'Points de vente', value: stats.totalSalesPoints, icon: Store, color: 'from-cyan-500 to-cyan-600' },
  ];

  const cards = entityFilter === 'fournier' ? bakerCards : entityFilter === 'petrisseur' ? kneaderCards : driverCards;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Filtres</span>
          {filterActive && (
            <button onClick={resetFilters} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-red-500">
              <X className="w-3.5 h-3.5" /> Réinitialiser
            </button>
          )}
        </div>

        {/* Entity type filter */}
        <CategoryFilter value={entityFilter} onChange={setEntityFilter} />

        {/* Person selector */}
        {entityFilter === 'commercial' && raw && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Commercial</p>
            <select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}
              className="w-full sm:w-80 px-3 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm">
              <option value="all">Tous les commerciaux</option>
              {raw.drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name} — {d.zone}</option>
              ))}
            </select>
          </div>
        )}

        {entityFilter === 'fournier' && raw && (
          <div>
            <p className="text-xs text-gray-500 mb-2">pétrisseur</p>
            <select value={selectedBaker} onChange={(e) => setSelectedBaker(e.target.value)}
              className="w-full sm:w-80 px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm">
              <option value="all">Tous les pétrisseurs</option>
              {raw.bakers.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
          </div>
        )}

        {entityFilter === 'petrisseur' && raw && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Pétrisseur</p>
            <select value={selectedKneader} onChange={(e) => setSelectedKneader(e.target.value)}
              className="w-full sm:w-80 px-3 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm">
              <option value="all">Tous les pétrisseurs</option>
              {raw.kneaders.map((k) => (
                <option key={k.id} value={k.id}>{k.full_name}</option>
              ))}
            </select>
          </div>
        )}

      </div>

      {/* Period filter */}
      <PeriodFilter onRangeChange={setPeriodRange} defaultPreset="today" />

      {/* Attendance cross-link */}
      {onNavigate && (
        <button
          onClick={() => onNavigate('attendance')}
          className="w-full bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md">
              <UserCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Liste de présence</p>
              <p className="text-xs text-gray-500">Consulter la présence du personnel</p>
            </div>
          </div>
        </button>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const navTarget =
            card.label === 'Tournées' || card.label === 'Tournées actives' ? 'batches'
            : card.label === 'Commerciaux actifs' ? 'drivers'
            : card.label === 'Points de vente' ? 'sales-points'
            : entityFilter === 'fournier' ? 'production'
            : entityFilter === 'petrisseur' ? 'production'
            : null;
          return (
            <div key={card.label}
              className={`bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow${navTarget ? ' cursor-pointer' : ''}`}
              onClick={navTarget ? () => onNavigate?.(navTarget!) : undefined}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-md`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Baker recent productions */}
      {entityFilter === 'fournier' && stats.bakerRecords.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Productions — {period.label}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.bakerRecords.map((rec) => (
              <div key={rec.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <ChefHat className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{rec.baker?.full_name ?? '—'}</p>
                  <p className="text-xs text-gray-500">
                    {rec.pot_type?.name ?? '—'} · {rec.quantity} pots
                    {(rec.pots_burned ?? 0) > 0 && <span className="text-red-600"> · {rec.pots_burned} cramés</span>}
                    {rec.madeleines_good > 0 && <span className="text-emerald-600"> · {rec.madeleines_good} bonnes</span>}
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(rec.production_date).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kneader recent deliveries */}
      {entityFilter === 'petrisseur' && stats.kneaderDeliveries.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Livraisons de pâte — {period.label}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.kneaderDeliveries.map((d) => (
              <div key={d.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Beaker className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{d.kneader?.full_name ?? '—'} → {d.baker?.full_name ?? '—'}</p>
                  <p className="text-xs text-gray-500">
                    {d.bucket_count} seaux · {Number(d.total_weight_kg).toFixed(2)} kg
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(d.delivery_date).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low stock alert - only for driver/all view */}
      {stats.showDriverStats && (stats.lowStockPots.length > 0 || stats.lowEmptyPots.length > 0 || stats.lowLids.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate?.('stock')}>
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-amber-900">Alerte stock bas</h3>
          </div>
          <div className="space-y-2">
            {stats.lowStockPots.map((pot) => (
              <div key={`ready-${pot.id}`} className="flex items-center justify-between bg-white rounded-lg px-4 py-2">
                <span className="text-sm font-medium text-gray-700">{pot.name} — pots prêts</span>
                <span className="text-sm text-amber-700 font-semibold">
                  {pot.stock_quantity} restants (seuil: {pot.low_stock_threshold})
                </span>
              </div>
            ))}
            {stats.lowEmptyPots.map((pot) => (
              <div key={`empty-${pot.id}`} className="flex items-center justify-between bg-white rounded-lg px-4 py-2">
                <span className="text-sm font-medium text-gray-700">{pot.name} — pots vides</span>
                <span className="text-sm text-amber-700 font-semibold">
                  {pot.empty_pots_stock ?? 0} restants (seuil: {pot.low_stock_threshold})
                </span>
              </div>
            ))}
            {stats.lowLids.map((pot) => (
              <div key={`lids-${pot.id}`} className="flex items-center justify-between bg-white rounded-lg px-4 py-2">
                <span className="text-sm font-medium text-gray-700">{pot.name} — couvercles</span>
                <span className="text-sm text-amber-700 font-semibold">
                  {pot.empty_lids_stock ?? 0} restants (seuil: {pot.low_stock_threshold})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Receivables summary - only for driver/all view */}
      {stats.showDriverStats && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate?.('receivables')}>
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-gray-900">Suivi des créances — {period.label}</h3>
            <span className="ml-auto text-xs text-gray-400">{stats.receivableCount} non soldées</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{formatFCFA(stats.receivableTotal)}</p>
              <p className="text-xs text-gray-500 mt-1">Total créances</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{formatFCFA(stats.receivableCollected)}</p>
              <p className="text-xs text-gray-500 mt-1">Encaissé</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{formatFCFA(stats.receivableOutstanding)}</p>
              <p className="text-xs text-gray-500 mt-1">Reste à encaisser</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Taux de recouvrement</span>
              <span>{stats.receivableTotal > 0 ? Math.round((stats.receivableCollected / stats.receivableTotal) * 100) : 0}%</span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all" style={{ width: `${stats.receivableTotal > 0 ? Math.min(100, (stats.receivableCollected / stats.receivableTotal) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Quota summary - only for driver/all view */}
      {stats.showDriverStats && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate?.('sales-points')}>
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="w-5 h-5 text-teal-600" />
            <h3 className="font-semibold text-gray-900">Suivi des cotisations</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{stats.quotaPaid}</p>
              <p className="text-xs text-gray-500 mt-1">Payées</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{stats.quotaPartial}</p>
              <p className="text-xs text-gray-500 mt-1">Partielles</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats.quotaUnpaid}</p>
              <p className="text-xs text-gray-500 mt-1">Non payées</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{formatFCFA(stats.quotaCollected)}</p>
              <p className="text-xs text-gray-500 mt-1">Total collecté / {formatFCFA(stats.quotaDue)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Progression globale</span>
              <span>{stats.quotaDue > 0 ? Math.round((stats.quotaCollected / stats.quotaDue) * 100) : 0}%</span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-teal-400 to-teal-600 rounded-full transition-all" style={{ width: `${stats.quotaDue > 0 ? Math.min(100, (stats.quotaCollected / stats.quotaDue) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Returns breakdown by pot type - only for driver/all view */}
      {stats.showDriverStats && stats.returnPotBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-4">
            <Undo2 className="w-5 h-5 text-rose-600" />
            <h3 className="font-semibold text-gray-900">Retours par type de pot — {period.label}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="pb-2 font-medium">Type de pot</th>
                  <th className="pb-2 font-medium text-right">Pots prêts</th>
                  <th className="pb-2 font-medium text-right">Pots vides</th>
                  <th className="pb-2 font-medium text-right">Couvercles</th>
                  <th className="pb-2 font-medium text-right">Madeleines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stats.returnPotBreakdown.map((row) => {
                  const pot = raw.pots.find((p) => p.id === row.potTypeId);
                  return (
                    <tr key={row.potTypeId}>
                      <td className="py-2.5 font-medium text-gray-900">{pot?.name ?? '—'}</td>
                      <td className="py-2.5 text-right text-rose-600 font-semibold">{row.quantity}</td>
                      <td className="py-2.5 text-right text-amber-700 font-semibold">{row.empty_pots}</td>
                      <td className="py-2.5 text-right text-cyan-700 font-semibold">{row.empty_lids}</td>
                      <td className="py-2.5 text-right text-amber-600 font-semibold">{row.madeleine_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent batches - only for driver/all view */}
      {stats.showDriverStats && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate?.('batches')}>
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Tournées — {period.label}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recentBatches.length === 0 && (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">Aucune tournée sur cette période</div>
            )}
            {stats.recentBatches.map((batch) => (
              <div key={batch.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{batch.batch_code}</p>
                  <p className="text-xs text-gray-500">
                    {batch.driver?.full_name ?? '—'} · {batch.pot_type?.name ?? '—'} · {batch.quantity} pots
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    batch.status === 'actif' ? 'bg-blue-50 text-blue-700' :
                    batch.status === 'cloture' ? 'bg-emerald-50 text-emerald-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {batch.status === 'actif' ? 'En cours' : batch.status === 'cloture' ? 'Clôturée' : 'Annulée'}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(batch.batch_date).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
