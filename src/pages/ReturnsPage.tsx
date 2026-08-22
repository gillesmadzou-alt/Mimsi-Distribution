import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, Return, DeliveryBatch, SalesPoint, Driver, PotType, ReturnPotType } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { mergePendingSalesPoints } from '@/lib/offlineSalesPoints';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { useSync } from '@/contexts/SyncContext';
import {
  Plus, X, Undo2, Package, AlertCircle, Trash2, CloudOff
} from 'lucide-react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

const REASON_LABELS: Record<string, string> = {
  peremption: 'Péremption', invendu: 'Invendu', casse: 'Casse', autre: 'Autre',
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  pots: 'Pots', madeleines: 'Madeleines', both: 'Pots + Madeleines',
};

const ITEM_TYPE_STYLES: Record<string, string> = {
  pots: 'bg-blue-50 text-blue-700',
  madeleines: 'bg-amber-50 text-amber-700',
  both: 'bg-violet-50 text-violet-700',
};

const REASON_STYLES: Record<string, string> = {
  peremption: 'bg-red-50 text-red-700', invendu: 'bg-amber-50 text-amber-700',
  casse: 'bg-rose-50 text-rose-700', autre: 'bg-gray-100 text-gray-600',
};

interface PotTypeRow {
  pot_type_id: string;
  quantity: number;
  empty_pots: number;
  empty_lids: number;
  madeleine_count: number;
}

