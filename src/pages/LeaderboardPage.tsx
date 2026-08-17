import { useEffect, useState, useCallback } from 'react';
import { supabase, formatFCFA } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { downloadPdfReport } from '@/lib/exportUtils';
import { Trophy, Medal, Award, Truck, Wheat, Flame, Calendar, FileDown, X, Phone, MapPin, TrendingUp, TrendingDown, CloudOff } from 'lucide-react';
import PeriodFilter, { PeriodRange } from '@/components/PeriodFilter';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

type Category = 'drivers' | 'kneaders' | 'bakers';

interface DriverRank {
  id: string; name: string; zone: string; phone: string | null;
  total_delivered: number; total_sold: number; total_returned: number;
  revenue: number; collected: number; outstanding: number; return_rate: number; rank: number;
}
interface KneaderRank {
  id: string; name: string; phone: string | null;
  deliveries_count: number; total_buckets: number; total_weight_kg: number;
  avg_weight_per_delivery: number; rank: number;
}
interface BakerRank {
  id: string; name: string; phone: string | null;
  total_pots: number; pots_burned: number; madeleines_good: number;
  madeleines_burned: number; madeleines_broken: number; madeleines_defective: number;
  burn_rate: number; defect_rate: number; efficiency: number; rank: number;
}

function toISODate(d: Date) { return d.toISOString().slice(0, 10); }

