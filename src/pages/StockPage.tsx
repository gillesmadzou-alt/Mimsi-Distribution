import { useEffect, useState, useCallback } from 'react';
import { supabase, PotType, PotShape, POT_SHAPE_LABELS, formatFCFA, Driver, Baker, StockMovement, DeliveryBatch } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  Plus, Package, AlertTriangle, TrendingUp, TrendingDown, X, Edit2, History, Archive, Disc, Cookie, ArrowRight, CloudOff,
} from 'lucide-react';

type StockKind = 'ready' | 'empty_pots' | 'empty_lids' | 'madeleines';

const STOCK_KIND_LABELS: Record<StockKind, string> = {
  ready: 'Pots prêts',
  empty_pots: 'Pots vides',
  empty_lids: 'Couvercles',
  madeleines: 'Madeleines',
};

const STOCK_KIND_ICON: Record<StockKind, typeof Package> = {
  ready: Package,
  empty_pots: Archive,
  empty_lids: Disc,
  madeleines: Cookie,
};

export default function StockPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [pots, setPots] = useState<PotType[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showMovement, setShowMovement] = useState(false);
  const [editing, setEditing] = useState<PotType | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [form, setForm] = useState({
    name: '', madeleine_count: 12, shape: 'pot' as PotShape, unit_price_fcfa: 1500,
    stock_quantity: 0, empty_pots_stock: 0, empty_lids_stock: 0, madeleines_stock: 0,
    low_stock_threshold: 20, is_active: true,
  });

  const [movement, setMovement] = useState({
    pot_type_id: '', stock_kind: 'ready' as StockKind, movement_type: 'entree' as 'entree' | 'attribution' | 'retour' | 'ajustement',
    quantity: 0, notes: '', driver_id: '', baker_id: '', batch_id: '',
  });

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const role = profile?.role ?? 1;
  const canRecordStock = [2, 4, 5, 6].includes(role);
  const canManageOptions = [4, 5, 6].includes(role);

  const loadPots = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchWithCache('stock:pot_types', () =>
        supabase.from('pot_types').select('*').order('name').then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
      );
      if (result.error) throw new Error(result.error);
      setPots(result.data ?? []);
    } catch {
      setLoadError('Erreur lors du chargement du stock.');
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => {
    loadPots();
    loadPersonnel();
  }, [loadPots]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('stock_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pot_types' }, loadPots)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, loadPots)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPots, isOffline]);

  const loadPersonnel = useCallback(async () => {
    if (isOffline || !navigator.onLine) {
      const cached = await getCachedPageData<{drivers: Driver[]; bakers: Baker[]; batches: DeliveryBatch[]}>('stock:personnel');
      if (cached) {
        setDrivers(cached.data.drivers ?? []);
        setBakers(cached.data.bakers ?? []);
        setBatches(cached.data.batches ?? []);
      }
      return;
    }
    try {
      const [dRes, bRes, batchRes] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('delivery_batches').select('*').in('status', ['actif', 'cloture']).order('batch_date', { ascending: false }).limit(50),
      ]);
      const driversData = dRes.data ?? [];
      const bakersData = bRes.data ?? [];
      const batchesData = batchRes.data ?? [];
      setDrivers(driversData);
      setBakers(bakersData);
      setBatches(batchesData);
      await cachePageData('stock:personnel', { drivers: driversData, bakers: bakersData, batches: batchesData });
    } catch {
      setLoadError('Erreur lors du chargement du personnel.');
    }
  }, [isOffline]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', madeleine_count: 12, shape: 'pot', unit_price_fcfa: 1500, stock_quantity: 0, empty_pots_stock: 0, empty_lids_stock: 0, madeleines_stock: 0, low_stock_threshold: 20, is_active: true });
    setShowModal(true);
  };

  const openEdit = (pot: PotType) => {
    setEditing(pot);
    setForm({
      name: pot.name, madeleine_count: pot.madeleine_count, shape: pot.shape,
      unit_price_fcfa: pot.unit_price_fcfa, stock_quantity: pot.stock_quantity,
      empty_pots_stock: pot.empty_pots_stock ?? 0, empty_lids_stock: pot.empty_lids_stock ?? 0,
      madeleines_stock: pot.madeleines_stock ?? 0,
      low_stock_threshold: pot.low_stock_threshold, is_active: pot.is_active,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      const { error } = await supabase.from('pot_types').update(form).eq('id', editing.id);
      if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
    } else {
      const { error } = await supabase.from('pot_types').insert(form);
      if (error) { toast('Erreur lors de la création.', 'error'); return; }
    }
    setShowModal(false);
    loadPots();
  };

  const openMovement = (pot?: PotType) => {
    setMovement({
      pot_type_id: pot?.id ?? '', stock_kind: 'ready', movement_type: 'entree',
      quantity: 0, notes: '', driver_id: '', baker_id: '', batch_id: '',
    });
    setShowMovement(true);
  };

  const handleMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEntree = movement.movement_type === 'entree' || movement.movement_type === 'retour';
    const delta = isEntree ? movement.quantity : -movement.quantity;

    const stockField = movement.stock_kind === 'ready' ? 'stock_quantity'
      : movement.stock_kind === 'empty_pots' ? 'empty_pots_stock'
      : movement.stock_kind === 'empty_lids' ? 'empty_lids_stock'
      : 'madeleines_stock';

    const insertData: Record<string, unknown> = {
      pot_type_id: movement.pot_type_id,
      movement_type: movement.movement_type,
      item_type: 'pots',
      quantity: movement.quantity,
      notes: `${STOCK_KIND_LABELS[movement.stock_kind]} — ${movement.notes}`,
    };
    if (movement.movement_type === 'attribution' && movement.driver_id) {
      insertData.driver_id = movement.driver_id;
    }
    if (movement.movement_type === 'entree' && movement.baker_id) {
      insertData.baker_id = movement.baker_id;
    }
    if (movement.movement_type === 'retour') {
      if (!movement.batch_id) {
        toast('Sélectionnez le lot d’origine pour tracer ce retour.', 'error');
        return;
      }
      insertData.batch_id = movement.batch_id;
      const batch = batches.find((candidate) => candidate.id === movement.batch_id);
      if (batch?.driver_id) insertData.driver_id = batch.driver_id;
    }

    const { error: mvErr } = await supabase.from('stock_movements').insert(insertData);
    if (mvErr) {
      console.error('stock movement insert failed:', mvErr);
      toast('Erreur lors de l\'enregistrement du mouvement.', 'error');
      return;
    }

    const { error: updErr } = await supabase.rpc('adjust_pot_stock', {
      p_pot_type_id: movement.pot_type_id,
      p_column: stockField,
      p_delta: delta,
    });

    setShowMovement(false);
    loadPots();
  };

  const loadHistory = async () => {
    if (isOffline || !navigator.onLine) {
      const cached = await getCachedPageData<StockMovement[]>('stock:history');
      setMovements(cached?.data ?? []);
      setShowHistory(true);
      return;
    }
    const { data } = await supabase
      .from('stock_movements')
      .select('*, pot_type:pot_types(name), driver:drivers(full_name), baker:bakers(full_name), batch:delivery_batches(batch_code, batch_date, driver:drivers(full_name))')
      .order('created_at', { ascending: false })
      .limit(50);
    const history = (data as StockMovement[]) ?? [];
    setMovements(history);
    await cachePageData('stock:history', history);
    setShowHistory(true);
  };

  const MOVEMENT_LABELS: Record<string, string> = {
    entree: 'Entrée', attribution: 'Attribution', retour: 'Retour', ajustement: 'Ajustement',
  };

  const getStockValue = (pot: PotType, kind: StockKind): number => {
    if (kind === 'ready') return pot.stock_quantity;
    if (kind === 'empty_pots') return pot.empty_pots_stock ?? 0;
    if (kind === 'empty_lids') return pot.empty_lids_stock ?? 0;
    return pot.madeleines_stock ?? 0;
  };

  const showDriverField = movement.movement_type === 'attribution';
  const showBakerField = movement.movement_type === 'entree';
  const showBatchField = movement.movement_type === 'retour';
  const today = new Date().toISOString().slice(0, 10);
  const todayBatches = batches.filter((batch) => batch.batch_date === today);
  const recentBatches = batches.filter((batch) => batch.batch_date !== today);

  const selectReturnBatch = (batchId: string) => {
    const batch = batches.find((candidate) => candidate.id === batchId);
    setMovement({
      ...movement,
      batch_id: batchId,
      pot_type_id: batch?.pot_type_id ?? movement.pot_type_id,
      driver_id: batch?.driver_id ?? movement.driver_id,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <button onClick={loadHistory}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-all">
          <History className="w-5 h-5" />
          Historique
        </button>
        <div className="flex gap-2">
          <button onClick={() => onNavigate?.('production')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-all">
            <ArrowRight className="w-5 h-5" />
            Voir production
          </button>
          {canRecordStock && (
            <button onClick={() => openMovement()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-all">
              <TrendingUp className="w-5 h-5" />
              Mouvement
            </button>
          )}
          {canManageOptions && (
            <button onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <Plus className="w-5 h-5" />
              Nouveau type
            </button>
          )}
        </div>
      </div>

      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && pots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le stock.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pots.map((pot) => {
            const readyLow = pot.stock_quantity <= pot.low_stock_threshold;
            const emptyLow = (pot.empty_pots_stock ?? 0) <= pot.low_stock_threshold;
            const lidsLow = (pot.empty_lids_stock ?? 0) <= pot.low_stock_threshold;
            const madeleineLow = (pot.madeleines_stock ?? 0) <= pot.low_stock_threshold;
            const anyLow = readyLow || emptyLow || lidsLow || madeleineLow;
            return (
              <div key={pot.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${anyLow ? 'bg-red-100' : 'bg-emerald-100'}`}>
                      <Package className={`w-6 h-6 ${anyLow ? 'text-red-600' : 'text-emerald-600'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{pot.name}</h3>
                      <p className="text-xs text-gray-500">{POT_SHAPE_LABELS[pot.shape]} · {pot.madeleine_count} madeleines · {formatFCFA(pot.unit_price_fcfa)}</p>
                    </div>
                  </div>
                  {canManageOptions && (
                    <button onClick={() => openEdit(pot)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['ready', 'empty_pots', 'empty_lids', 'madeleines'] as StockKind[]).map((kind) => {
                    const val = getStockValue(pot, kind);
                    const low = val <= pot.low_stock_threshold;
                    const Icon = STOCK_KIND_ICON[kind];
                    const colors: Record<StockKind, { bg: string; text: string; icon: string }> = {
                      ready: { bg: 'bg-emerald-50', text: 'text-gray-900', icon: 'text-emerald-600' },
                      empty_pots: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-600' },
                      empty_lids: { bg: 'bg-cyan-50', text: 'text-cyan-700', icon: 'text-cyan-600' },
                      madeleines: { bg: 'bg-rose-50', text: 'text-rose-700', icon: 'text-rose-600' },
                    };
                    const c = low ? { bg: 'bg-red-50', text: 'text-red-600', icon: 'text-red-500' } : colors[kind];
                    return (
                      <div key={kind} className={`rounded-lg p-2.5 text-center ${c.bg}`}>
                        <Icon className={`w-4 h-4 mx-auto mb-1 ${c.icon}`} />
                        <p className={`text-xl font-bold ${c.text}`}>{val}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{STOCK_KIND_LABELS[kind]}</p>
                      </div>
                    );
                  })}
                </div>
                {anyLow && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4" />
                    Stock bas — réapprovisionnement nécessaire
                  </div>
                )}
                {canRecordStock && (
                  <button onClick={() => openMovement(pot)}
                    className="mt-3 w-full py-2 rounded-lg bg-gray-50 text-gray-700 text-sm font-medium hover:bg-gray-100 transition-colors">
                    Mouvement de stock
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit/Create modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editing ? 'Modifier le type de pot' : 'Nouveau type de pot'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Forme</label>
                  <select value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as PotShape })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    {Object.entries(POT_SHAPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nb. madeleines</label>
                  <input type="number" min={1} value={form.madeleine_count} onChange={(e) => setForm({ ...form, madeleine_count: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prix unitaire (FCFA)</label>
                <input type="number" min={0} value={form.unit_price_fcfa} onChange={(e) => setForm({ ...form, unit_price_fcfa: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock prêts</label>
                  <input type="number" min={0} value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock vides</label>
                  <input type="number" min={0} value={form.empty_pots_stock} onChange={(e) => setForm({ ...form, empty_pots_stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Couvercles</label>
                  <input type="number" min={0} value={form.empty_lids_stock} onChange={(e) => setForm({ ...form, empty_lids_stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Madeleines</label>
                  <input type="number" min={0} value={form.madeleines_stock} onChange={(e) => setForm({ ...form, madeleines_stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seuil d'alerte</label>
                <input type="number" min={0} value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-200" />
                <span className="text-sm text-gray-700">Type actif</span>
              </label>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                {editing ? 'Enregistrer' : 'Créer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Movement modal */}
      {showMovement && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowMovement(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Mouvement de stock</h3>
              <button onClick={() => setShowMovement(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleMovement} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
                <select required value={movement.pot_type_id} onChange={(e) => setMovement({ ...movement, pot_type_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {pots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de stock</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(STOCK_KIND_LABELS) as StockKind[]).map((kind) => (
                    <button key={kind} type="button"
                      onClick={() => setMovement({ ...movement, stock_kind: kind })}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                        movement.stock_kind === kind
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {STOCK_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de mouvement</label>
                <select value={movement.movement_type} onChange={(e) => setMovement({ ...movement, movement_type: e.target.value as typeof movement.movement_type })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  {Object.entries(MOVEMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {showBakerField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">pétrisseur (entrée de stock)</label>
                  <select value={movement.baker_id} onChange={(e) => setMovement({ ...movement, baker_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="">— Désigner le pétrisseur —</option>
                    {bakers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
                  </select>
                </div>
              )}

              {showDriverField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commercial (attribution)</label>
                  <select value={movement.driver_id} onChange={(e) => setMovement({ ...movement, driver_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="">— Désigner le commercial —</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                </div>
              )}

              {showBatchField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lot d’origine du retour</label>
                  <select required value={movement.batch_id} onChange={(e) => selectReturnBatch(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="">— Choisir le lot —</option>
                    {todayBatches.length > 0 && (
                      <optgroup label="Lots du jour">
                        {todayBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code} · {drivers.find((driver) => driver.id === batch.driver_id)?.full_name ?? 'Commercial non renseigné'}</option>)}
                      </optgroup>
                    )}
                    {recentBatches.length > 0 && (
                      <optgroup label="Lots récents">
                        {recentBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code} · {new Date(batch.batch_date).toLocaleDateString('fr-FR')} · {drivers.find((driver) => driver.id === batch.driver_id)?.full_name ?? 'Commercial non renseigné'}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Le type de pot et le commercial du lot sont repris automatiquement pour assurer la traçabilité.</p>
                  {batches.length === 0 && <p className="mt-1 text-xs text-amber-700">Aucun lot actif ou clôturé n’est disponible hors ligne. Connectez-vous une fois pour synchroniser les lots.</p>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
                <input type="number" min={1} required value={movement.quantity || ''} onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={movement.notes} onChange={(e) => setMovement({ ...movement, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Valider le mouvement
              </button>
            </form>
          </div>
        </div>
      )}

      {/* History modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowHistory(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Historique des mouvements</h3>
              <button onClick={() => setShowHistory(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            {movements.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Aucun mouvement enregistré</p>
            ) : (
              <div className="space-y-2">
                {movements.map((m) => {
                  const isEntree = m.movement_type === 'entree' || m.movement_type === 'retour';
                  const personLabel = m.driver?.full_name ?? m.baker?.full_name ?? null;
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isEntree ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {isEntree ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type} · {m.pot_type?.name ?? '—'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(m.created_at).toLocaleString('fr-FR')}
                          {personLabel && ` · ${m.driver ? 'Commercial' : 'Pétrisseur'}: ${personLabel}`}
                          {m.batch && ` · Lot : ${m.batch.batch_code}`}
                          {m.notes ? ` · ${m.notes}` : ''}
                        </p>
                      </div>
                      <span className={`text-sm font-bold ${isEntree ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {isEntree ? '+' : '-'}{m.quantity}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