export default function ReturnsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [returns, setReturns] = useState<(Return & { sales_point?: SalesPoint; batch?: DeliveryBatch; return_pot_types?: ReturnPotType[] })[]>([]);
  const [batches, setBatches] = useState<(DeliveryBatch & { pot_type?: any })[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterReason, setFilterReason] = useState<string>('all');
  const [filterDriverId, setFilterDriverId] = useState<string>('all');
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const [form, setForm] = useState({
    batch_id: '',
    sales_point_id: '',
    item_type: 'pots' as 'pots' | 'madeleines' | 'both',
    reason: 'invendu' as string,
    notes: '',
  });
  const [potRows, setPotRows] = useState<PotTypeRow[]>([]);

  const canCreate = (profile?.role ?? 1) >= 2;

  const loadAll = useCallback(async () => {
    setLoading(true);
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

    let returnsQuery = supabase
      .from('returns')
      .select('*, sales_point:sales_points(*), batch:delivery_batches(*), return_pot_types(*)')
      .order('returned_at', { ascending: false });

    const result = await fetchWithCache('returns-page-all', async () => {
      const [returnsRes, batchesRes, pointsRes, driversRes, potsRes] = await Promise.all([
        returnsQuery,
        supabase.from('delivery_batches')
          .select('*, pot_type:pot_types(*)')
          .in('status', ['actif', 'cloture'])
          .order('created_at', { ascending: false }),
        supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
      ]);

      return {
        returns: returnsRes.data ?? [],
        batches: batchesRes.data ?? [],
        salesPoints: pointsRes.data ?? [],
        drivers: driversRes.data ?? [],
        potTypes: potsRes.data ?? [],
      };
    });

    if (result.data) {
      setReturns(Array.isArray(result.data.returns) ? result.data.returns : []);
      setBatches(Array.isArray(result.data.batches) ? result.data.batches : []);
      setSalesPoints(await mergePendingSalesPoints(Array.isArray(result.data.salesPoints) ? result.data.salesPoints : []));
      setDrivers(Array.isArray(result.data.drivers) ? result.data.drivers : []);
      setPotTypes(Array.isArray(result.data.potTypes) ? result.data.potTypes : []);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useRealtimeSubscription('returns-page', isOffline ? [] : ['returns', 'return_pot_types', 'delivery_batches', 'pot_types'], loadAll);

  const addPotRow = () => {
    if (potTypes.length === 0) return;
    const usedIds = new Set(potRows.map((r) => r.pot_type_id));
    const available = potTypes.find((p) => !usedIds.has(p.id));
    if (!available) return;
    setPotRows([...potRows, { pot_type_id: available.id, quantity: 0, empty_pots: 0, empty_lids: 0, madeleine_count: 0 }]);
  };

  const updatePotRow = (index: number, field: keyof PotTypeRow, value: number | string) => {
    const updated = [...potRows];
    (updated[index] as any)[field] = typeof value === 'string' ? value : value;
    setPotRows(updated);
  };

  const removePotRow = (index: number) => {
    setPotRows(potRows.filter((_, i) => i !== index));
  };

  const { save } = useOfflineSave();
  const { syncNow } = useSync();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const totalQty = potRows.reduce((s, r) => s + r.quantity, 0);
    const totalEmptyPots = potRows.reduce((s, r) => s + r.empty_pots, 0);
    const totalEmptyLids = potRows.reduce((s, r) => s + r.empty_lids, 0);
    const totalMadeleines = potRows.reduce((s, r) => s + r.madeleine_count, 0);

    const batch = batches.find((b) => b.id === form.batch_id);

    const steps = buildSteps()
      .insertSingle('returns', {
        batch_id: form.batch_id,
        sales_point_id: form.sales_point_id,
        quantity: totalQty,
        empty_pots: totalEmptyPots,
        empty_lids: totalEmptyLids,
        madeleine_count: totalMadeleines,
        item_type: form.item_type,
        reason: form.reason,
        notes: form.notes,
      }, { id: 'return' })
      .getSteps();

    if (potRows.length > 0) {
      steps.push({
        id: 'return_pot_types',
        table: 'return_pot_types',
        operation: 'insert',
        body: potRows.map((r) => ({
          return_id: '__pending__',
          pot_type_id: r.pot_type_id,
          quantity: r.quantity,
          empty_pots: r.empty_pots,
          empty_lids: r.empty_lids,
          madeleine_count: r.madeleine_count,
        })),
        dependsOn: 'return',
        injectField: 'return_id',
      });
    }

    if (batch) {
      steps.push({
        id: 'batch_update',
        table: 'delivery_batches',
        operation: 'update',
        body: { pots_returned: batch.pots_returned + totalQty },
        filter: { column: 'id', value: batch.id },
      });
      steps.push({
        id: 'stock_movement',
        table: 'stock_movements',
        operation: 'insert',
        body: {
          pot_type_id: batch.pot_type_id,
          movement_type: 'retour',
          quantity: totalQty,
          reference_id: '__pending__',
          notes: `Retour lot ${batch.batch_code}`,
        },
        dependsOn: 'return',
        injectField: 'reference_id',
      });
      steps.push({
        id: 'pot_type_update',
        table: 'pot_types',
        operation: 'update',
        body: { stock_quantity: (batch.pot_type?.stock_quantity ?? 0) + totalQty },
        filter: { column: 'id', value: batch.pot_type_id },
      });
      steps.push({
        id: 'delivery_event',
        table: 'delivery_events',
        operation: 'insert',
        body: {
          event_type: 'retour',
          batch_id: form.batch_id,
          driver_id: batch.driver_id,
          sales_point_id: form.sales_point_id,
          quantity: totalQty,
          description: `Retour de ${totalQty} pots (${form.reason}) — ${batch.batch_code}`,
        },
      });
    }

    const result = await save('Retour de pots', 'returns', steps, () => loadAll());
    if (result.offline) {
      toast('Hors-ligne : votre retour a été enregistré sur ce téléphone. Il sera synchronisé automatiquement dès le retour de la connexion.', 'info');
    } else if (result.queued) {
      toast('Sauvegarde temporairement en file d\'attente. Elle sera synchronisée automatiquement.', 'info');
    }
    if (!result.offline) syncNow();

    setShowModal(false);
    setForm({ batch_id: '', sales_point_id: '', item_type: 'pots', reason: 'invendu', notes: '' });
    setPotRows([]);
    loadAll();
  };

  const driverMap = useMemo(() => {
    const m = new Map<string, string>();
    batches.forEach((b) => m.set(b.id, b.driver_id));
    return m;
  }, [batches]);

  const filtered = returns.filter((r) => {
    const matchReason = filterReason === 'all' || r.reason === filterReason;
    const matchDriver = filterDriverId === 'all' || driverMap.get(r.batch_id) === filterDriverId;
    return matchReason && matchDriver;
  });

  const totalReturns = filtered.reduce((s, r) => s + r.quantity, 0);
  const totalMadeleines = filtered.reduce((s, r) => s + (r.madeleine_count ?? 0), 0);
  const totalEmptyPots = filtered.reduce((s, r) => s + (r.empty_pots ?? 0), 0);
  const totalEmptyLids = filtered.reduce((s, r) => s + (r.empty_lids ?? 0), 0);

  // Per-pot-type breakdown across filtered returns
  const potTypeBreakdown = useMemo(() => {
    const map = new Map<string, { quantity: number; empty_pots: number; empty_lids: number; madeleine_count: number }>();
    filtered.forEach((r) => {
      (r.return_pot_types ?? []).forEach((rpt) => {
        const existing = map.get(rpt.pot_type_id) ?? { quantity: 0, empty_pots: 0, empty_lids: 0, madeleine_count: 0 };
        existing.quantity += rpt.quantity;
        existing.empty_pots += rpt.empty_pots;
        existing.empty_lids += rpt.empty_lids;
        existing.madeleine_count += rpt.madeleine_count;
        map.set(rpt.pot_type_id, existing);
      });
    });
    return map;
  }, [filtered]);

  const potTypeName = (id: string) => potTypes.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={() => setFilterReason('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filterReason === 'all' ? 'bg-amber-500 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            Tous ({returns.length})
          </button>
          {Object.entries(REASON_LABELS).map(([val, label]) => (
            <button key={val} onClick={() => setFilterReason(val)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filterReason === val ? 'bg-amber-500 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {label}
            </button>
          ))}
          {(profile?.role ?? 1) >= 2 && (
            <select value={filterDriverId} onChange={(e) => setFilterDriverId(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterDriverId !== 'all' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-gray-200 text-gray-600'}`}>
              <option value="all">Tous les commerciaux</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          )}
        </div>
        {canCreate && (
          <button onClick={() => { setPotRows([]); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            Nouveau retour
          </button>
        )}
      </div>

      {/* Summary card */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center">
            <Undo2 className="w-6 h-6 text-rose-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-500">Total retours / invendus</p>
            <div className="flex items-baseline gap-4 flex-wrap">
              <p className="text-2xl font-bold text-gray-900">{totalReturns} <span className="text-sm font-normal text-gray-400">pots prêts</span></p>
              <p className="text-xl font-bold text-amber-700">{totalEmptyPots} <span className="text-sm font-normal text-gray-400">pots vides</span></p>
              <p className="text-xl font-bold text-cyan-700">{totalEmptyLids} <span className="text-sm font-normal text-gray-400">couvercles</span></p>
              <p className="text-xl font-bold text-amber-600">{totalMadeleines} <span className="text-sm font-normal text-gray-400">madeleines</span></p>
            </div>
          </div>
        </div>

        {/* Per-pot-type breakdown */}
        {potTypeBreakdown.size > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Détail par type de pot</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Array.from(potTypeBreakdown.entries()).map(([potId, vals]) => (
                <div key={potId} className="bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-sm font-semibold text-gray-800">{potTypeName(potId)}</p>
                  <div className="flex gap-3 flex-wrap mt-1 text-xs text-gray-600">
                    {vals.quantity > 0 && <span className="text-rose-600 font-medium">{vals.quantity} prêts</span>}
                    {vals.empty_pots > 0 && <span className="text-amber-700 font-medium">{vals.empty_pots} vides</span>}
                    {vals.empty_lids > 0 && <span className="text-cyan-700 font-medium">{vals.empty_lids} couvercles</span>}
                    {vals.madeleine_count > 0 && <span className="text-amber-600 font-medium">{vals.madeleine_count} madeleines</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && returns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les retours.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucun retour enregistré</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="divide-y divide-gray-50">
            {filtered.map((ret) => (
              <div key={ret.id} className="px-5 py-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                  <Undo2 className="w-5 h-5 text-rose-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{ret.sales_point?.name ?? '—'}</p>
                    {ret.item_type && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ITEM_TYPE_STYLES[ret.item_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ITEM_TYPE_LABELS[ret.item_type] ?? ret.item_type}
                      </span>
                    )}
                    {ret.reason && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${REASON_STYLES[ret.reason]}`}>
                        {REASON_LABELS[ret.reason] ?? ret.reason}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Lot {ret.batch?.batch_code ?? '—'} · {new Date(ret.returned_at).toLocaleString('fr-FR')}
                    {ret.notes ? ` · ${ret.notes}` : ''}
                  </p>
                  {/* Per-pot-type detail for this return */}
                  {ret.return_pot_types && ret.return_pot_types.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ret.return_pot_types.map((rpt) => (
                        <span key={rpt.id} className="text-xs bg-gray-100 rounded-lg px-2 py-1 text-gray-700">
                          <span className="font-medium">{potTypeName(rpt.pot_type_id)}</span>
                          {rpt.quantity > 0 && <span className="text-rose-600"> · {rpt.quantity} prêts</span>}
                          {rpt.empty_pots > 0 && <span className="text-amber-700"> · {rpt.empty_pots} vides</span>}
                          {rpt.empty_lids > 0 && <span className="text-cyan-700"> · {rpt.empty_lids} couvercles</span>}
                          {rpt.madeleine_count > 0 && <span className="text-amber-600"> · {rpt.madeleine_count} madeleines</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="flex flex-col gap-1 items-end">
                    <div className="flex gap-1">
                      <button onClick={() => onNavigate?.('batches')}
                        className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors">
                        Voir tournée
                      </button>
                      <button onClick={() => onNavigate?.('stock')}
                        className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors">
                        Voir stock
                      </button>
                    </div>
                  </div>
                  {ret.quantity > 0 && (
                    <>
                      <p className="text-lg font-bold text-rose-600">{ret.quantity}</p>
                      <p className="text-xs text-gray-400">pots prêts</p>
                    </>
                  )}
                  {(ret.empty_pots ?? 0) > 0 && (
                    <p className={`text-sm font-medium text-amber-700 ${ret.quantity > 0 ? 'mt-0.5' : 'text-lg font-bold'}`}>{ret.empty_pots} <span className="text-xs text-gray-400">vides</span></p>
                  )}
                  {(ret.empty_lids ?? 0) > 0 && (
                    <p className={`text-sm font-medium text-cyan-700 ${ret.quantity > 0 || (ret.empty_pots ?? 0) > 0 ? 'mt-0.5' : 'text-lg font-bold'}`}>{ret.empty_lids} <span className="text-xs text-gray-400">couvercles</span></p>
                  )}
                  {ret.madeleine_count > 0 && (
                    <p className={`text-sm font-medium text-amber-600 ${ret.quantity > 0 || (ret.empty_pots ?? 0) > 0 || (ret.empty_lids ?? 0) > 0 ? 'mt-0.5' : 'text-lg font-bold'}`}>{ret.madeleine_count} <span className="text-xs text-gray-400">madeleines</span></p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Nouveau retour / invendu</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lot de livraison</label>
                <select required value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_code} ({b.pot_type?.name ?? '—'})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Point de vente</label>
                <select required value={form.sales_point_id} onChange={(e) => setForm({ ...form, sales_point_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {salesPoints.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.district})</option>)}
                </select>
                {salesPoints.length === 0 && <p className="mt-1 text-xs text-amber-700">Aucun point de vente actif disponible. Connectez-vous puis créez ou activez le point de vente.</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de retour</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['pots', 'madeleines', 'both'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setForm({ ...form, item_type: t })}
                      className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                        form.item_type === t
                          ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {ITEM_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-pot-type rows */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Détail par type de pot</label>
                  <button type="button" onClick={addPotRow}
                    className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium">
                    <Plus className="w-3.5 h-3.5" /> Ajouter un type
                  </button>
                </div>
                {potRows.length === 0 ? (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                    Aucun type ajouté. Cliquez sur « Ajouter un type » pour détailler les retours par type de pot.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {potRows.map((row, idx) => {
                      const usedIds = new Set(potRows.filter((_, i) => i !== idx).map((r) => r.pot_type_id));
                      return (
                        <div key={idx} className="bg-gray-50 rounded-xl p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <select value={row.pot_type_id} onChange={(e) => updatePotRow(idx, 'pot_type_id', e.target.value)}
                              className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500">
                              {potTypes.filter((p) => !usedIds.has(p.id) || p.id === row.pot_type_id).map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => removePotRow(idx)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">Prêts</label>
                              <input type="number" min={0} value={row.quantity || ''} onChange={(e) => updatePotRow(idx, 'quantity', Number(e.target.value))}
                                placeholder="0"
                                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">Vides</label>
                              <input type="number" min={0} value={row.empty_pots || ''} onChange={(e) => updatePotRow(idx, 'empty_pots', Number(e.target.value))}
                                placeholder="0"
                                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">Couvercles</label>
                              <input type="number" min={0} value={row.empty_lids || ''} onChange={(e) => updatePotRow(idx, 'empty_lids', Number(e.target.value))}
                                placeholder="0"
                                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">Madeleines</label>
                              <input type="number" min={0} value={row.madeleine_count || ''} onChange={(e) => updatePotRow(idx, 'madeleine_count', Number(e.target.value))}
                                placeholder="0"
                                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Raison</label>
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  {Object.entries(REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Enregistrer le retour
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