export default function LeaderboardPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [category, setCategory] = useState<Category>('drivers');
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);

  const [driverRows, setDriverRows] = useState<DriverRank[]>([]);
  const [kneaderRows, setKneaderRows] = useState<KneaderRank[]>([]);
  const [bakerRows, setBakerRows] = useState<BakerRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPerson, setSelectedPerson] = useState<DriverRank | KneaderRank | BakerRank | null>(null);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const startISO = periodRange?.startISO ?? new Date().toISOString();
  const endISO = periodRange?.endISO ?? new Date().toISOString();
  const label = periodRange?.label ?? '—';

  const loadStats = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('leaderboard_page', async () => {
      if (category === 'drivers') await loadDrivers();
      else if (category === 'kneaders') await loadKneaders();
      else await loadBakers();
      return { category };
    });
    // When offline and cache returns null, clear rows to trigger the offline empty state
    if (result.data === null) {
      setDriverRows([]);
      setKneaderRows([]);
      setBakerRows([]);
    }
    setLoading(false);
  }, [category, fetchWithCache]);

  useEffect(() => { loadStats(); /* eslint-disable-next-line */ }, [category, periodRange, loadStats]);

  useRealtimeSubscription('leaderboard-page', isOffline ? [] : ['delivery_batches', 'deposits', 'receivables', 'production_records', 'dough_deliveries'], loadStats);

  async function loadDrivers() {
    const startDate = startISO.slice(0, 10);
    const endDate = endISO.slice(0, 10);

    const { data: batches } = await supabase
      .from('delivery_batches')
      .select('id, driver_id, quantity, pots_returned, driver:drivers(full_name, zone, phone_primary)')
      .gte('batch_date', startDate).lte('batch_date', endDate);

    const { data: deposits } = await supabase
      .from('deposits')
      .select('batch_id, amount_fcfa')
      .gte('deposited_at', startISO).lte('deposited_at', endISO);

    const { data: receivables } = await supabase
      .from('receivables')
      .select('id, driver_id, amount_fcfa, amount_paid, status')
      .gte('created_at', startISO).lte('created_at', endISO);

    const depositMap = new Map<string, number>();
    (deposits ?? []).forEach((d) => { depositMap.set(d.batch_id, (depositMap.get(d.batch_id) ?? 0) + (d.amount_fcfa ?? 0)); });

    const collectedMap = new Map<string, number>();
    const outstandingMap = new Map<string, number>();
    (receivables ?? []).forEach((r) => {
      const drv = r.driver_id ?? '_none';
      collectedMap.set(drv, (collectedMap.get(drv) ?? 0) + (r.amount_paid ?? 0));
      outstandingMap.set(drv, (outstandingMap.get(drv) ?? 0) + ((r.amount_fcfa ?? 0) - (r.amount_paid ?? 0)));
    });

    const driverMap = new Map<string, DriverRank>();
    (batches ?? []).forEach((b) => {
      if (!driverMap.has(b.driver_id)) {
        driverMap.set(b.driver_id, {
          id: b.driver_id, name: (b.driver as any)?.full_name ?? '—',
          zone: (b.driver as any)?.zone ?? '', phone: (b.driver as any)?.phone_primary ?? null,
          total_delivered: 0, total_sold: 0, total_returned: 0, revenue: 0,
          collected: 0, outstanding: 0, return_rate: 0, rank: 0,
        });
      }
      const s = driverMap.get(b.driver_id)!;
      s.total_delivered += b.quantity;
      s.total_returned += b.pots_returned;
      s.revenue += depositMap.get(b.id) ?? 0;
      s.collected += collectedMap.get(b.driver_id) ?? 0;
      s.outstanding += outstandingMap.get(b.driver_id) ?? 0;
    });

    driverMap.forEach((s) => {
      s.total_sold = s.total_delivered - s.total_returned;
      s.return_rate = s.total_delivered > 0 ? (s.total_returned / s.total_delivered) * 100 : 0;
    });

    const sorted = Array.from(driverMap.values()).sort((a, b) => b.total_sold - a.total_sold);
    sorted.forEach((r, i) => { r.rank = i + 1; });
    setDriverRows(sorted);
  }

  async function loadKneaders() {
    const { data: deliveries } = await supabase
      .from('dough_deliveries')
      .select('id, kneader_id, bucket_count, total_weight_kg, delivery_date, kneader:kneaders(full_name, phone)')
      .gte('delivery_date', startISO.slice(0, 10)).lte('delivery_date', endISO.slice(0, 10));

    const kneaderMap = new Map<string, KneaderRank>();
    (deliveries ?? []).forEach((d) => {
      if (!kneaderMap.has(d.kneader_id)) {
        kneaderMap.set(d.kneader_id, {
          id: d.kneader_id, name: (d.kneader as any)?.full_name ?? '—',
          phone: (d.kneader as any)?.phone ?? null,
          deliveries_count: 0, total_buckets: 0, total_weight_kg: 0,
          avg_weight_per_delivery: 0, rank: 0,
        });
      }
      const s = kneaderMap.get(d.kneader_id)!;
      s.deliveries_count += 1;
      s.total_buckets += d.bucket_count;
      s.total_weight_kg += Number(d.total_weight_kg ?? 0);
    });

    kneaderMap.forEach((s) => {
      s.avg_weight_per_delivery = s.deliveries_count > 0 ? s.total_weight_kg / s.deliveries_count : 0;
    });

    const sorted = Array.from(kneaderMap.values()).sort((a, b) => b.total_weight_kg - a.total_weight_kg);
    sorted.forEach((r, i) => { r.rank = i + 1; });
    setKneaderRows(sorted);
  }

  async function loadBakers() {
    const { data: records } = await supabase
      .from('production_records')
      .select('id, baker_id, quantity, pots_burned, madeleines_good, madeleines_burned, madeleines_broken, madeleines_defective, production_date, baker:bakers(full_name, phone)')
      .gte('production_date', startISO.slice(0, 10)).lte('production_date', endISO.slice(0, 10));

    const bakerMap = new Map<string, BakerRank>();
    (records ?? []).forEach((r) => {
      if (!bakerMap.has(r.baker_id)) {
        bakerMap.set(r.baker_id, {
          id: r.baker_id, name: (r.baker as any)?.full_name ?? '—',
          phone: (r.baker as any)?.phone ?? null,
          total_pots: 0, pots_burned: 0, madeleines_good: 0, madeleines_burned: 0, madeleines_broken: 0,
          madeleines_defective: 0, burn_rate: 0, defect_rate: 0, efficiency: 0, rank: 0,
        });
      }
      const s = bakerMap.get(r.baker_id)!;
      s.total_pots += r.quantity;
      s.pots_burned += r.pots_burned ?? 0;
      s.madeleines_good += r.madeleines_good ?? 0;
      s.madeleines_burned += r.madeleines_burned ?? 0;
      s.madeleines_broken += r.madeleines_broken ?? 0;
      s.madeleines_defective += r.madeleines_defective ?? 0;
    });

    bakerMap.forEach((s) => {
      const totalMadeleines = s.madeleines_good + s.madeleines_burned + s.madeleines_broken + s.madeleines_defective;
      s.burn_rate = s.total_pots > 0 ? (s.pots_burned / s.total_pots) * 100 : 0;
      s.defect_rate = totalMadeleines > 0 ? ((s.madeleines_burned + s.madeleines_broken + s.madeleines_defective) / totalMadeleines) * 100 : 0;
      s.efficiency = totalMadeleines > 0 ? (s.madeleines_good / totalMadeleines) * 100 : 0;
    });

    const sorted = Array.from(bakerMap.values()).sort((a, b) => b.madeleines_good - a.madeleines_good);
    sorted.forEach((r, i) => { r.rank = i + 1; });
    setBakerRows(sorted);
  }

  function handleExportPdf() {
    const catLabel = category === 'drivers' ? 'Commerciaux' : category === 'kneaders' ? 'Pétrisseurs' : 'pétrisseurs';
    const title = `Classement des ${catLabel}`;
    const subtitle = `Période : ${label}`;

    if (category === 'drivers') {
      downloadPdfReport({
        title, subtitle, fileName: `classement-commerciaux-${Date.now()}`,
        columns: [
          { header: 'Rang', key: 'rank', align: 'center' as const },
          { header: 'Nom', key: 'name' },
          { header: 'Zone', key: 'zone' },
          { header: 'Livrés', key: 'total_delivered', align: 'right' as const },
          { header: 'Vendus', key: 'total_sold', align: 'right' as const },
          { header: 'Retours', key: 'total_returned', align: 'right' as const },
          { header: 'Taux retours', key: 'return_rate_str', align: 'right' as const },
          { header: 'Chiffre d\'affaires', key: 'revenue_str', align: 'right' as const },
          { header: 'Créances', key: 'outstanding_str', align: 'right' as const },
        ],
        rows: driverRows.map((r) => ({
          rank: r.rank, name: r.name, zone: r.zone,
          total_delivered: r.total_delivered, total_sold: r.total_sold,
          total_returned: r.total_returned,
          return_rate_str: r.return_rate.toFixed(1) + '%',
          revenue_str: formatFCFA(r.revenue),
          outstanding_str: formatFCFA(r.outstanding),
        })),
        summary: [
          { label: 'Total pots livrés', value: driverRows.reduce((s, r) => s + r.total_delivered, 0).toString() },
          { label: 'Total pots vendus', value: driverRows.reduce((s, r) => s + r.total_sold, 0).toString() },
          { label: 'Chiffre d\'affaires total', value: formatFCFA(driverRows.reduce((s, r) => s + r.revenue, 0)) },
        ],
      });
    } else if (category === 'kneaders') {
      downloadPdfReport({
        title, subtitle, fileName: `classement-petrisseurs-${Date.now()}`,
        columns: [
          { header: 'Rang', key: 'rank', align: 'center' as const },
          { header: 'Nom', key: 'name' },
          { header: 'Livraisons', key: 'deliveries_count', align: 'right' as const },
          { header: 'Seaux', key: 'total_buckets', align: 'right' as const },
          { header: 'Poids total (kg)', key: 'total_weight_str', align: 'right' as const },
          { header: 'Moy. kg/liv.', key: 'avg_weight_str', align: 'right' as const },
        ],
        rows: kneaderRows.map((r) => ({
          rank: r.rank, name: r.name, deliveries_count: r.deliveries_count,
          total_buckets: r.total_buckets,
          total_weight_str: r.total_weight_kg.toFixed(1),
          avg_weight_str: r.avg_weight_per_delivery.toFixed(1),
        })),
        summary: [
          { label: 'Total livraisons', value: kneaderRows.reduce((s, r) => s + r.deliveries_count, 0).toString() },
          { label: 'Poids total (kg)', value: kneaderRows.reduce((s, r) => s + r.total_weight_kg, 0).toFixed(1) },
        ],
      });
    } else {
      downloadPdfReport({
        title, subtitle, fileName: `classement-pétrisseurs-${Date.now()}`,
        columns: [
          { header: 'Rang', key: 'rank', align: 'center' as const },
          { header: 'Nom', key: 'name' },
          { header: 'Pots produits', key: 'total_pots', align: 'right' as const },
          { header: 'Pots brûlés', key: 'pots_burned', align: 'right' as const },
          { header: 'Madeleines OK', key: 'madeleines_good', align: 'right' as const },
          { header: 'Madeleines brûlées', key: 'madeleines_burned', align: 'right' as const },
          { header: 'Madeleines cassées', key: 'madeleines_broken', align: 'right' as const },
          { header: 'Madeleines défect.', key: 'madeleines_defective', align: 'right' as const },
          { header: 'Taux brûlure', key: 'burn_rate_str', align: 'right' as const },
          { header: 'Efficacité', key: 'efficiency_str', align: 'right' as const },
        ],
        rows: bakerRows.map((r) => ({
          rank: r.rank, name: r.name, total_pots: r.total_pots,
          pots_burned: r.pots_burned, madeleines_good: r.madeleines_good,
          madeleines_burned: r.madeleines_burned, madeleines_broken: r.madeleines_broken,
          madeleines_defective: r.madeleines_defective,
          burn_rate_str: r.burn_rate.toFixed(1) + '%',
          efficiency_str: r.efficiency.toFixed(1) + '%',
        })),
        summary: [
          { label: 'Total pots produits', value: bakerRows.reduce((s, r) => s + r.total_pots, 0).toString() },
          { label: 'Total madeleines OK', value: bakerRows.reduce((s, r) => s + r.madeleines_good, 0).toString() },
        ],
      });
    }
  }

  const rows = category === 'drivers' ? driverRows : category === 'kneaders' ? kneaderRows : bakerRows;
  const maxVal = category === 'drivers'
    ? Math.max(...driverRows.map((r) => r.total_sold), 1)
    : category === 'kneaders'
    ? Math.max(...kneaderRows.map((r) => r.total_weight_kg), 1)
    : Math.max(...bakerRows.map((r) => r.madeleines_good), 1);

  const categoryTabs: { id: Category; label: string; icon: typeof Truck }[] = [
    { id: 'drivers', label: 'Commerciaux', icon: Truck },
    { id: 'kneaders', label: 'Pétrisseurs', icon: Wheat },
    { id: 'bakers', label: 'Pétrisseurs', icon: Flame },
  ];

  return (
    <div className="space-y-6">
      {/* Category toggle */}
      <div className="flex flex-wrap gap-2">
        {categoryTabs.map((tab) => (
          <button key={tab.id} onClick={() => setCategory(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${category === tab.id ? 'bg-amber-500 text-white shadow-md' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Period filters */}
      <div className="space-y-3">
        <PeriodFilter onRangeChange={setPeriodRange} defaultPreset="week" />
        <div className="flex justify-end">
          <button onClick={handleExportPdf} disabled={loading || rows.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            <FileDown className="w-4 h-4" /> Exporter PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le classement.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune donnée pour cette période</div>
      ) : (
        <>
          {/* Podium */}
          {rows.length >= 3 && (
            <div className="grid grid-cols-3 gap-4 items-end">
              <PodiumCard rank={2} name={rows[1].name} sub={category === 'drivers' ? `${(rows[1] as DriverRank).total_sold} pots` : category === 'kneaders' ? `${(rows[1] as KneaderRank).total_weight_kg.toFixed(1)} kg` : `${(rows[1] as BakerRank).madeleines_good} mad.`} icon={<Medal className="w-8 h-8 text-gray-400" />} height="h-24" bg="bg-gray-200" />
              <PodiumCard rank={1} name={rows[0].name} sub={category === 'drivers' ? `${(rows[0] as DriverRank).total_sold} pots` : category === 'kneaders' ? `${(rows[0] as KneaderRank).total_weight_kg.toFixed(1)} kg` : `${(rows[0] as BakerRank).madeleines_good} mad.`} icon={<Trophy className="w-10 h-10 text-amber-600" />} height="h-32" bg="bg-gradient-to-t from-amber-400 to-amber-300" />
              <PodiumCard rank={3} name={rows[2].name} sub={category === 'drivers' ? `${(rows[2] as DriverRank).total_sold} pots` : category === 'kneaders' ? `${(rows[2] as KneaderRank).total_weight_kg.toFixed(1)} kg` : `${(rows[2] as BakerRank).madeleines_good} mad.`} icon={<Award className="w-8 h-8 text-orange-500" />} height="h-16" bg="bg-orange-200" />
            </div>
          )}

          {/* Full ranking */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                Classement {category === 'drivers' ? 'des commerciaux' : category === 'kneaders' ? 'des pétrisseurs' : 'des pétrisseurs'}
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {category === 'drivers' && (driverRows as DriverRank[]).map((row) => (
                <div key={row.id} className="px-5 py-3 flex items-center gap-4 cursor-pointer hover:bg-amber-50/30 transition-colors"
                  onClick={() => setSelectedPerson(row)}>
                  <RankBadge rank={row.rank} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      <span className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigate?.('drivers'); }}>{row.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">{row.zone || '—'}</p>
                  </div>
                  <div className="flex-1 max-w-32">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full" style={{ width: `${(row.total_sold / maxVal) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{row.total_sold} pots</p>
                    <p className="text-xs text-gray-400">CA {formatFCFA(row.revenue)}</p>
                    {row.outstanding > 0 && <p className="text-xs text-amber-600 font-medium">Créances: {formatFCFA(row.outstanding)}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${row.return_rate > 20 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {row.return_rate.toFixed(0)}% retours
                  </span>
                </div>
              ))}
              {category === 'kneaders' && (kneaderRows as KneaderRank[]).map((row) => (
                <div key={row.id} className="px-5 py-3 flex items-center gap-4 cursor-pointer hover:bg-amber-50/30 transition-colors"
                  onClick={() => setSelectedPerson(row)}>
                  <RankBadge rank={row.rank} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      <span className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigate?.('production'); }}>{row.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">{row.deliveries_count} livraison{row.deliveries_count > 1 ? 's' : ''} · {row.total_buckets} seaux</p>
                  </div>
                  <div className="flex-1 max-w-32">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full" style={{ width: `${(row.total_weight_kg / maxVal) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{row.total_weight_kg.toFixed(1)} kg</p>
                    <p className="text-xs text-gray-400">Moy. {row.avg_weight_per_delivery.toFixed(1)} kg/liv.</p>
                  </div>
                </div>
              ))}
              {category === 'bakers' && (bakerRows as BakerRank[]).map((row) => (
                <div key={row.id} className="px-5 py-3 flex items-center gap-4 cursor-pointer hover:bg-amber-50/30 transition-colors"
                  onClick={() => setSelectedPerson(row)}>
                  <RankBadge rank={row.rank} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      <span className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigate?.('production'); }}>{row.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">{row.total_pots} pots · {row.madeleines_good} madeleines OK</p>
                  </div>
                  <div className="flex-1 max-w-32">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full" style={{ width: `${(row.madeleines_good / maxVal) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{row.efficiency.toFixed(0)}% efficacité</p>
                    <p className="text-xs text-gray-400">{row.pots_burned} brûlés · {row.madeleines_burned + row.madeleines_broken + row.madeleines_defective} défect.</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${row.burn_rate > 15 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {row.burn_rate.toFixed(0)}% brûlure
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Person detail drawer */}
      {selectedPerson && (
        <PersonDetailDrawer person={selectedPerson} category={category} periodLabel={label} onClose={() => setSelectedPerson(null)} />
      )}
    </div>
  );
}

function PodiumCard({ rank, name, sub, icon, height, bg }: { rank: number; name: string; sub: string; icon: React.ReactNode; height: string; bg: string }) {
  const avatarSize = rank === 1 ? 'w-16 h-16 text-2xl' : 'w-14 h-14 text-xl';
  const avatarBg = rank === 1 ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg' : rank === 2 ? 'bg-gradient-to-br from-gray-300 to-gray-400' : 'bg-gradient-to-br from-orange-300 to-amber-400';
  return (
    <div className="flex flex-col items-center">
      <div className={`${avatarSize} rounded-full ${avatarBg} flex items-center justify-center text-white font-bold mb-2`}>
        {name.charAt(0)}
      </div>
      <p className={`text-sm ${rank === 1 ? 'font-bold text-gray-900' : 'font-medium text-gray-700'} text-center truncate max-w-full`}>{name}</p>
      <p className="text-xs text-gray-500">{sub}</p>
      <div className={`w-full ${bg} rounded-t-xl ${height} mt-2 flex items-center justify-center`}>
        {icon}
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
      rank === 1 ? 'bg-amber-100 text-amber-700' :
      rank === 2 ? 'bg-gray-100 text-gray-600' :
      rank === 3 ? 'bg-orange-100 text-orange-700' :
      'bg-gray-50 text-gray-400'
    }`}>
      {rank}
    </span>
  );
}

function PersonDetailDrawer({ person, category, periodLabel, onClose }: {
  person: DriverRank | KneaderRank | BakerRank;
  category: Category;
  periodLabel: string;
  onClose: () => void;
}) {
  const name = person.name;
  const phone = (person as any).phone as string | null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">
              {name.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-lg">{name}</h3>
              <p className="text-sm text-white/80">
                {category === 'drivers' ? 'Commercial' : category === 'kneaders' ? 'Pétrisseur' : 'Pétrisseur'} · Rang #{person.rank}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contact info */}
        <div className="px-6 py-4 border-b border-gray-100 space-y-2">
          {phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone className="w-4 h-4 text-gray-400" />
              <a href={`tel:${phone}`} className="hover:text-amber-600">{phone}</a>
            </div>
          )}
          {category === 'drivers' && (person as DriverRank).zone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span>{(person as DriverRank).zone}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span>Période : {periodLabel}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="px-6 py-4 space-y-4">
          {category === 'drivers' && <DriverDetail person={person as DriverRank} />}
          {category === 'kneaders' && <KneaderDetail person={person as KneaderRank} />}
          {category === 'bakers' && <BakerDetail person={person as BakerRank} />}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

function DriverDetail({ person }: { person: DriverRank }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Pots livrés" value={person.total_delivered.toString()} icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="bg-blue-50" />
        <StatCard label="Pots vendus" value={person.total_sold.toString()} icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
        <StatCard label="Pots retournés" value={person.total_returned.toString()} icon={<TrendingDown className="w-5 h-5 text-red-600" />} color="bg-red-50" />
        <StatCard label="Taux de retours" value={person.return_rate.toFixed(1) + '%'} icon={<TrendingDown className="w-5 h-5 text-orange-600" />} color="bg-orange-50" />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <StatCard label="Chiffre d'affaires" value={formatFCFA(person.revenue)} icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
        <StatCard label="Encaissé" value={formatFCFA(person.collected)} sub="Créances collectées sur la période" icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="bg-blue-50" />
        {person.outstanding > 0 && (
          <StatCard label="Créances en attente" value={formatFCFA(person.outstanding)} sub="Montant restant à encaisser" icon={<TrendingDown className="w-5 h-5 text-amber-600" />} color="bg-amber-50" />
        )}
      </div>
    </>
  );
}

function KneaderDetail({ person }: { person: KneaderRank }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Livraisons de pâte" value={person.deliveries_count.toString()} icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="bg-blue-50" />
      <StatCard label="Seaux livrés" value={person.total_buckets.toString()} icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
      <StatCard label="Poids total" value={person.total_weight_kg.toFixed(1) + ' kg'} icon={<TrendingUp className="w-5 h-5 text-amber-600" />} color="bg-amber-50" />
      <StatCard label="Moy. par livraison" value={person.avg_weight_per_delivery.toFixed(1) + ' kg'} icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="bg-blue-50" />
    </div>
  );
}

function BakerDetail({ person }: { person: BakerRank }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Pots produits" value={person.total_pots.toString()} icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="bg-blue-50" />
        <StatCard label="Pots brûlés" value={person.pots_burned.toString()} icon={<TrendingDown className="w-5 h-5 text-red-600" />} color="bg-red-50" />
        <StatCard label="Madeleines OK" value={person.madeleines_good.toString()} icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
        <StatCard label="Madeleines brûlées" value={person.madeleines_burned.toString()} icon={<TrendingDown className="w-5 h-5 text-red-600" />} color="bg-red-50" />
        <StatCard label="Madeleines cassées" value={(person.madeleines_broken ?? 0).toString()} icon={<TrendingDown className="w-5 h-5 text-amber-600" />} color="bg-amber-50" />
        <StatCard label="Madeleines défect." value={person.madeleines_defective.toString()} icon={<TrendingDown className="w-5 h-5 text-orange-600" />} color="bg-orange-50" />
        <StatCard label="Taux de brûlure" value={person.burn_rate.toFixed(1) + '%'} icon={<TrendingDown className="w-5 h-5 text-red-600" />} color="bg-red-50" />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <StatCard label="Taux de défectuosité" value={person.defect_rate.toFixed(1) + '%'} sub="Brûlées + cassées + défectueuses" icon={<TrendingDown className="w-5 h-5 text-orange-600" />} color="bg-orange-50" />
        <StatCard label="Efficacité" value={person.efficiency.toFixed(1) + '%'} sub="Madeleines bonnes / total" icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
      </div>
    </>
  );
}
