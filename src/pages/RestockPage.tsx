import { useEffect, useState, useCallback } from 'react';
import { supabase, RestockRequest, SalesPoint, PotType, formatFCFA } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Plus, X, Package, Clock, CheckCircle2, XCircle, MapPin, User as UserIcon, CloudOff
} from 'lucide-react';

export default function RestockPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<(RestockRequest & { sales_point?: SalesPoint; pot_type?: PotType; requester?: any })[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const [form, setForm] = useState({
    sales_point_id: '', pot_type_id: '', quantity: 0, notes: '',
  });

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const canManage = (profile?.role ?? 1) >= 2;
  const canTreat = (profile?.role ?? 1) >= 4;

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('restock-page', async () => {
      let q = supabase
        .from('restock_requests')
        .select('*, sales_point:sales_points(*), pot_type:pot_types(*), requester:profiles(full_name)')
        .order('created_at', { ascending: false });
      if (filterStatus) q = q.eq('status', filterStatus);
      const { data } = await q;

      const [spRes, ptRes] = await Promise.all([
        supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
        supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
      ]);

      return {
        requests: data ?? [],
        salesPoints: spRes.data ?? [],
        potTypes: ptRes.data ?? [],
      };
    });

    if (result.data) {
      setRequests(result.data.requests);
      setSalesPoints(result.data.salesPoints);
      setPotTypes(result.data.potTypes);
    }
    setLoading(false);
  }, [fetchWithCache, filterStatus]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useRealtimeSubscription('restock-page', isOffline ? [] : ['restock_requests', 'sales_points', 'pot_types'], loadAll);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('restock_requests').insert({
      sales_point_id: form.sales_point_id,
      pot_type_id: form.pot_type_id,
      quantity: form.quantity,
      notes: form.notes,
    });
    setShowModal(false);
    setForm({ sales_point_id: '', pot_type_id: '', quantity: 0, notes: '' });
    loadAll();
  };

  const treat = async (req: RestockRequest, status: 'traitee' | 'annulee') => {
    await supabase.from('restock_requests')
      .update({
        status,
        treated_by: (await supabase.auth.getUser()).data.user?.id,
        treated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id);
    loadAll();
  };

  const STATUS_CONFIG: Record<string, { label: string; style: string; Icon: typeof Clock }> = {
    en_attente: { label: 'En attente', style: 'bg-amber-50 text-amber-700', Icon: Clock },
    traitee:    { label: 'Traitée',     style: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
    annulee:    { label: 'Annulée',     style: 'bg-gray-100 text-gray-500', Icon: XCircle },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
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
        {canManage && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            Nouvelle demande
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les réapprovisionnements.</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune demande de réapprovisionnement</div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const cfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.en_attente;
            const StatusIcon = cfg.Icon;
            return (
              <div key={req.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cfg.style}`}>
                    <StatusIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{req.sales_point?.name ?? '—'}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.style}`}>{cfg.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                      <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {req.pot_type?.name ?? '—'} × {req.quantity}</span>
                      <span>· {formatFCFA((req.pot_type?.unit_price_fcfa ?? 0) * req.quantity)}</span>
                      <span>· {new Date(req.created_at).toLocaleDateString('fr-FR')}</span>
                      {req.requester?.full_name && <span>· par {req.requester.full_name}</span>}
                    </div>
                    {req.notes && <p className="text-sm text-gray-600 mt-1 italic">{req.notes}</p>}
                    {req.treated_at && (
                      <p className="text-xs text-emerald-600 mt-1">Traitée le {new Date(req.treated_at).toLocaleString('fr-FR')}</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => onNavigate?.('stock')}
                        className="text-xs text-blue-600 hover:underline font-medium">Voir stock</button>
                      <span className="text-gray-300">·</span>
                      <button onClick={() => onNavigate?.('sales-points')}
                        className="text-xs text-blue-600 hover:underline font-medium">Voir PDV</button>
                    </div>
                  </div>
                  {canTreat && req.status === 'en_attente' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => treat(req, 'traitee')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Traiter
                      </button>
                      <button onClick={() => treat(req, 'annulee')}
                        className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Annuler
                      </button>
                    </div>
                  )}
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
              <h3 className="text-lg font-bold text-gray-900">Demande de réapprovisionnement</h3>
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
                  {salesPoints.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.district})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
                <select required value={form.pot_type_id} onChange={(e) => setForm({ ...form, pot_type_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name} (stock: {p.stock_quantity})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
                <input type="number" min={1} required value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Créer la demande
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
