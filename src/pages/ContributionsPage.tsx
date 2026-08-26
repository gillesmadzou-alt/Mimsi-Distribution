import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, Driver, QuotaPayment, SalesPoint, formatFCFA } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { downloadExcelReport, downloadPdfReport } from '@/lib/exportUtils';
import {
  AlertCircle, CheckCircle2, ChevronRight, CloudOff, FileSpreadsheet,
  FileText, Filter, History, MapPin, PiggyBank, Search, Wallet, X,
} from 'lucide-react';

type ContributionPoint = SalesPoint & {
  driver?: Pick<Driver, 'id' | 'full_name'> | null;
};

type PaymentWithCollector = QuotaPayment & {
  collector?: { full_name: string } | null;
};

const STATUS_CONFIG = {
  non_paye: { label: 'Non payée', style: 'bg-red-50 text-red-700', Icon: AlertCircle },
  partiel: { label: 'Partielle', style: 'bg-amber-50 text-amber-700', Icon: Wallet },
  paye: { label: 'Payée', style: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
} as const;

const PAYMENT_METHODS: Record<string, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement',
  autre: 'Autre',
};

const UNASSIGNED_DRIVER_FILTER = '__unassigned__';

export default function ContributionsPage() {
  const [points, setPoints] = useState<ContributionPoint[]>([]);
  const [payments, setPayments] = useState<PaymentWithCollector[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<ContributionPoint | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [driverId, setDriverId] = useState('');
  const [zone, setZone] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('contributions:detail', async () => {
      const [pointsResult, paymentsResult] = await Promise.all([
        supabase
          .from('sales_points')
          .select('*, driver:drivers(id, full_name)')
          .eq('is_new', true)
          .order('name'),
        supabase
          .from('quota_payments')
          .select('*, collector:profiles!quota_payments_collected_by_fkey(full_name)')
          .order('payment_date', { ascending: false }),
      ]);
      if (pointsResult.error) throw pointsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      return {
        points: (pointsResult.data ?? []) as ContributionPoint[],
        payments: (paymentsResult.data ?? []) as PaymentWithCollector[],
      };
    });
    setPoints(result.data?.points ?? []);
    setPayments(result.data?.payments ?? []);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeSubscription('contributions-page', isOffline ? [] : ['sales_points', 'quota_payments'], loadData);

  const latestPaymentByPoint = useMemo(() => {
    const dates = new Map<string, string>();
    payments.forEach((payment) => {
      if (!dates.has(payment.sales_point_id)) dates.set(payment.sales_point_id, payment.payment_date);
    });
    return dates;
  }, [payments]);

  const drivers = useMemo(() => {
    const unique = new Map<string, string>();
    points.forEach((point) => {
      if (point.driver?.id) unique.set(point.driver.id, point.driver.full_name);
    });
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [points]);

  const zones = useMemo(() => [...new Set(points.map((point) => point.zone).filter(Boolean))].sort(), [points]);

  const filteredPoints = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return points.filter((point) => {
      const lastPayment = latestPaymentByPoint.get(point.id) ?? '';
      const matchesSearch = !query || [point.name, point.owner_full_name, point.owner_phone, point.zone]
        .some((value) => value?.toLocaleLowerCase('fr').includes(query));
      return matchesSearch
        && (!status || point.quota_status === status)
        && (!driverId || (driverId === UNASSIGNED_DRIVER_FILTER ? !point.driver?.id : point.driver?.id === driverId))
        && (!zone || point.zone === zone)
        && (!dateFrom || lastPayment >= dateFrom)
        && (!dateTo || lastPayment <= dateTo);
    });
  }, [points, search, status, driverId, zone, dateFrom, dateTo, latestPaymentByPoint]);

  const totals = useMemo(() => filteredPoints.reduce((summary, point) => ({
    due: summary.due + (point.quota_amount ?? 0),
    paid: summary.paid + (point.quota_paid ?? 0),
    remaining: summary.remaining + Math.max(0, (point.quota_amount ?? 0) - (point.quota_paid ?? 0)),
  }), { due: 0, paid: 0, remaining: 0 }), [filteredPoints]);

  const paymentHistory = useMemo(() => selectedPoint
    ? payments.filter((payment) => payment.sales_point_id === selectedPoint.id)
    : [], [payments, selectedPoint]);

  const resetFilters = () => {
    setSearch(''); setStatus(''); setDriverId(''); setZone(''); setDateFrom(''); setDateTo('');
  };

  const exportRows = () => filteredPoints.map((point) => ({
    point: point.name,
    proprietaire: point.owner_full_name ?? point.owner_name ?? '',
    commercial: point.driver?.full_name ?? '',
    zone: point.zone ?? '',
    du: point.quota_amount ?? 0,
    paye: point.quota_paid ?? 0,
    reste: Math.max(0, (point.quota_amount ?? 0) - (point.quota_paid ?? 0)),
    statut: STATUS_CONFIG[point.quota_status]?.label ?? point.quota_status,
    dernierVersement: latestPaymentByPoint.get(point.id)
      ? new Date(`${latestPaymentByPoint.get(point.id)}T00:00:00`).toLocaleDateString('fr-FR') : '—',
  }));

  const exportColumns = [
    { header: 'Point de vente', key: 'point' },
    { header: 'Propriétaire', key: 'proprietaire' },
    { header: 'Commercial', key: 'commercial' },
    { header: 'Zone', key: 'zone' },
    { header: 'Montant dû', key: 'du', align: 'right' as const },
    { header: 'Montant payé', key: 'paye', align: 'right' as const },
    { header: 'Reste', key: 'reste', align: 'right' as const },
    { header: 'Statut', key: 'statut' },
    { header: 'Dernier versement', key: 'dernierVersement' },
  ];

  const exportSummary = [
    { label: 'Total dû', value: formatFCFA(totals.due) },
    { label: 'Total encaissé', value: formatFCFA(totals.paid) },
    { label: 'Reste à encaisser', value: formatFCFA(totals.remaining) },
  ];

  const exportExcel = () => downloadExcelReport({
    title: 'Suivi des cotisations', columns: exportColumns, rows: exportRows(),
    summary: exportSummary, fileName: 'suivi-cotisations',
  });

  const exportPdf = () => downloadPdfReport({
    title: 'Suivi détaillé des cotisations',
    subtitle: `${filteredPoints.length} point(s) de vente — filtres actifs appliqués`,
    columns: exportColumns,
    rows: exportRows().map((row) => ({ ...row, du: formatFCFA(row.du), paye: formatFCFA(row.paye), reste: formatFCFA(row.reste) })),
    summary: exportSummary, fileName: 'suivi-cotisations',
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Cotisations attendues', value: totals.due, color: 'text-gray-900', bg: 'bg-blue-100', Icon: PiggyBank },
          { label: 'Montant encaissé', value: totals.paid, color: 'text-emerald-700', bg: 'bg-emerald-100', Icon: CheckCircle2 },
          { label: 'Reste à encaisser', value: totals.remaining, color: 'text-red-700', bg: 'bg-red-100', Icon: AlertCircle },
        ].map(({ label, value, color, bg, Icon }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}><Icon className={`w-6 h-6 ${color}`} /></div>
            <div><p className="text-sm text-gray-500">{label}</p><p className={`text-xl font-bold ${color}`}>{formatFCFA(value)}</p></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Point de vente, propriétaire, téléphone ou zone…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-amber-500" />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm">
            <option value="">Tous les statuts</option><option value="non_paye">Non payées</option><option value="partiel">Partielles</option><option value="paye">Payées</option>
          </select>
          <select value={driverId} onChange={(event) => setDriverId(event.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm">
            <option value="">Tous les commerciaux</option>
            <option value={UNASSIGNED_DRIVER_FILTER}>Sans commercial</option>
            {drivers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={zone} onChange={(event) => setZone(event.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm">
            <option value="">Toutes les zones</option>{zones.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">Versement du<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="block mt-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
          <label className="text-xs text-gray-500">au<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="block mt-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
          <button onClick={resetFilters} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"><Filter className="w-4 h-4" />Réinitialiser</button>
          <span className="text-sm text-gray-500 lg:ml-auto">{filteredPoints.length} résultat(s)</span>
          <button onClick={exportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm"><FileSpreadsheet className="w-4 h-4" />Excel</button>
          <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 text-white text-sm"><FileText className="w-4 h-4" />PDF</button>
        </div>
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">Chargement…</div>
        : isOffline && points.length === 0 ? <div className="text-center py-20 text-gray-400"><CloudOff className="w-12 h-12 mx-auto mb-3 text-gray-300" /><p>Aucune donnée hors ligne disponible.</p></div>
        : filteredPoints.length === 0 ? <div className="text-center py-20 text-gray-400">Aucune cotisation ne correspond aux filtres.</div>
        : <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {filteredPoints.map((point) => {
            const config = STATUS_CONFIG[point.quota_status] ?? STATUS_CONFIG.non_paye;
            const Icon = config.Icon;
            const remaining = Math.max(0, (point.quota_amount ?? 0) - (point.quota_paid ?? 0));
            const progress = point.quota_amount > 0 ? Math.min(100, (point.quota_paid / point.quota_amount) * 100) : 100;
            return <button key={point.id} onClick={() => setSelectedPoint(point)} className="w-full text-left px-4 sm:px-5 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.style}`}><Icon className="w-5 h-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><p className="font-medium text-gray-900 truncate">{point.name}</p><span className={`text-xs px-2 py-0.5 rounded-full ${config.style}`}>{config.label}</span></div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{point.driver?.full_name ?? 'Sans commercial'} · {point.zone || 'Zone non renseignée'}</p>
                <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} /></div>
              </div>
              <div className="text-right shrink-0"><p className="text-sm font-bold text-gray-900">{point.quota_amount === 0 ? 'Aucune cotisation' : formatFCFA(remaining)}</p><p className="text-xs text-gray-400">{point.quota_amount === 0 ? '0 FCFA dû' : `reste sur ${formatFCFA(point.quota_amount)}`}</p></div>
              <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
            </button>;
          })}
        </div>}

      {selectedPoint && <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedPoint(null)}>
        <div className="bg-white rounded-2xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-bold text-gray-900">{selectedPoint.name}</h3><p className="text-sm text-gray-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{selectedPoint.zone || selectedPoint.address || 'Localisation non renseignée'}</p></div><button onClick={() => setSelectedPoint(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
          <div className="grid grid-cols-3 gap-2 mb-5 text-center"><div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-500">Dû</p><p className="font-bold text-sm">{formatFCFA(selectedPoint.quota_amount)}</p></div><div className="bg-emerald-50 rounded-xl p-3"><p className="text-xs text-gray-500">Payé</p><p className="font-bold text-sm text-emerald-700">{formatFCFA(selectedPoint.quota_paid)}</p></div><div className="bg-red-50 rounded-xl p-3"><p className="text-xs text-gray-500">Reste</p><p className="font-bold text-sm text-red-700">{formatFCFA(Math.max(0, selectedPoint.quota_amount - selectedPoint.quota_paid))}</p></div></div>
          <div className="flex items-center gap-2 mb-2"><History className="w-4 h-4 text-gray-400" /><h4 className="text-sm font-semibold text-gray-700">Historique des versements</h4></div>
          {paymentHistory.length === 0 ? <p className="text-sm text-gray-400 bg-gray-50 rounded-xl p-4">Aucun versement enregistré.</p> : <div className="space-y-2">{paymentHistory.map((payment) => <div key={payment.id} className="border border-gray-100 rounded-xl p-3 flex justify-between gap-3"><div><p className="font-semibold text-gray-900">{formatFCFA(payment.amount_fcfa)}</p><p className="text-xs text-gray-500">{new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString('fr-FR')} · {PAYMENT_METHODS[payment.payment_method] ?? payment.payment_method}</p>{payment.collector?.full_name && <p className="text-xs text-gray-400">Collecté par {payment.collector.full_name}</p>}{payment.notes && <p className="text-xs text-gray-500 mt-1">{payment.notes}</p>}</div>{payment.receipt_number && <span className="text-xs text-gray-500">Reçu {payment.receipt_number}</span>}</div>)}</div>}
        </div>
      </div>}
    </div>
  );
}
