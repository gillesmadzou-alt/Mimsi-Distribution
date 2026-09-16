import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import type { DeliveryEvent, Deposit, Return, StockHandover, ProductionRecord, DoughDelivery, Driver, Baker, Kneader, StockMovement } from '@/lib/supabase';
import {
  Package, Undo2, CheckCircle2, XCircle, ArrowUpCircle,
  Search, ChefHat, Archive, Plus, Disc, Wheat, ChevronDown,
  FileText, Loader2, CloudOff,
} from 'lucide-react';
import CategoryFilter, { PersonnelCategory } from '@/components/CategoryFilter';
import PeriodFilter, { PeriodRange } from '@/components/PeriodFilter';
import { downloadPdfReport } from '@/lib/exportUtils';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

interface TimelineItem {
  id: string;
  timestamp: string;
  title: string;
  subtitle: string;
  label: string;
  icon: typeof Package;
  color: string;
  bgColor: string;
  category: 'pate' | 'production' | 'stock_in' | 'stock_out' | 'livraison' | 'retour' | 'system';
  driverId?: string;
  bakerId?: string;
  kneaderId?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  pate: 'Pate & Petrisseur',
  production: 'Production (pétrisseur)',
  stock_in: 'Entree en stock',
  stock_out: 'Sortie de stock',
  livraison: 'Livraison',
  retour: 'Retours & Invendus',
  system: 'Systeme',
};

