import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, formatFCFA, Driver, DeliveryBatch, PotType, ProductionRecord, DoughDelivery, Baker, Kneader } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart2, TrendingUp, TrendingDown, Package, Users,
  ChevronDown, FileDown, Share2, FileSpreadsheet, Wallet,
  Archive, Disc, Cookie, Wheat, CloudOff,
} from 'lucide-react';
import { sharePdfReport, downloadExcelReport } from '@/lib/exportUtils';
import PeriodFilter, { PeriodRange } from '@/components/PeriodFilter';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

type PotFilter = 'all' | 'madeleine';

export default function StatisticsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);
  const [driverFilter, setDriverFilter] = useState('all');
  const [kneaderFilter, setKneaderFilter] = useState('all');
  const [bakerFilter, setBakerFilter] = useState('all');
  const [potFilter, setPotFilter] = useState<PotFilter>('all');
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const [showKneaderDropdown, setShowKneaderDropdown] = useState(false);
  const [showBakerDropdown, setShowBakerDropdown] = useState(false);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [batches, setBatches] = useState<(DeliveryBatch & { driver?: Driver; pot_type?: PotType })[]>([]);
  const [deposits, setDeposits] = useState<{ id: string; quantity: number; amount_fcfa: number; batch_id: string; deposited_at: string }[]>([]);
  const [returns, setReturns] = useState<{ id: string; quantity: number; batch_id: string; returned_at: string; madeleine_count: number }[]>([]);
  const [receivables, setReceivables] = useState<{ id: string; amount_fcfa: number; amount_paid: number; status: string; driver_id: string | null }[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [doughDeliveries, setDoughDeliveries] = useState<DoughDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const startDate = useMemo(() => {
    if (!periodRange) return new Date().toISOString().slice(0, 10);
    return periodRange.startISO.slice(0, 10);
  }, [periodRange]);

  const endDate = useMemo(() => {
    if (!periodRange) return new Date().toISOString().slice(0, 10);
    return periodRange.endISO.slice(0, 10);
  }, [periodRange]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('statistics-page', async () => {
      const [
        driversRes, kneadersRes, bakersRes, batchesRes, depositsRes, returnsRes, receivablesRes, prodRes, doughRes,
      ] = await Promise.all([
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

      return {
        drivers: driversRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        bakers: bakersRes.data ?? [],
        batches: batchesRes.data ?? [],
        deposits: depositsRes.data ?? [],
        returns: returnsRes.data ?? [],
        receivables: receivablesRes.data ?? [],
        productionRecords: prodRes.data ?? [],
        doughDeliveries: doughRes.data ?? [],
      };
    });

    const data = result.data;
    setDrivers(data?.drivers ?? []);
    setKneaders(data?.kneaders ?? []);
    setBakers(data?.bakers ?? []);
    setBatches(data?.batches ?? []);
    setDeposits(data?.deposits ?? []);
    setReturns(data?.returns ?? []);
    setReceivables(data?.receivables ?? []);
    setProductionRecords(data?.productionRecords ?? []);
    setDoughDeliveries(data?.doughDeliveries ?? []);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeSubscription('statistics-page', isOffline ? [] : ['delivery_batches', 'deposits', 'returns', 'receivables', 'production_records', 'dough_deliveries', 'stock_movements'], loadData);

  const stats = useMemo(() => {
    const inPeriod = (d: string) => d.slice(0, 10) >= startDate && d.slice(0, 10) <= endDate;

    let filteredBatches = batches.filter((b) => inPeriod(b.batch_date));
    let filteredDeposits = deposits.filter((d) => inPeriod(d.deposited_at));
    let filteredReturns = returns.filter((r) => inPeriod(r.returned_at));
    let filteredReceivables = receivables;
    let filteredProd = productionRecords.filter((r) => inPeriod(r.production_date));
    let filteredDough = doughDeliveries.filter((d) => inPeriod(d.delivery_date));

    if (driverFilter !== 'all') {
      const driverBatches = new Set(filteredBatches.filter((b) => b.driver_id === driverFilter).map((b) => b.id));
      filteredBatches = filteredBatches.filter((b) => b.driver_id === driverFilter);
      filteredDeposits = filteredDeposits.filter((d) => driverBatches.has(d.batch_id));
      filteredReturns = filteredReturns.filter((r) => driverBatches.has(r.batch_id));
      filteredReceivables = filteredReceivables.filter((r) => r.driver_id === driverFilter);
    }

    if (kneaderFilter !== 'all') {
      filteredDough = filteredDough.filter((d) => d.kneader_id === kneaderFilter);
      const doughIds = new Set(filteredDough.map((d) => d.id));
      filteredProd = filteredProd.filter((r) => r.dough_delivery_id && doughIds.has(r.dough_delivery_id));
    }

    if (bakerFilter !== 'all') {
      filteredProd = filteredProd.filter((r) => r.baker_id === bakerFilter);
      filteredDough = filteredDough.filter((d) => d.baker_id === bakerFilter);
    }

    if (potFilter === 'madeleine') {
      filteredProd = filteredProd.filter((r) => r.pot_type?.shape === 'barquette' || r.pot_type?.shape === 'sachet');
    }

    const totalDeposits = filteredDeposits.reduce((s, d) => s + d.quantity, 0);
    const totalReturns = filteredReturns.reduce((s, r) => s + r.quantity, 0);
    const totalMadeleinesReturned = filteredReturns.reduce((s, r) => s + (r.madeleine_count ?? 0), 0);
    const revenue = filteredDeposits.reduce((s, d) => s + (d.amount_fcfa || 0), 0);
    const sellThroughRate = totalDeposits > 0 ? ((totalDeposits - totalReturns) / totalDeposits) * 100 : 0;

    const receivableTotal = filteredReceivables.reduce((s, r) => s + r.amount_fcfa, 0);
    const receivableCollected = filteredReceivables.reduce((s, r) => s + r.amount_paid, 0);
    const receivableOutstanding = receivableTotal - receivableCollected;

    const potsProduced = filteredProd.reduce((s, r) => s + r.quantity, 0);
    const potsBurned = filteredProd.reduce((s, r) => s + (r.pots_burned ?? 0), 0);
    const madeleinesGood = filteredProd.reduce((s, r) => s + r.madeleines_good, 0);
    const madeleinesBurned = filteredProd.reduce((s, r) => s + r.madeleines_burned, 0);
    const madeleinesBroken = filteredProd.reduce((s, r) => s + (r.madeleines_broken ?? 0), 0);
    const madeleinesDefective = filteredProd.reduce((s, r) => s + r.madeleines_defective, 0);

    const doughBuckets = filteredDough.reduce((s, d) => s + d.bucket_count, 0);
    const doughWeight = filteredDough.reduce((s, d) => s + Number(d.total_weight_kg), 0);

    const activeBatches = filteredBatches.filter((b) => b.status === 'actif').length;
    const closedBatches = filteredBatches.filter((b) => b.status === 'cloture').length;

    const driverStats = drivers.map((d) => {
      const dBatches = filteredBatches.filter((b) => b.driver_id === d.id);
      const dBatchIds = new Set(dBatches.map((b) => b.id));
      const dDeposits = filteredDeposits.filter((dep) => dBatchIds.has(dep.batch_id));
      const dReturns = filteredReturns.filter((r) => dBatchIds.has(r.batch_id));
      const dRevenue = dDeposits.reduce((s, dep) => s + dep.amount_fcfa, 0);
      const dDepositCount = dDeposits.reduce((s, dep) => s + dep.quantity, 0);
      const dReturnCount = dReturns.reduce((s, r) => s + r.quantity, 0);
      return {
        driver: d,
        batches: dBatches.length,
        deposits: dDepositCount,
        returns: dReturnCount,
        revenue: dRevenue,
        sellThrough: dDepositCount > 0 ? ((dDepositCount - dReturnCount) / dDepositCount) * 100 : 0,
      };
    }).filter((s) => s.batches > 0).sort((a, b) => b.revenue - a.revenue);

    const bakerStats = bakers.map((b) => {
      const bProd = productionRecords.filter((r) => inPeriod(r.production_date) && r.baker_id === b.id);
      const bDough = doughDeliveries.filter((d) => inPeriod(d.delivery_date) && d.baker_id === b.id);
      const pots = bProd.reduce((s, r) => s + r.quantity, 0);
      const burned = bProd.reduce((s, r) => s + (r.pots_burned ?? 0), 0);
      const good = bProd.reduce((s, r) => s + r.madeleines_good, 0);
      const buckets = bDough.reduce((s, d) => s + d.bucket_count, 0);
      const weight = bDough.reduce((s, d) => s + Number(d.total_weight_kg), 0);
      return { baker: b, pots, burned, good, buckets, weight, records: bProd.length };
    }).filter((s) => s.records > 0).sort((a, b) => b.pots - a.pots);

    const kneaderStats = kneaders.map((k) => {
      const kDough = doughDeliveries.filter((d) => inPeriod(d.delivery_date) && d.kneader_id === k.id);
      const buckets = kDough.reduce((s, d) => s + d.bucket_count, 0);
      const weight = kDough.reduce((s, d) => s + Number(d.total_weight_kg), 0);
      return { kneader: k, buckets, weight, deliveries: kDough.length };
    }).filter((s) => s.deliveries > 0).sort((a, b) => b.weight - a.weight);

    return {
      totalDeposits, totalReturns, totalMadeleinesReturned, revenue, sellThroughRate,
      receivableTotal, receivableCollected, receivableOutstanding,
      potsProduced, potsBurned, madeleinesGood, madeleinesBurned, madeleinesBroken, madeleinesDefective,
      doughBuckets, doughWeight,
      activeBatches, closedBatches, totalBatches: filteredBatches.length,
      driverStats, bakerStats, kneaderStats,
    };
  }, [batches, deposits, returns, receivables, productionRecords, doughDeliveries, drivers, kneaders, bakers, driverFilter, kneaderFilter, bakerFilter, potFilter, startDate, endDate]);

  const periodLabel = periodRange?.label ?? '—';
  const driverLabel = driverFilter === 'all' ? 'Tous commerciaux' : drivers.find((d) => d.id === driverFilter)?.full_name ?? '—';
  const kneaderLabel = kneaderFilter === 'all' ? 'Tous pétrisseurs' : kneaders.find((k) => k.id === kneaderFilter)?.full_name ?? '—';
  const bakerLabel = bakerFilter === 'all' ? 'Tous fours' : bakers.find((b) => b.id === bakerFilter)?.full_name ?? '—';
  const potLabel = potFilter === 'all' ? 'Tous types' : 'Madeleines';

  const handleExportPdf = () => {
    sharePdfReport({
      title: 'Rapport statistique',
      subtitle: `${periodLabel} · ${driverLabel} · ${kneaderLabel} · ${bakerLabel} · ${potLabel}`,
      columns: [
        { header: 'Indicateur', key: 'label', align: 'left' as const },
        { header: 'Valeur', key: 'value', align: 'right' as const },
      ],
      rows: [
        { label: 'Pots déposés', value: stats.totalDeposits },
        { label: 'Pots retournés', value: stats.totalReturns },
        { label: 'Madeleines retournées', value: stats.totalMadeleinesReturned },
        { label: 'Chiffre d\'affaires', value: formatFCFA(stats.revenue) },
        { label: 'Taux de vente', value: stats.sellThroughRate.toFixed(1) + '%' },
        { label: 'Créances totales', value: formatFCFA(stats.receivableTotal) },
        { label: 'Créances encaissées', value: formatFCFA(stats.receivableCollected) },
        { label: 'Créances restantes', value: formatFCFA(stats.receivableOutstanding) },
        { label: 'Pots produits', value: stats.potsProduced },
        { label: 'Pots cramés', value: stats.potsBurned },
        { label: 'Madeleines bonnes', value: stats.madeleinesGood },
        { label: 'Madeleines cramées', value: stats.madeleinesBurned },
        { label: 'Madeleines cassées', value: stats.madeleinesBroken },
        { label: 'Madeleines défectueuses', value: stats.madeleinesDefective },
        { label: 'Seaux de pâte', value: stats.doughBuckets },
        { label: 'Poids pâte (kg)', value: stats.doughWeight.toFixed(1) },
      ],
      summary: [
        { label: 'Période', value: periodLabel },
        { label: 'Commercial', value: driverLabel },
        { label: 'Pétrisseur', value: kneaderLabel },
        { label: 'Pétrisseur', value: bakerLabel },
        { label: 'Type', value: potLabel },
      ],
      fileName: 'statistiques',
    });
  };

  const handleExportExcel = () => {
    downloadExcelReport({
      title: 'Rapport statistique',
      columns: [
        { header: 'Commercial', key: 'driver' },
        { header: 'Tournées', key: 'batches' },
        { header: 'Dépôts', key: 'deposits' },
        { header: 'Retours', key: 'returns' },
        { header: 'CA (FCFA)', key: 'revenue' },
        { header: 'Taux de vente (%)', key: 'sellThrough' },
      ],
      rows: stats.driverStats.map((s) => ({
        driver: s.driver.full_name,
        batches: s.batches,
        deposits: s.deposits,
        returns: s.returns,
        revenue: s.revenue,
        sellThrough: s.sellThrough.toFixed(1),
      })),
      summary: [
        { label: 'Période', value: periodLabel },
        { label: 'Commercial', value: driverLabel },
        { label: 'Pétrisseur', value: kneaderLabel },
        { label: 'Pétrisseur', value: bakerLabel },
        { label: 'CA total', value: formatFCFA(stats.revenue) },
      ],
      fileName: 'statistiques',
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">Chargement…</div>;
  }

  if (isOffline && batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm">Aucune donnée hors ligne pour les statistiques. Connectez-vous à Internet au moins une fois.</p>
      </div>
    );
  }

  if (batches.length === 0 && !isOffline) {
    return <div className="flex items-center justify-center py-20 text-gray-400">Chargement…</div>;
  }

  const kpiCards = [
    { label: 'Pots déposés', value: stats.totalDeposits.toLocaleString('fr-FR'), icon: Package, color: 'from-blue-500 to-blue-600' },
    { label: 'Pots retournés', value: stats.totalReturns.toLocaleString('fr-FR'), icon: TrendingDown, color: 'from-amber-500 to-amber-600' },
    { label: 'Chiffre d\'affaires', value: formatFCFA(stats.revenue), icon: Wallet, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Taux de vente', value: stats.sellThroughRate.toFixed(1) + '%', icon: TrendingUp, color: 'from-violet-500 to-violet-600' },
  ];

  const filterBtn = (label: string, onClick: () => void, open: boolean) => (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-blue-500 outline-none">
      {label}
      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  const dropdownPanel = (open: boolean, allLabel: string, current: string, onSelect: (id: string) => void, items: { id: string; full_name: string }[]) =>
    open && (
      <div className="absolute top-full mt-1 left-0 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto min-w-48">
        <button onClick={() => { onSelect('all'); }}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${current === 'all' ? 'font-semibold text-amber-600' : 'text-gray-700'}`}>
          {allLabel}
        </button>
        {items.map((it) => (
          <button key={it.id} onClick={() => { onSelect(it.id); }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${current === it.id ? 'font-semibold text-amber-600' : 'text-gray-700'}`}>
            {it.full_name}
          </button>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <PeriodFilter onRangeChange={setPeriodRange} defaultPreset="week" />

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-2 items-center">
          {(profile?.role ?? 0) >= 2 && (
            <>
              <div className="relative">
                {filterBtn(driverLabel, () => { setShowDriverDropdown(!showDriverDropdown); setShowKneaderDropdown(false); setShowBakerDropdown(false); }, showDriverDropdown)}
                {dropdownPanel(showDriverDropdown, 'Tous les commerciaux', driverFilter, (id) => { setDriverFilter(id); setShowDriverDropdown(false); }, drivers)}
              </div>
              <div className="relative">
                {filterBtn(kneaderLabel, () => { setShowKneaderDropdown(!showKneaderDropdown); setShowDriverDropdown(false); setShowBakerDropdown(false); }, showKneaderDropdown)}
                {dropdownPanel(showKneaderDropdown, 'Tous les pétrisseurs', kneaderFilter, (id) => { setKneaderFilter(id); setShowKneaderDropdown(false); }, kneaders)}
              </div>
              <div className="relative">
                {filterBtn(bakerLabel, () => { setShowBakerDropdown(!showBakerDropdown); setShowDriverDropdown(false); setShowKneaderDropdown(false); }, showBakerDropdown)}
                {dropdownPanel(showBakerDropdown, 'Tous les fours', bakerFilter, (id) => { setBakerFilter(id); setShowBakerDropdown(false); }, bakers)}
              </div>
            </>
          )}
          <div className="flex gap-2">
            {(['all', 'madeleine'] as PotFilter[]).map((f) => (
              <button key={f} onClick={() => setPotFilter(f)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${potFilter === f ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f === 'all' ? 'Tous types' : 'Madeleines'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={handleExportPdf}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 transition-all">
              <FileDown className="w-4 h-4" /> PDF
            </button>
            <button onClick={handleExportExcel}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-all">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${kpi.color} flex items-center justify-center mb-3`}>
              <kpi.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" />
            Performance par commercial
            <button onClick={() => onNavigate?.('drivers')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          {stats.driverStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Aucune donnée sur cette période</p>
          ) : (
            <div className="space-y-2">
              {stats.driverStats.slice(0, 10).map((s, i) => (
                <div key={s.driver.id} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.driver.full_name}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{s.deposits} dépôts</span>
                      <span>{s.returns} retours</span>
                      <span className="text-emerald-600 font-medium">{s.sellThrough.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{formatFCFA(s.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wheat className="w-5 h-5 text-yellow-600" />
            Performance par pétrisseur
            <button onClick={() => onNavigate?.('production')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          {stats.kneaderStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Aucune donnée sur cette période</p>
          ) : (
            <div className="space-y-2">
              {stats.kneaderStats.slice(0, 10).map((s, i) => (
                <div key={s.kneader.id} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.kneader.full_name}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{s.buckets} seaux</span>
                      <span>{s.deliveries} livraisons</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{s.weight.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Cookie className="w-5 h-5 text-orange-500" />
            Performance par pétrisseur
            <button onClick={() => onNavigate?.('production')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          {stats.bakerStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Aucune donnée sur cette période</p>
          ) : (
            <div className="space-y-2">
              {stats.bakerStats.slice(0, 10).map((s, i) => (
                <div key={s.baker.id} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.baker.full_name}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{s.pots} pots</span>
                      <span className="text-red-500">{s.burned} cramés</span>
                      <span className="text-emerald-600">{s.good} madeleines</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{s.weight.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-500" />
            Créances
            <button onClick={() => onNavigate?.('receivables')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
              <span className="text-sm text-gray-600">Total créances</span>
              <span className="font-bold text-gray-900">{formatFCFA(stats.receivableTotal)}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50">
              <span className="text-sm text-emerald-700">Encaissé</span>
              <span className="font-bold text-emerald-700">{formatFCFA(stats.receivableCollected)}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50">
              <span className="text-sm text-amber-700">Reste à encaisser</span>
              <span className="font-bold text-amber-700">{formatFCFA(stats.receivableOutstanding)}</span>
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Taux de recouvrement</span>
                <span>{stats.receivableTotal > 0 ? ((stats.receivableCollected / stats.receivableTotal) * 100).toFixed(1) : '0'}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
                  style={{ width: `${stats.receivableTotal > 0 ? (stats.receivableCollected / stats.receivableTotal) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Archive className="w-5 h-5 text-amber-500" />
            Production
            <button onClick={() => onNavigate?.('production')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-600">Pots produits</span><span className="font-bold text-gray-900">{stats.potsProduced}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Pots cramés</span><span className="font-bold text-red-600">{stats.potsBurned}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Madeleines bonnes</span><span className="font-bold text-emerald-600">{stats.madeleinesGood}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Madeleines cramées</span><span className="font-bold text-red-500">{stats.madeleinesBurned}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Madeleines cassées</span><span className="font-bold text-amber-600">{stats.madeleinesBroken}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Madeleines défect.</span><span className="font-bold text-orange-500">{stats.madeleinesDefective}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Disc className="w-5 h-5 text-yellow-500" />
            Pâte & Pétrissage
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-600">Seaux livrés</span><span className="font-bold text-gray-900">{stats.doughBuckets}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Poids total</span><span className="font-bold text-gray-900">{stats.doughWeight.toFixed(1)} kg</span></div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-500" />
            Tournées
            <button onClick={() => onNavigate?.('batches')} className="ml-auto text-xs text-blue-600 hover:underline font-medium">Voir détail</button>
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-600">Total tournées</span><span className="font-bold text-gray-900">{stats.totalBatches}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Actives</span><span className="font-bold text-emerald-600">{stats.activeBatches}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Clôturées</span><span className="font-bold text-gray-500">{stats.closedBatches}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Madeleines retournées</span><span className="font-bold text-amber-600">{stats.totalMadeleinesReturned}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
