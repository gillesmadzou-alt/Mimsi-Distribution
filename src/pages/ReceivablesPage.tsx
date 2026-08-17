import { useEffect, useState, useCallback } from 'react';
import { supabase, Receivable, ReceivablePayment, Driver, SalesPoint, formatFCFA } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { useSync } from '@/contexts/SyncContext';
import {
  Wallet, X, Clock, CheckCircle2, AlertCircle, Phone,
  FileSpreadsheet, FileText, History, CloudOff,
} from 'lucide-react';
import { downloadExcelReport, downloadPdfReport } from '@/lib/exportUtils';

export default function ReceivablesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [receivables, setReceivables] = useState<(Receivable & { sales_point?: any; driver?: any; batch?: any })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDriverId, setFilterDriverId] = useState('');
  const [filterSalesPointId, setFilterSalesPointId] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [payError, setPayError] = useState('');
  const [payHistory, setPayHistory] = useState<ReceivablePayment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const canManage = (profile?.role ?? 1) >= 1;

  const loadReceivables = useCallback(async () => {
    setLoading(true);
    let driverIdFilter: string | null = null;
    if (profile?.role === 1) {
      if (isOffline || !navigator.onLine) {
        const cachedDriver = await getCachedPageData<string>(`receivables:driver:${profile.id}`);
        driverIdFilter = cachedDriver?.data ?? null;
      } else {
        const { data: d } = await supabase.from('drivers').select('id').eq('user_id', profile.id).maybeSingle();
        driverIdFilter = d?.id ?? null;
        if (driverIdFilter) await cachePageData(`receivables:driver:${profile.id}`, driverIdFilter);
      }
    }

    const result = await fetchWithCache('receivables', async () => {
      let q = supabase
        .from('receivables')
        .select('*, sales_point:sales_points(*), driver:drivers(full_name), batch:delivery_batches(batch_code)')
        .order('created_at', { ascending: false });
      if (filterStatus) q = q.eq('status', filterStatus);
      if (filterDriverId) q = q.eq('driver_id', filterDriverId);
      if (filterSalesPointId) q = q.eq('sales_point_id', filterSalesPointId);
      if (driverIdFilter) q = q.eq('driver_id', driverIdFilter);

      const { data } = await q;
      return data ?? [];
    });
    setReceivables(result.data ?? []);
    setLoading(false);
  }, [profile?.role, profile?.id, filterStatus, filterDriverId, filterSalesPointId, fetchWithCache, isOffline]);

  useEffect(() => {
    if (profile) loadReceivables();
  }, [loadReceivables, profile]);

  useEffect(() => {
    const loadFilters = async () => {
      if (isOffline || !navigator.onLine) {
        const cached = await getCachedPageData<{ drivers: Driver[]; salesPoints: SalesPoint[] }>('receivables:filters');
        setDrivers(cached?.data.drivers ?? []);
        setSalesPoints(cached?.data.salesPoints ?? []);
        return;
      }
      const [driversRes, pointsRes] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('sales_points').select('*').order('name'),
      ]);
      const driversData = driversRes.data ?? [];
      const salesPointsData = pointsRes.data ?? [];
      setDrivers(driversData);
      setSalesPoints(salesPointsData);
      await cachePageData('receivables:filters', { drivers: driversData, salesPoints: salesPointsData });
    };
    loadFilters();
  }, [isOffline]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('receivables_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivables' }, loadReceivables)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivable_payments' }, loadReceivables)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, loadReceivables)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadReceivables, isOffline]);



  const totalOutstanding = receivables.reduce((s, r) => s + (r.amount_fcfa - r.amount_paid), 0);
  const totalCollected = receivables.reduce((s, r) => s + r.amount_paid, 0);
  const totalAmount = receivables.reduce((s, r) => s + r.amount_fcfa, 0);

  const openPayment = async (r: Receivable) => {
    setSelectedReceivable(r);
    setPaymentAmount(r.amount_fcfa - r.amount_paid);
    setPaymentNotes('');
    setPayError('');
    setShowPayment(true);
    setLoadingHistory(true);
    if (isOffline || !navigator.onLine) {
      const cached = await getCachedPageData<ReceivablePayment[]>(`receivables:history:${r.id}`);
      setPayHistory(cached?.data ?? []);
    } else {
      const { data: hist } = await supabase
        .from('receivable_payments')
        .select('*')
        .eq('receivable_id', r.id)
        .order('payment_date', { ascending: false });
      const history = hist ?? [];
      setPayHistory(history);
      await cachePageData(`receivables:history:${r.id}`, history);
    }
    setLoadingHistory(false);
  };

  const STATUS_CONFIG: Record<string, { label: string; style: string; Icon: typeof Clock }> = {
    en_attente: { label: 'En attente', style: 'bg-amber-50 text-amber-700', Icon: Clock },
    partiel:    { label: 'Partiel',     style: 'bg-blue-50 text-blue-700',   Icon: AlertCircle },
    solde:      { label: 'Soldé',       style: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  };

  const buildExportRows = () =>
    receivables.map((r) => ({
      point: r.sales_point?.name ?? '',
      lot: r.batch?.batch_code ?? '',
      driver: r.driver?.full_name ?? '',
      total: r.amount_fcfa,
      paid: r.amount_paid,
      reste: r.amount_fcfa - r.amount_paid,
      statut: STATUS_CONFIG[r.status]?.label ?? r.status,
      date: new Date(r.created_at).toLocaleDateString('fr-FR'),
    }));

  const exportColumns = [
    { header: 'Point de vente', key: 'point' },
    { header: 'Lot', key: 'lot' },
    { header: 'commercial', key: 'driver' },
    { header: 'Montant total', key: 'total', align: 'right' as const },
    { header: 'Encaissé', key: 'paid', align: 'right' as const },
    { header: 'Reste', key: 'reste', align: 'right' as const },
    { header: 'Statut', key: 'statut' },
    { header: 'Date', key: 'date' },
  ];

  const handleExportExcel = () => {
    downloadExcelReport({
      title: 'Créances',
      columns: exportColumns,
      rows: buildExportRows(),
      summary: [
        { label: 'Total créances', value: formatFCFA(totalAmount) },
        { label: 'Encaissé', value: formatFCFA(totalCollected) },
        { label: 'Reste à encaisser', value: formatFCFA(totalOutstanding) },
      ],
      fileName: 'creances',
    });
  };

  const handleExportPdf = () => {
    downloadPdfReport({
      title: 'Rapport des créances',
      subtitle: [
        filterDriverId ? `Commercial: ${drivers.find((d) => d.id === filterDriverId)?.full_name ?? '—'}` : 'Commercial: Tous',
        filterSalesPointId ? `Point de vente: ${salesPoints.find((s) => s.id === filterSalesPointId)?.name ?? '—'}` : 'Point de vente: Tous',
        filterStatus ? `Statut: ${STATUS_CONFIG[filterStatus]?.label ?? filterStatus}` : 'Statut: Tous',
      ].join(' | '),
      columns: exportColumns,
      rows: buildExportRows().map((r) => ({
        ...r,
        total: formatFCFA(r.total),
        paid: formatFCFA(r.paid),
        reste: formatFCFA(r.reste),
      })),
      summary: [
        { label: 'Total créances', value: formatFCFA(totalAmount) },
        { label: 'Encaissé', value: formatFCFA(totalCollected) },
        { label: 'Reste à encaisser', value: formatFCFA(totalOutstanding) },
      ],
      fileName: 'creances',
    });
  };

  const { save } = useOfflineSave();
  const { syncNow } = useSync();

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReceivable) return;
    setPayError('');
    const remaining = selectedReceivable.amount_fcfa - selectedReceivable.amount_paid;
    const amount = Math.min(paymentAmount, remaining);

    if (amount <= 0) {
      setPayError('Le montant doit être supérieur à 0.');
      return;
    }

    const steps = buildSteps().insert('receivable_payments', {
      receivable_id: selectedReceivable.id,
      amount_fcfa: amount,
      notes: paymentNotes,
    }).getSteps();

    const result = await save('Encaissement de créance', 'receivables', steps, () => loadReceivables());
    if (result.offline) {
      toast('Hors-ligne : votre encaissement a été enregistré sur ce téléphone. Il sera synchronisé automatiquement dès le retour de la connexion.', 'info');
    }
    if (!result.offline) syncNow();

    setShowPayment(false);
    loadReceivables();
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">En attente</p>
              <p className="text-xl font-bold text-amber-700">{formatFCFA(totalOutstanding)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Encaissé</p>
              <p className="text-xl font-bold text-emerald-700">{formatFCFA(totalCollected)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total créances</p>
              <p className="text-xl font-bold text-gray-900">{formatFCFA(totalAmount)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterStatus ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Toutes
          </button>
          {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === val ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {cfg.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(profile?.role ?? 0) >= 2 && (
            <select value={filterDriverId} onChange={(e) => setFilterDriverId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none">
              <option value="">Tous les commerciaux</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          )}
          <select value={filterSalesPointId} onChange={(e) => setFilterSalesPointId(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="">Tous les points de vente</option>
            {salesPoints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="ml-auto flex gap-2">
            <button onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-all">
              <FileSpreadsheet className="w-4 h-4" />
              Excel
            </button>
            <button onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-all">
              <FileText className="w-4 h-4" />
              PDF
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && receivables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les créances.</p>
        </div>
      ) : receivables.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune créance</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {receivables.map((r) => {
            const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.en_attente;
            const StatusIcon = cfg.Icon;
            const remaining = r.amount_fcfa - r.amount_paid;
            const pct = r.amount_fcfa > 0 ? (r.amount_paid / r.amount_fcfa) * 100 : 0;
            return (
              <div key={r.id} className="px-5 py-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cfg.style}`}>
                  <StatusIcon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900">{r.sales_point?.name ?? '—'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.style}`}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span>Lot {r.batch?.batch_code ?? '—'}</span>
                    {r.driver?.full_name && <span>· {r.driver.full_name}</span>}
                    <span>· {new Date(r.created_at).toLocaleDateString('fr-FR')}</span>
                    {r.sales_point?.owner_phone && (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.sales_point.owner_phone}</span>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900">{formatFCFA(remaining)}</p>
                  <p className="text-xs text-gray-400">/ {formatFCFA(r.amount_fcfa)}</p>
                  <div className="mt-1 flex gap-1 justify-end">
                    <button onClick={() => onNavigate?.('batches')}
                      className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors">
                      Voir tournée
                    </button>
                    <button onClick={() => onNavigate?.('sales-points')}
                      className="px-2 py-1 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-medium hover:bg-cyan-100 transition-colors">
                      Voir PDV
                    </button>
                  </div>
                  {canManage && r.status !== 'solde' && (
                    <button onClick={() => openPayment(r)}
                      className="mt-1 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors">
                      Encaisser
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showPayment && selectedReceivable && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPayment(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Encaissement</h3>
              <button onClick={() => setShowPayment(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 mb-4 text-sm">
              <p className="text-gray-700"><span className="font-medium">{selectedReceivable.sales_point?.name}</span></p>
              <p className="text-gray-500 text-xs mt-0.5">Reste à encaisser : <span className="font-semibold text-amber-700">{formatFCFA(selectedReceivable.amount_fcfa - selectedReceivable.amount_paid)}</span></p>
            </div>

            {/* Payment history */}
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <History className="w-4 h-4 text-gray-400" />
                <h4 className="text-sm font-medium text-gray-600">Historique des encaissements</h4>
              </div>
              {loadingHistory ? (
                <p className="text-xs text-gray-400">Chargement…</p>
              ) : payHistory.length === 0 ? (
                <p className="text-xs text-gray-400">Aucun encaissement enregistré pour cette créance.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {payHistory.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatFCFA(p.amount_fcfa)}</p>
                        <p className="text-xs text-gray-400">{new Date(p.payment_date).toLocaleString('fr-FR')}</p>
                      </div>
                      {p.notes && <p className="text-xs text-gray-500 italic max-w-[60%] truncate">{p.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {payError && (
              <div className="bg-red-50 text-red-700 text-sm rounded-lg p-2.5 mb-3">{payError}</div>
            )}
            <form onSubmit={handlePayment} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Montant encaissé (FCFA)</label>
                <input type="number" min={1} max={selectedReceivable.amount_fcfa - selectedReceivable.amount_paid}
                  required value={paymentAmount || ''} onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Valider l'encaissement
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
