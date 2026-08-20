import { useEffect, useState, useCallback } from 'react';
import { supabase, Consignment, SalesPoint, DeliveryBatch } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import {
  Package, Plus, X, Undo2, MapPin, AlertTriangle, CloudOff
} from 'lucide-react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

export default function ConsignmentsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const [consignments, setConsignments] = useState<(Consignment & { sales_point?: SalesPoint })[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [selectedConsignment, setSelectedConsignment] = useState<Consignment | null>(null);
  const [returnQty, setReturnQty] = useState(0);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const [form, setForm] = useState({
    sales_point_id: '', batch_id: '', quantity_deposited: 0, notes: '',
  });

  const canManage = (profile?.role ?? 1) >= 2;

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('consignments-page', async () => {
      const [consRes, spRes, batchRes] = await Promise.all([
        supabase.from('consignments').select('*, sales_point:sales_points(*)').order('deposited_at', { ascending: false }),
        supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
        supabase.from('delivery_batches').select('*').eq('status', 'actif').order('created_at', { ascending: false }),
      ]);
      return { consignments: consRes.data ?? [], salesPoints: spRes.data ?? [], batches: batchRes.data ?? [] };
    });
    if (result.data) {
      setConsignments(Array.isArray(result.data.consignments) ? result.data.consignments : []);
      setSalesPoints(Array.isArray(result.data.salesPoints) ? result.data.salesPoints : []);
      setBatches(Array.isArray(result.data.batches) ? result.data.batches : []);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useRealtimeSubscription('consignments-page', isOffline ? [] : ['consignments', 'consignment_returns', 'delivery_batches'], loadAll);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('consignments').insert({
      sales_point_id: form.sales_point_id,
      batch_id: form.batch_id || null,
      quantity_deposited: form.quantity_deposited,
      notes: form.notes,
    });
    setShowModal(false);
    setForm({ sales_point_id: '', batch_id: '', quantity_deposited: 0, notes: '' });
    loadAll();
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsignment) return;
    await supabase.from('consignment_returns').insert({
      consignment_id: selectedConsignment.id,
      quantity: returnQty,
    });
    await supabase.rpc('increment_consignment_return', {
      p_consignment_id: selectedConsignment.id,
      p_quantity: returnQty,
    });
    setShowReturn(false);
    setReturnQty(0);
    setSelectedConsignment(null);
    loadAll();
  };

  const totalOut = consignments.reduce((s, c) => s + (c.quantity_deposited - c.quantity_returned), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
            <Package className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Contenants en circulation</p>
            <p className="text-2xl font-bold text-gray-900">{totalOut}</p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            Nouvelle consigne
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && consignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les consignations.</p>
        </div>
      ) : consignments.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune consigne enregistrée</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {consignments.map((c) => {
            const outstanding = c.quantity_deposited - c.quantity_returned;
            const pct = c.quantity_deposited > 0 ? (c.quantity_returned / c.quantity_deposited) * 100 : 0;
            return (
              <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                      <Package className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">{c.sales_point?.name ?? '—'}</h3>
                      <p className="text-xs text-gray-500">{new Date(c.deposited_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                  </div>
                  {outstanding > 0 && canManage && (
                    <button onClick={() => { setSelectedConsignment(c); setReturnQty(0); setShowReturn(true); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                      <Undo2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-500">Déposés: <span className="font-semibold text-gray-900">{c.quantity_deposited}</span></span>
                  <span className="text-gray-500">Rendus: <span className="font-semibold text-emerald-700">{c.quantity_returned}</span></span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className={`text-sm font-semibold ${outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {outstanding > 0 ? `${outstanding} en circulation` : 'Tout rendu'}
                  </span>
                  {outstanding > 5 && (
                    <span className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" /> À relancer
                    </span>
                  )}
                </div>
                {c.notes && <p className="text-xs text-gray-400 mt-2 italic">{c.notes}</p>}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => onNavigate?.('batches')}
                    className="text-xs text-blue-600 hover:underline font-medium">Voir tournée</button>
                  <span className="text-gray-300">·</span>
                  <button onClick={() => onNavigate?.('sales-points')}
                    className="text-xs text-blue-600 hover:underline font-medium">Voir PDV</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle consigne</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Point de vente</label>
                <select required value={form.sales_point_id} onChange={(e) => setForm({ ...form, sales_point_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {salesPoints.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lot (optionnel)</label>
                <select value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Aucun —</option>
                  {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_code}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité déposée</label>
                <input type="number" min={1} required value={form.quantity_deposited || ''} onChange={(e) => setForm({ ...form, quantity_deposited: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Créer la consigne
              </button>
            </form>
          </div>
        </div>
      )}

      {showReturn && selectedConsignment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowReturn(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Retour de contenants</h3>
              <button onClick={() => setShowReturn(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 mb-4 text-sm">
              <p className="text-gray-700">{selectedConsignment.sales_point?.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">En circulation : {selectedConsignment.quantity_deposited - selectedConsignment.quantity_returned}</p>
            </div>
            <form onSubmit={handleReturn} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité rendue</label>
                <input type="number" min={1} max={selectedConsignment.quantity_deposited - selectedConsignment.quantity_returned}
                  required value={returnQty || ''} onChange={(e) => setReturnQty(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Valider le retour
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