function TimelineEntry({ item, onNavigate }: { item: TimelineItem; onNavigate?: (page: string) => void }) {
  const Icon = item.icon;
  const isBatchLabel = item.label && item.category !== 'production' && item.category !== 'pate';
  const isProductionEntry = item.category === 'production' || item.category === 'pate';
  return (
    <div className="relative flex gap-4 pl-0">
      <div className={`w-8 h-8 rounded-full ${item.bgColor} flex items-center justify-center flex-shrink-0 z-10 ring-4 ring-white`}>
        <Icon className={`w-4 h-4 ${item.color}`} />
      </div>
      <div className="flex-1 pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isProductionEntry ? (
                <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate?.('production')}>{item.title}</span>
              ) : item.title}
            </p>
            <p className="text-xs text-gray-500">
              {item.subtitle}
              {item.label && (
                <>
                  {' - '}
                  {isBatchLabel ? (
                    <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate?.('batches')}>{item.label}</span>
                  ) : item.label}
                </>
              )}
            </p>
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {new Date(item.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

function PersonDropdown({
  label, allLabel, people, value, onChange,
}: {
  label: string;
  allLabel: string;
  people: { id: string; full_name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = value === 'all' ? allLabel : people.find((p) => p.id === value)?.full_name ?? allLabel;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none whitespace-nowrap"
      >
        <span className="text-gray-500">{label}:</span>
        <span className="font-medium text-gray-900 truncate max-w-32">{currentLabel}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto min-w-48">
            <button
              onClick={() => { onChange('all'); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${value === 'all' ? 'font-semibold text-amber-600' : 'text-gray-700'}`}
            >
              {allLabel}
            </button>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${value === p.id ? 'font-semibold text-amber-600' : 'text-gray-700'}`}
              >
                {p.full_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function JournalPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [personnelFilter, setPersonnelFilter] = useState<PersonnelCategory>('all');
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [driverFilter, setDriverFilter] = useState('all');
  const [bakerFilter, setBakerFilter] = useState('all');
  const [kneaderFilter, setKneaderFilter] = useState('all');

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    const items: TimelineItem[] = [];

    const startDate = periodRange?.startISO.slice(0, 10) ?? '2000-01-01';
    const endDate = periodRange?.endISO.slice(0, 10) ?? '2099-12-31';

    const result = await fetchWithCache('journal-page', async () => {
      const [driversRes, kneadersRes, bakersRes, eventsRes, depositsRes, returnsRes, handoversRes, productionRes, doughRes, stockMvRes] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('delivery_events').select('*, driver:drivers(*), sales_point:sales_points(*), batch:delivery_batches(*)')
          .gte('occurred_at', startDate).lte('occurred_at', endDate + 'T23:59:59')
          .order('occurred_at', { ascending: false }).limit(300),
        supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*, driver:drivers(*))')
          .gte('deposited_at', startDate).lte('deposited_at', endDate + 'T23:59:59')
          .order('deposited_at', { ascending: false }).limit(200),
        supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*, driver:drivers(*))')
          .gte('returned_at', startDate).lte('returned_at', endDate + 'T23:59:59')
          .order('returned_at', { ascending: false }).limit(200),
        supabase.from('stock_handovers').select('*, pot_type:pot_types(*), driver:drivers(*), batch:delivery_batches(*)')
          .gte('handover_date', startDate).lte('handover_date', endDate + 'T23:59:59')
          .order('handover_date', { ascending: false }).limit(200),
        supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)')
          .gte('production_date', startDate).lte('production_date', endDate)
          .order('production_date', { ascending: false }).limit(200),
        supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)')
          .gte('delivery_date', startDate).lte('delivery_date', endDate)
          .order('delivery_date', { ascending: false }).limit(200),
        supabase.from('stock_movements').select('*, pot_type:pot_types(*), driver:drivers(*), baker:bakers(*)')
          .gte('created_at', startDate).lte('created_at', endDate + 'T23:59:59')
          .order('created_at', { ascending: false }).limit(200),
      ]);

      return {
        drivers: driversRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        bakers: bakersRes.data ?? [],
        events: eventsRes.data ?? [],
        deposits: depositsRes.data ?? [],
        returns: returnsRes.data ?? [],
        handovers: handoversRes.data ?? [],
        production: productionRes.data ?? [],
        dough: doughRes.data ?? [],
        stockMv: stockMvRes.data ?? [],
      };
    });

    const data = result.data ?? {
      drivers: [], kneaders: [], bakers: [], events: [], deposits: [],
      returns: [], handovers: [], production: [], dough: [], stockMv: [],
    };

    data.drivers = Array.isArray(data.drivers) ? data.drivers : [];
    data.kneaders = Array.isArray(data.kneaders) ? data.kneaders : [];
    data.bakers = Array.isArray(data.bakers) ? data.bakers : [];
    data.events = Array.isArray(data.events) ? data.events : [];
    data.deposits = Array.isArray(data.deposits) ? data.deposits : [];
    data.returns = Array.isArray(data.returns) ? data.returns : [];
    data.handovers = Array.isArray(data.handovers) ? data.handovers : [];
    data.production = Array.isArray(data.production) ? data.production : [];
    data.dough = Array.isArray(data.dough) ? data.dough : [];
    data.stockMv = Array.isArray(data.stockMv) ? data.stockMv : [];
    setDrivers(data.drivers);
    setKneaders(data.kneaders);
    setBakers(data.bakers);

    const iconMap: Record<string, typeof Package> = {
      lot_cree: Plus, depot: Package, retour: Undo2, tournee_close: CheckCircle2,
      tournee_annulee: XCircle, stock_mouvement: ArrowUpCircle, livraison_pate: Wheat,
      production_stock: Archive, remise_pots: Disc,
    };
    const catMap: Record<string, TimelineItem['category']> = {
      lot_cree: 'livraison', depot: 'livraison', retour: 'retour',
      tournee_close: 'livraison', tournee_annulee: 'livraison',
      stock_mouvement: 'stock_out', livraison_pate: 'pate',
      production_stock: 'stock_in', remise_pots: 'livraison',
    };

    (data.events ?? []).forEach((e: DeliveryEvent) => {
      items.push({
        id: 'evt-' + e.id,
        timestamp: e.occurred_at,
        title: e.description ?? e.event_type,
        subtitle: e.driver?.full_name ?? e.sales_point?.name ?? '-',
        label: e.batch?.batch_code ?? '',
        icon: iconMap[e.event_type] ?? Package,
        color: 'text-gray-600', bgColor: 'bg-gray-100',
        category: catMap[e.event_type] ?? 'system',
        driverId: e.driver_id ?? undefined,
      });
    });

    (data.deposits ?? []).forEach((d: Deposit) => {
      items.push({
        id: 'dep-' + d.id,
        timestamp: d.deposited_at,
        title: 'Depot - ' + d.quantity + ' pots',
        subtitle: d.sales_point?.name ?? '-',
        label: d.batch?.batch_code ?? '',
        icon: Package, color: 'text-blue-600', bgColor: 'bg-blue-50',
        category: 'livraison',
        driverId: d.batch?.driver_id ?? undefined,
      });
    });

    (data.returns ?? []).forEach((r: Return) => {
      items.push({
        id: 'ret-' + r.id,
        timestamp: r.returned_at,
        title: 'Retour - ' + r.quantity + ' pots',
        subtitle: r.sales_point?.name ?? '-',
        label: r.batch?.batch_code ?? '',
        icon: Undo2, color: 'text-amber-600', bgColor: 'bg-amber-50',
        category: 'retour',
        driverId: r.batch?.driver_id ?? undefined,
      });
    });

    (data.handovers ?? []).forEach((h: StockHandover) => {
      const isOut = h.handover_type === 'stock_to_driver';
      items.push({
        id: 'ho-' + h.id,
        timestamp: h.handover_date,
        title: (isOut ? 'Sortie de stock' : 'Entree en stock') + ' - ' + h.quantity + ' ' + (h.pot_type?.name ?? ''),
        subtitle: isOut ? (h.driver?.full_name ?? '-') : 'Production',
        label: h.batch?.batch_code ?? '',
        icon: isOut ? ArrowUpCircle : Archive,
        color: isOut ? 'text-orange-600' : 'text-emerald-600',
        bgColor: isOut ? 'bg-orange-50' : 'bg-emerald-50',
        category: isOut ? 'stock_out' : 'stock_in',
        driverId: h.driver_id ?? undefined,
      });
    });

    (data.production ?? []).forEach((p: ProductionRecord) => {
      items.push({
        id: 'prod-' + p.id,
        timestamp: p.production_date + 'T00:00:00',
        title: 'Production - ' + (p.pots_burned ?? 0) + ' pots cuits',
        subtitle: p.baker?.full_name ?? '-',
        label: p.pot_type?.name ?? '',
        icon: ChefHat, color: 'text-rose-600', bgColor: 'bg-rose-50',
        category: 'production',
        bakerId: p.baker_id,
      });
    });

    (data.dough ?? []).forEach((dd: DoughDelivery) => {
      items.push({
        id: 'dd-' + dd.id,
        timestamp: dd.delivery_date + 'T00:00:00',
        title: 'Livraison de pate - ' + (dd.total_weight_kg ?? 0) + ' kg',
        subtitle: dd.kneader?.full_name ?? '-',
        label: dd.baker?.full_name ?? '',
        icon: Wheat, color: 'text-yellow-700', bgColor: 'bg-yellow-50',
        category: 'pate',
        kneaderId: dd.kneader_id,
        bakerId: dd.baker_id,
      });
    });

    const mvTypeLabel: Record<string, string> = {
      entree: 'Entree stock', attribution: 'Attribution', retour: 'Retour stock', ajustement: 'Ajustement',
    };
    (data.stockMv ?? []).forEach((m: StockMovement) => {
      const isEntree = m.movement_type === 'entree' || m.movement_type === 'retour';
      const personLabel = m.driver?.full_name ?? m.baker?.full_name ?? null;
      items.push({
        id: 'sm-' + m.id,
        timestamp: m.created_at,
        title: (mvTypeLabel[m.movement_type] ?? m.movement_type) + ' - ' + m.quantity + ' ' + (m.pot_type?.name ?? ''),
        subtitle: personLabel ? (m.driver ? 'Commercial: ' : 'pétrisseur: ') + personLabel : (m.notes ?? '-'),
        label: m.notes ?? '',
        icon: isEntree ? Archive : ArrowUpCircle,
        color: isEntree ? 'text-emerald-600' : 'text-orange-600',
        bgColor: isEntree ? 'bg-emerald-50' : 'bg-orange-50',
        category: isEntree ? 'stock_in' : 'stock_out',
        driverId: m.driver_id ?? undefined,
        bakerId: m.baker_id ?? undefined,
      });
    });

    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    setTimeline(items);
    setLoading(false);
  }, [periodRange, fetchWithCache]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  useRealtimeSubscription('journal-page', isOffline ? [] : ['delivery_events', 'deposits', 'returns', 'stock_handovers', 'production_records', 'dough_deliveries', 'stock_movements'], loadTimeline);

  const filtered = useMemo(() => {
    let result = timeline;
    if (filterCategory) result = result.filter((i) => i.category === filterCategory);
    if (personnelFilter !== 'all') {
      result = result.filter((i) => {
        if (personnelFilter === 'petrisseur') return i.category === 'pate';
        if (personnelFilter === 'fournier') return i.category === 'production' || i.category === 'stock_in';
        if (personnelFilter === 'commercial') return i.category === 'stock_out' || i.category === 'livraison';
        return true;
      });
    }
    if (driverFilter !== 'all') result = result.filter((i) => i.driverId === driverFilter);
    if (bakerFilter !== 'all') result = result.filter((i) => i.bakerId === bakerFilter);
    if (kneaderFilter !== 'all') result = result.filter((i) => i.kneaderId === kneaderFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.subtitle.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q)
      );
    }
    return result;
  }, [timeline, filterCategory, personnelFilter, driverFilter, bakerFilter, kneaderFilter, search]);

  const categories = Object.keys(CATEGORY_LABELS);
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = () => {
    if (filtered.length === 0) return;
    setExporting(true);
    const periodLabel = periodRange
      ? periodRange.label
      : 'Toutes les periodes';
    const driverName = driverFilter !== 'all' ? drivers.find((d) => d.id === driverFilter)?.full_name ?? 'Tous' : 'Tous';
    const bakerName = bakerFilter !== 'all' ? bakers.find((b) => b.id === bakerFilter)?.full_name ?? 'Tous' : 'Tous';
    const kneaderName = kneaderFilter !== 'all' ? kneaders.find((k) => k.id === kneaderFilter)?.full_name ?? 'Tous' : 'Tous';

    downloadPdfReport({
      title: 'Journal de livraison',
      subtitle: `Periode: ${periodLabel} | Commercial: ${driverName} | Petrisseur: ${kneaderName} | pétrisseur: ${bakerName}`,
      columns: [
        { header: 'Date', key: 'date' },
        { header: 'Type', key: 'type' },
        { header: 'Description', key: 'title' },
        { header: 'Details', key: 'subtitle' },
        { header: 'Reference', key: 'label' },
      ],
      rows: filtered.map((i) => ({
        date: new Date(i.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
        type: CATEGORY_LABELS[i.category] ?? i.category,
        title: i.title,
        subtitle: i.subtitle,
        label: i.label,
      })),
      summary: [
        { label: "Nombre d'evenements", value: String(filtered.length) },
        { label: 'Periode', value: periodLabel },
      ],
      fileName: `Journal_livraison_${new Date().toISOString().slice(0, 10)}`,
    });
    setExporting(false);
  };

  const resetPersonFilters = () => {
    setDriverFilter('all');
    setBakerFilter('all');
    setKneaderFilter('all');
  };

  const activePersonFilterCount =
    (driverFilter !== 'all' ? 1 : 0) + (bakerFilter !== 'all' ? 1 : 0) + (kneaderFilter !== 'all' ? 1 : 0);

  return (
    <div className="space-y-4">
      <PeriodFilter onRangeChange={setPeriodRange} defaultPreset="week" />

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <CategoryFilter value={personnelFilter} onChange={setPersonnelFilter} />
        <div className="flex flex-wrap gap-2 items-center">
          <PersonDropdown
            label="Commercial"
            allLabel="Tous les commerciaux"
            people={drivers}
            value={driverFilter}
            onChange={setDriverFilter}
          />
          <PersonDropdown
            label="Pétrisseur"
            allLabel="Tous les pétrisseurs"
            people={kneaders}
            value={kneaderFilter}
            onChange={setKneaderFilter}
          />
          <PersonDropdown
            label="Pétrisseur"
            allLabel="Tous les fours"
            people={bakers}
            value={bakerFilter}
            onChange={setBakerFilter}
          />
          {activePersonFilterCount > 0 && (
            <button
              onClick={resetPersonFilters}
              className="px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Réinitialiser
            </button>
          )}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans le journal..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="">Toutes les etapes</option>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <button
            onClick={handleExportPdf}
            disabled={exporting || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement du journal...</div>
      ) : isOffline && timeline.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le journal.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Archive className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Aucun evenement sur cette periode</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-3">{filtered.length} evenement{filtered.length > 1 ? 's' : ''}</p>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-100" />
            <div className="space-y-3">
              {filtered.map((item) => (
                <TimelineEntry key={item.id} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
