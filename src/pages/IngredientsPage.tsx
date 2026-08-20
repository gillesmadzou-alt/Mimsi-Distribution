import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  supabase, Ingredient, DoughBatch, Kneader, Supplier, INGREDIENT_CATEGORIES, formatFCFA,
  PATE_RECIPE, INGREDIENT_VARIANCE_TOLERANCE_PCT, formatPackaging,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  Plus, X, Edit2, Trash2, Loader2, Search, Package, FlaskConical,
  AlertTriangle, ChevronDown, ChevronRight, TrendingDown, Calculator, ArrowRight,
  Users, Phone, Mail, MapPin, Building2, User, Truck, ChefHat, ScrollText, CloudOff,
} from 'lucide-react';

type Tab = 'ingredients' | 'batches' | 'suppliers';

export default function IngredientsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [tab, setTab] = useState<Tab>('ingredients');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [batches, setBatches] = useState<DoughBatch[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const canEdit = (profile?.role ?? 1) >= 2;

  // Ingredient modal
  const [showIngModal, setShowIngModal] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [ingForm, setIngForm] = useState({
    name: '', unit: 'kg', unit_cost_fcfa: 0, category: 'Farines',
    stock_quantity: 0, stock_alert_threshold: '', supplier_id: '',
    package_unit: '', package_capacity: '', sub_package_unit: '', sub_package_capacity: '',
  });
  const [savingIng, setSavingIng] = useState(false);

  // Supplier modal
  const [showSupModal, setShowSupModal] = useState(false);
  const [editingSup, setEditingSup] = useState<Supplier | null>(null);
  const [supForm, setSupForm] = useState({
    last_name: '', first_name: '', phone: '', email: '', address: '', notes: '',
  });
  const [savingSup, setSavingSup] = useState(false);

  // Batch modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<DoughBatch | null>(null);
  const [batchForm, setBatchForm] = useState({
    batch_date: new Date().toISOString().slice(0, 10),
    kneader_id: '',
    total_weight_kg: '',
    pates_produced: '',
    notes: '',
  });
  // Lines: ingredient_id + quantity
  const [batchLines, setBatchLines] = useState<{ ingredient_id: string; quantity: string }[]>([{ ingredient_id: '', quantity: '' }]);
  const [savingBatch, setSavingBatch] = useState(false);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('ingredients', async () => {
      const [ingRes, batchRes, kneaderRes, supRes] = await Promise.all([
        supabase.from('ingredients').select('*').order('name'),
        supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*)), deliveries:dough_deliveries(*, baker:bakers(*))').order('batch_date', { ascending: false }).limit(100),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('suppliers').select('*').order('last_name'),
      ]);
      return {
        ingredients: ingRes.data ?? [],
        batches: batchRes.data ?? [],
        kneaders: kneaderRes.data ?? [],
        suppliers: supRes.data ?? [],
      };
    });
    const data = result.data ?? { ingredients: [], batches: [], kneaders: [], suppliers: [] };
    setIngredients(Array.isArray(data.ingredients) ? data.ingredients : []);
    setBatches(Array.isArray(data.batches) ? data.batches : []);
    setKneaders(Array.isArray(data.kneaders) ? data.kneaders : []);
    setSuppliers(Array.isArray(data.suppliers) ? data.suppliers : []);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredIngredients = useMemo(() => {
    return ingredients.filter((i) => {
      if (filterCategory !== 'all' && i.category !== filterCategory) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [ingredients, search, filterCategory]);

  const lowStockIngredients = ingredients.filter(
    (i) => i.stock_alert_threshold !== null && i.stock_quantity <= i.stock_alert_threshold
  );

  // --- Ingredient CRUD ---
  const openCreateIng = () => {
    setEditingIng(null);
    setIngForm({ name: '', unit: 'kg', unit_cost_fcfa: 0, category: 'Farines', stock_quantity: 0, stock_alert_threshold: '', supplier_id: '', package_unit: '', package_capacity: '', sub_package_unit: '', sub_package_capacity: '' });
    setShowIngModal(true);
  };

  const openEditIng = (i: Ingredient) => {
    setEditingIng(i);
    setIngForm({
      name: i.name, unit: i.unit, unit_cost_fcfa: i.unit_cost_fcfa,
      category: i.category ?? 'Autres', stock_quantity: i.stock_quantity,
      stock_alert_threshold: i.stock_alert_threshold?.toString() ?? '', supplier_id: i.supplier_id ?? '',
      package_unit: i.package_unit ?? '', package_capacity: i.package_capacity?.toString() ?? '',
      sub_package_unit: i.sub_package_unit ?? '', sub_package_capacity: i.sub_package_capacity?.toString() ?? '',
    });
    setShowIngModal(true);
  };

  const handleIngSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIng(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const payload = {
      name: ingForm.name,
      unit: ingForm.unit,
      unit_cost_fcfa: ingForm.unit_cost_fcfa,
      category: ingForm.category,
      stock_quantity: ingForm.stock_quantity,
      stock_alert_threshold: ingForm.stock_alert_threshold ? parseFloat(ingForm.stock_alert_threshold) : null,
      supplier_id: ingForm.supplier_id || null,
      package_unit: ingForm.package_unit || null,
      package_capacity: ingForm.package_capacity ? parseFloat(ingForm.package_capacity) : null,
      sub_package_unit: ingForm.sub_package_unit || null,
      sub_package_capacity: ingForm.sub_package_capacity ? parseFloat(ingForm.sub_package_capacity) : null,
      updated_at: new Date().toISOString(),
      ...(editingIng ? {} : { created_by: userId }),
    };
    if (editingIng) {
      const { error } = await supabase.from('ingredients').update(payload).eq('id', editingIng.id);
      if (error) { setSavingIng(false); toast('Erreur lors de la mise à jour.', 'error'); return; }
    } else {
      const { error } = await supabase.from('ingredients').insert(payload);
      if (error) { setSavingIng(false); toast('Erreur lors de la création.', 'error'); return; }
    }
    setSavingIng(false);
    setShowIngModal(false);
    loadData();
  };

  const handleIngDelete = async (i: Ingredient) => {
    if (!(await confirmDialog({ message: `Supprimer l'intrant « ${i.name} » ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    const { error } = await supabase.from('ingredients').delete().eq('id', i.id);
    if (error) { toast('Erreur lors de la suppression.', 'error'); return; }
    loadData();
  };

  // --- Batch CRUD ---
  const openCreateBatch = () => {
    setEditingBatch(null);
    setBatchForm({ batch_date: new Date().toISOString().slice(0, 10), kneader_id: '', total_weight_kg: '', pates_produced: '', notes: '' });
    setBatchLines([{ ingredient_id: '', quantity: '' }]);
    setShowBatchModal(true);
  };

  const openEditBatch = async (b: DoughBatch) => {
    setEditingBatch(b);
    setBatchForm({
      batch_date: b.batch_date,
      kneader_id: b.kneader_id ?? '',
      total_weight_kg: b.total_weight_kg?.toString() ?? '',
      pates_produced: b.pates_produced?.toString() ?? '',
      notes: b.notes ?? '',
    });
    const lines = (b.ingredients ?? []).map((li) => ({
      ingredient_id: li.ingredient_id,
      quantity: li.quantity.toString(),
    }));
    setBatchLines(lines.length > 0 ? lines : [{ ingredient_id: '', quantity: '' }]);
    setShowBatchModal(true);
  };

  const computeLineCost = (ingredientId: string, qty: string) => {
    const ing = ingredients.find((i) => i.id === ingredientId);
    if (!ing || !qty) return 0;
    return ing.unit_cost_fcfa * parseFloat(qty);
  };

  const batchTotalCost = useMemo(() => {
    return batchLines.reduce((sum, line) => sum + computeLineCost(line.ingredient_id, line.quantity), 0);
  }, [batchLines, ingredients]);

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = batchLines.filter((l) => l.ingredient_id && l.quantity && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { toast('Ajoutez au moins un intrant avec une quantité.', 'error'); return; }
    setSavingBatch(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;

    const patesProduced = batchForm.pates_produced ? parseInt(batchForm.pates_produced, 10) : null;

    let maxVariancePct: number | null = null;
    if (patesProduced && patesProduced > 0) {
      for (const line of validLines) {
        const ing = ingredients.find((i) => i.id === line.ingredient_id);
        if (!ing) continue;
        const recipeItem = PATE_RECIPE.find((r) =>
          ing.name.toLowerCase().includes(r.ingredient.toLowerCase())
        );
        if (!recipeItem) continue;
        const expected = recipeItem.quantity_per_pate * patesProduced;
        const actual = parseFloat(line.quantity);
        if (expected > 0) {
          const v = Math.abs(((actual - expected) / expected) * 100);
          if (maxVariancePct === null || v > maxVariancePct) maxVariancePct = Number(v.toFixed(2));
        }
      }
    }

    const batchPayload = {
      batch_date: batchForm.batch_date,
      kneader_id: batchForm.kneader_id || null,
      total_weight_kg: batchForm.total_weight_kg ? parseFloat(batchForm.total_weight_kg) : null,
      total_cost_fcfa: batchTotalCost,
      pates_produced: patesProduced && patesProduced > 0 ? patesProduced : null,
      ingredient_variance: maxVariancePct,
      notes: batchForm.notes || null,
      updated_at: new Date().toISOString(),
      ...(editingBatch ? {} : { created_by: userId }),
    };

    let batchId: string;
    if (editingBatch) {
      const { error } = await supabase.from('dough_batches').update(batchPayload).eq('id', editingBatch.id);
      if (error) { toast('Erreur lors de la mise à jour du lot.', 'error'); return; }
      batchId = editingBatch.id;
      // Replace all lines
      const { error: delErr } = await supabase.from('dough_batch_ingredients').delete().eq('dough_batch_id', batchId);
      if (delErr) { toast('Erreur lors de la mise à jour des ingrédients.', 'error'); return; }
    } else {
      const { data: newBatch, error } = await supabase.from('dough_batches').insert(batchPayload).select().single();
      if (error || !newBatch) { toast('Erreur lors de la création du lot.', 'error'); return; }
      batchId = newBatch?.id ?? '';
    }

    const lineRows = validLines.map((l) => {
      const ing = ingredients.find((i) => i.id === l.ingredient_id)!;
      const qty = parseFloat(l.quantity);
      return {
        dough_batch_id: batchId,
        ingredient_id: l.ingredient_id,
        quantity: qty,
        unit_cost_fcfa: ing.unit_cost_fcfa,
        line_cost_fcfa: ing.unit_cost_fcfa * qty,
      };
    });
    await supabase.from('dough_batch_ingredients').insert(lineRows);

    // Deduct stock
    for (const l of validLines) {
      const qty = parseFloat(l.quantity);
      await supabase.rpc('adjust_ingredient_stock', {
        p_ingredient_id: l.ingredient_id,
        p_delta: -qty,
      });
    }

    setSavingBatch(false);
    setShowBatchModal(false);

    if (maxVariancePct !== null && maxVariancePct > INGREDIENT_VARIANCE_TOLERANCE_PCT) {
      try {
        const kneaderName = kneaders.find((k) => k.id === batchForm.kneader_id)?.full_name ?? 'Non assigné';
        const varianceDetails = validLines.map((line) => {
          const ing = ingredients.find((i) => i.id === line.ingredient_id);
          if (!ing) return null;
          const recipeItem = PATE_RECIPE.find((r) =>
            ing.name.toLowerCase().includes(r.ingredient.toLowerCase())
          );
          if (!recipeItem || !patesProduced) return null;
          const expected = recipeItem.quantity_per_pate * patesProduced;
          const actual = parseFloat(line.quantity);
          const v = ((actual - expected) / expected) * 100;
          return `${ing.name}: attendu ${expected} ${ing.unit}, réel ${actual} ${ing.unit} (${v > 0 ? '+' : ''}${v.toFixed(1)}%)`;
        }).filter(Boolean).join('; ');
        const discMsg = `Fabrication de ${patesProduced} pâte(s) — Pétrisseur: ${kneaderName}. Écarts ingrédients: ${varianceDetails}.`;
        await supabase.from('compliance_discrepancies').insert({
          chain_stage: 'pate_production',
          entity_type: 'dough_batch',
          entity_label: kneaderName,
          expected_qty: patesProduced ?? 0,
          actual_qty: patesProduced ?? 0,
          variance: maxVariancePct,
          unit: 'pates',
          status: 'non_resolu',
          notified_roles: [4, 5, 6],
          comment: discMsg,
        });
        const { data: directors } = await supabase.from('profiles').select('id').in('role', [4, 5, 6]).eq('is_active', true);
        if (directors && directors.length > 0) {
          await supabase.from('app_notifications').insert(
            directors.map((d) => ({
              user_id: d.id,
              title: 'Alerte conformité ingrédients pâte',
              message: discMsg,
              type: 'warning',
              priority: 'haute',
              link_page: 'compliance',
            }))
          );
        }
      } catch {}
    }

    loadData();
  };

  const handleBatchDelete = async (b: DoughBatch) => {
    if (!(await confirmDialog({ message: `Supprimer cette fabrication de pâte du ${new Date(b.batch_date).toLocaleDateString('fr-FR')} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    // Restore stock
    for (const li of b.ingredients ?? []) {
      await supabase.rpc('adjust_ingredient_stock', {
        p_ingredient_id: li.ingredient_id,
        p_delta: li.quantity,
      });
    }
    await supabase.from('dough_batches').delete().eq('id', b.id);
    loadData();
  };

  const addLine = () => setBatchLines([...batchLines, { ingredient_id: '', quantity: '' }]);
  const removeLine = (idx: number) => setBatchLines(batchLines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: 'ingredient_id' | 'quantity', value: string) => {
    setBatchLines(batchLines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  // Supplier CRUD
  const openCreateSup = () => {
    setEditingSup(null);
    setSupForm({ last_name: '', first_name: '', phone: '', email: '', address: '', notes: '' });
    setShowSupModal(true);
  };
  const openEditSup = (s: Supplier) => {
    setEditingSup(s);
    setSupForm({
      last_name: s.last_name, first_name: s.first_name,
      phone: s.phone ?? '', email: s.email ?? '',
      address: s.address ?? '', notes: s.notes ?? '',
    });
    setShowSupModal(true);
  };
  const handleSupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSup(true);
    const payload = {
      last_name: supForm.last_name,
      first_name: supForm.first_name,
      phone: supForm.phone || null,
      email: supForm.email || null,
      address: supForm.address || null,
      notes: supForm.notes || null,
      updated_at: new Date().toISOString(),
    };
    if (editingSup) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editingSup.id);
      if (error) { setSavingSup(false); toast('Erreur lors de la mise à jour.', 'error'); return; }
    } else {
      const code = (supForm.last_name.slice(0, 2) + supForm.first_name.slice(0, 1)).toUpperCase();
      await supabase.from('suppliers').insert({ ...payload, supplier_code: code });
    }
    setSavingSup(false);
    setShowSupModal(false);
    loadData();
  };
  const handleSupDelete = async (s: Supplier) => {
    if (!(await confirmDialog({ message: `Supprimer le fournisseur ${s.last_name} ${s.first_name} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    await supabase.from('suppliers').delete().eq('id', s.id);
    loadData();
  };

  // Stats
  const totalStockValue = ingredients.reduce((sum, i) => sum + i.unit_cost_fcfa * i.stock_quantity, 0);
  const monthStart = new Date(); monthStart.setDate(1);
  const monthBatches = batches.filter((b) => new Date(b.batch_date) >= monthStart);
  const monthCost = monthBatches.reduce((sum, b) => sum + b.total_cost_fcfa, 0);
  const avgBatchCost = monthBatches.length > 0 ? monthCost / monthBatches.length : 0;

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('ingredients')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-colors ${tab === 'ingredients' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
        >
          <Package className="w-4 h-4" /> Intrants
        </button>
        <button
          onClick={() => setTab('batches')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-colors ${tab === 'batches' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
        >
          <FlaskConical className="w-4 h-4" /> Fabrications de pâte
        </button>
        <button
          onClick={() => setTab('suppliers')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-colors ${tab === 'suppliers' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
        >
          <Users className="w-4 h-4" /> Fournisseurs
        </button>
      </div>

      {/* Cross-link */}
      <button onClick={() => onNavigate?.('production')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
        <ArrowRight className="w-4 h-4" /> Voir production
      </button>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Valeur du stock</p>
            <p className="text-lg font-bold text-gray-900">{formatFCFA(totalStockValue)}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Coût pâtes ce mois</p>
            <p className="text-lg font-bold text-gray-900">{formatFCFA(monthCost)}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Coût moyen / fabrication</p>
            <p className="text-lg font-bold text-gray-900">{formatFCFA(avgBatchCost)}</p>
          </div>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStockIngredients.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Stock bas : {lowStockIngredients.map((i) => i.name).join(', ')}</p>
            <p className="text-xs text-red-600">Pensez à réapprovisionner ces intrants.</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : isOffline && ingredients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les ingrédients.</p>
        </div>
      ) : tab === 'ingredients' ? (
        <>
          {/* Ingredients toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un intrant…"
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
              >
                <option value="all">Toutes catégories</option>
                {INGREDIENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {canEdit && (
              <button onClick={openCreateIng} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all shrink-0">
                <Plus className="w-5 h-5" /> Nouvel intrant
              </button>
            )}
          </div>

          {/* Ingredients table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Intrant</th>
                    <th className="text-left px-4 py-3 font-semibold">Catégorie</th>
                    <th className="text-right px-4 py-3 font-semibold">Coût unitaire</th>
                    <th className="text-left px-4 py-3 font-semibold">Conditionnement</th>
                    <th className="text-right px-4 py-3 font-semibold">Stock</th>
                    <th className="text-left px-4 py-3 font-semibold">Fournisseur</th>
                    {canEdit && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredIngredients.length === 0 ? (
                    <tr><td colSpan={canEdit ? 7 : 6} className="text-center py-10 text-gray-400">Aucun intrant trouvé</td></tr>
                  ) : filteredIngredients.map((i) => {
                    const low = i.stock_alert_threshold !== null && i.stock_quantity <= i.stock_alert_threshold;
                    return (
                      <tr key={i.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-amber-500" />
                            </div>
                            <span className="font-medium text-gray-900">{i.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{i.category ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatFCFA(i.unit_cost_fcfa)}<span className="text-gray-400 text-xs"> /{i.unit}</span></td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {i.package_unit && i.package_capacity
                            ? <>1 {i.package_unit} = {i.package_capacity} {i.unit}{i.sub_package_unit && i.sub_package_capacity ? <> · 1 {i.sub_package_unit} = {i.sub_package_capacity} {i.unit}</> : null}</>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${low ? 'text-red-600' : 'text-gray-900'}`}>{i.stock_quantity} {i.unit}</span>
                          {(() => {
                            const pkg = formatPackaging(i, i.stock_quantity);
                            return pkg && pkg !== `${i.stock_quantity} ${i.unit}` ? <span className="block text-xs text-amber-600">{pkg}</span> : null;
                          })()}
                          {low && <AlertTriangle className="inline-block w-3.5 h-3.5 text-red-500 ml-1" />}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{suppliers.find((s) => s.id === i.supplier_id) ? `${suppliers.find((s) => s.id === i.supplier_id)!.last_name} ${suppliers.find((s) => s.id === i.supplier_id)!.first_name}` : i.supplier ?? '—'}</td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => openEditIng(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleIngDelete(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : tab === 'batches' ? (
        <>
          {/* Batches toolbar */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500">{batches.length} fabrication(s) enregistrée(s)</p>
            {canEdit && (
              <button onClick={openCreateBatch} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                <Plus className="w-5 h-5" /> Nouvelle fabrication
              </button>
            )}
          </div>

          {/* Batches list */}
          <div className="space-y-2">
            {batches.length === 0 ? (
              <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
                <FlaskConical className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p>Aucune fabrication de pâte enregistrée</p>
              </div>
            ) : batches.map((b) => {
              const isExpanded = expandedBatch === b.id;
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div
                    className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50/50 transition-colors"
                    onClick={() => setExpandedBatch(isExpanded ? null : b.id)}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                      <FlaskConical className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {new Date(b.batch_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {b.kneader?.full_name ?? 'Non assigné'}
                        {b.total_weight_kg ? ` · ${b.total_weight_kg} kg` : ''}
                        {b.pates_produced ? ` · ${b.pates_produced} pâte(s)` : ''}
                        {' · '}{(b.ingredients ?? []).length} intrant(s)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{formatFCFA(b.total_cost_fcfa)}</p>
                      <p className="text-xs text-gray-400">coût total</p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEditBatch(b)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleBatchDelete(b)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1">
                      {b.notes && <p className="text-sm text-gray-500 italic mb-2">« {b.notes} »</p>}
                      {b.ingredient_variance != null && Math.abs(Number(b.ingredient_variance)) > INGREDIENT_VARIANCE_TOLERANCE_PCT && (
                        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                          <span className="text-sm text-red-800 font-medium">Écart ingrédients: {Number(b.ingredient_variance) > 0 ? '+' : ''}{Number(b.ingredient_variance).toFixed(1)}% (tolérance ±{INGREDIENT_VARIANCE_TOLERANCE_PCT}%)</span>
                        </div>
                      )}
                      {/* Linked deliveries */}
                      {(b.deliveries ?? []).length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5" /> Livraisons de pâte ({(b.deliveries ?? []).length})
                          </p>
                          <div className="space-y-1">
                            {(b.deliveries ?? []).map((d) => (
                              <div key={d.id} className="flex items-center gap-2 text-xs bg-amber-50 rounded-lg px-2.5 py-1.5">
                                <ChefHat className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span className="font-medium text-gray-800">{d.baker?.full_name ?? '—'}</span>
                                <span className="text-gray-500">· {d.bucket_count} seau(x) · {d.bucket_weight_kg} kg</span>
                                <span className="text-gray-400 ml-auto">{new Date(d.delivery_date).toLocaleDateString('fr-FR')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <table className="w-full text-sm">
                        <thead className="text-gray-400 text-xs uppercase">
                          <tr>
                            <th className="text-left py-1.5 font-semibold">Intrant</th>
                            <th className="text-right py-1.5 font-semibold">Quantité</th>
                            <th className="text-right py-1.5 font-semibold">Coût unitaire</th>
                            <th className="text-right py-1.5 font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {(b.ingredients ?? []).map((li) => (
                            <tr key={li.id}>
                              <td className="py-2 text-gray-900 font-medium">{li.ingredient?.name ?? '—'}</td>
                              <td className="py-2 text-right text-gray-600">
                                {li.quantity} {li.ingredient?.unit}
                                {li.ingredient && (() => {
                                  const pkg = formatPackaging(li.ingredient, li.quantity);
                                  return pkg && pkg !== `${li.quantity} ${li.ingredient.unit}` ? <span className='block text-amber-600 text-xs'>({pkg})</span> : null;
                                })()}
                              </td>
                              <td className="py-2 text-right text-gray-600">{formatFCFA(li.unit_cost_fcfa)}</td>
                              <td className="py-2 text-right font-medium text-gray-900">{formatFCFA(li.line_cost_fcfa)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Suppliers toolbar */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500">{suppliers.length} fournisseur(s) enregistré(s)</p>
            {canEdit && (
              <button onClick={openCreateSup} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                <Plus className="w-5 h-5" /> Nouveau fournisseur
              </button>
            )}
          </div>

          {/* Suppliers grid */}
          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p>Aucun fournisseur enregistré</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {suppliers.map((s) => (
                <div key={s.id} className="bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{s.last_name} {s.first_name}</p>
                        <p className="text-xs text-gray-400">Code: {s.supplier_code}</p>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => openEditSup(s)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleSupDelete(s)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-600">
                    {s.phone && (
                      <p className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-400" /> {s.phone}</p>
                    )}
                    {s.email && (
                      <p className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-gray-400" /> {s.email}</p>
                    )}
                    {s.address && (
                      <p className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" /> {s.address}</p>
                    )}
                  </div>
                  {s.notes && (
                    <p className="text-xs text-gray-400 italic mt-2 pt-2 border-t border-gray-50">« {s.notes} »</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Ingredient Modal */}
      {showIngModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowIngModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editingIng ? 'Modifier l\'intrant' : 'Nouvel intrant'}</h3>
              <button onClick={() => setShowIngModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleIngSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <input required value={ingForm.name} onChange={(e) => setIngForm({ ...ingForm, name: e.target.value })}
                  placeholder="Farine, Levure, Sucre…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
                  <input required value={ingForm.unit} onChange={(e) => setIngForm({ ...ingForm, unit: e.target.value })}
                    placeholder="kg, L, unité, sac…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Coût unitaire (FCFA)</label>
                  <input type="number" min="0" required value={ingForm.unit_cost_fcfa} onChange={(e) => setIngForm({ ...ingForm, unit_cost_fcfa: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                <select value={ingForm.category} onChange={(e) => setIngForm({ ...ingForm, category: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  {INGREDIENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock actuel</label>
                  <input type="number" min="0" value={ingForm.stock_quantity} onChange={(e) => setIngForm({ ...ingForm, stock_quantity: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Alerte stock bas</label>
                  <input type="number" min="0" value={ingForm.stock_alert_threshold} onChange={(e) => setIngForm({ ...ingForm, stock_alert_threshold: e.target.value })}
                    placeholder="Seuil…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-sm font-semibold text-gray-700 mb-2">Conditionnement (optionnel)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Emballage</label>
                    <input value={ingForm.package_unit} onChange={(e) => setIngForm({ ...ingForm, package_unit: e.target.value })}
                      placeholder="sac, bidon, carton…"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Capacité ({ingForm.unit || 'unité'})</label>
                    <input type="number" min="0" step="0.01" value={ingForm.package_capacity} onChange={(e) => setIngForm({ ...ingForm, package_capacity: e.target.value })}
                      placeholder="Ex: 25"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Sous-emballage</label>
                    <input value={ingForm.sub_package_unit} onChange={(e) => setIngForm({ ...ingForm, sub_package_unit: e.target.value })}
                      placeholder="sachet, paquet…"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Capacité sous-emballage</label>
                    <input type="number" min="0" step="0.01" value={ingForm.sub_package_capacity} onChange={(e) => setIngForm({ ...ingForm, sub_package_capacity: e.target.value })}
                      placeholder="Ex: 6"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur (optionnel)</label>
                <select value={ingForm.supplier_id} onChange={(e) => setIngForm({ ...ingForm, supplier_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Aucun —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.last_name} {s.first_name}</option>)}
                </select>
              </div>
              <button type="submit" disabled={savingIng}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {savingIng && <Loader2 className="w-5 h-5 animate-spin" />}
                {editingIng ? 'Enregistrer' : 'Créer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Batch Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowBatchModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editingBatch ? 'Modifier la fabrication' : 'Nouvelle fabrication de pâte'}</h3>
              <button onClick={() => setShowBatchModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleBatchSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" required value={batchForm.batch_date} onChange={(e) => setBatchForm({ ...batchForm, batch_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pétrisseur</label>
                  <select value={batchForm.kneader_id} onChange={(e) => setBatchForm({ ...batchForm, kneader_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="">— Non assigné —</option>
                    {kneaders.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Poids total (kg, optionnel)</label>
                <input type="number" min="0" step="0.1" value={batchForm.total_weight_kg} onChange={(e) => setBatchForm({ ...batchForm, total_weight_kg: e.target.value })}
                  placeholder="Ex: 50"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de pâtes produites (7,5 kg chacune)</label>
                <input type="number" min="0" value={batchForm.pates_produced} onChange={(e) => setBatchForm({ ...batchForm, pates_produced: e.target.value })}
                  placeholder="Ex: 4"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>

              {batchForm.pates_produced && parseInt(batchForm.pates_produced, 10) > 0 && (() => {
                const n = parseInt(batchForm.pates_produced, 10);
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                      <ScrollText className="w-4 h-4" /> Recette standard pour {n} pâte(s)
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs text-amber-900">
                      {PATE_RECIPE.map((r) => {
                        const ing = ingredients.find((i) => i.name.toLowerCase().includes(r.ingredient.toLowerCase()));
                        const qty = r.quantity_per_pate * n;
                        const pkg = ing ? formatPackaging(ing, qty) : null;
                        return (
                          <div key={r.ingredient} className="flex items-center justify-between">
                            <span>{r.label}</span>
                            <span className="font-medium">{qty.toLocaleString('fr-FR')} {r.unit}{pkg && pkg !== `${qty} ${r.unit}` ? <span className="text-amber-600 ml-1">({pkg})</span> : null}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => {
                      const newLines = PATE_RECIPE.map((r) => {
                        const ing = ingredients.find((i) => i.name.toLowerCase().includes(r.ingredient.toLowerCase()));
                        return { ingredient_id: ing?.id ?? '', quantity: String(r.quantity_per_pate * n) };
                      }).filter((l) => l.ingredient_id);
                      if (newLines.length > 0) setBatchLines(newLines);
                    }} className="w-full mt-1 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors">
                      Pré-remplir les ingrédients selon la norme
                    </button>
                    {(() => {
                      const issues: string[] = [];
                      PATE_RECIPE.forEach((r) => {
                        const ing = ingredients.find((i) => i.name.toLowerCase().includes(r.ingredient.toLowerCase()));
                        if (!ing) issues.push(r.label);
                      });
                      if (issues.length > 0) return (
                        <p className="text-xs text-red-600">Intrants manquants: {issues.join(', ')}. Créez-les dans l'onglet Intrants.</p>
                      );
                      return null;
                    })()}
                  </div>
                );
              })()}

              {/* Ingredient lines */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Intrants utilisés</label>
                <div className="space-y-2">
                  {batchLines.map((line, idx) => {
                    const lineCost = computeLineCost(line.ingredient_id, line.quantity);
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={line.ingredient_id}
                          onChange={(e) => updateLine(idx, 'ingredient_id', e.target.value)}
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                        >
                          <option value="">— Intrant —</option>
                          {INGREDIENT_CATEGORIES.map((cat) => {
                            const catItems = ingredients.filter((i) => (i.category ?? 'Autres') === cat);
                            if (catItems.length === 0) return null;
                            return (
                              <optgroup key={cat} label={cat}>
                                {catItems.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                              </optgroup>
                            );
                          })}
                        </select>
                        <input
                          type="number" min="0" step="0.01" placeholder="Qté"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                          className="w-20 px-2 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                        />
                        <span className="text-xs text-gray-500 w-28 text-right">{lineCost > 0 ? formatFCFA(lineCost) : '—'}{(() => {
                          const ing = ingredients.find((i) => i.id === line.ingredient_id);
                          if (!ing || !line.quantity) return null;
                          const pkg = formatPackaging(ing, parseFloat(line.quantity) || 0);
                          return pkg && pkg !== `${parseFloat(line.quantity)} ${ing.unit}` ? <span className='block text-amber-600 text-[10px]'>{pkg}</span> : null;
                        })()}</span>
                        {batchLines.length > 1 && (
                          <button type="button" onClick={() => removeLine(idx)} className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 font-medium">
                  <Plus className="w-4 h-4" /> Ajouter un intrant
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                <textarea value={batchForm.notes} onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none" />
              </div>

              {/* Total */}
              <div className="bg-amber-50 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-amber-800">Coût total de la fabrication</span>
                <span className="text-lg font-bold text-amber-900">{formatFCFA(batchTotalCost)}</span>
              </div>

              <button type="submit" disabled={savingBatch}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {savingBatch && <Loader2 className="w-5 h-5 animate-spin" />}
                {editingBatch ? 'Enregistrer' : 'Enregistrer la fabrication'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {showSupModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowSupModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editingSup ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h3>
              <button onClick={() => setShowSupModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSupSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                  <input required value={supForm.last_name} onChange={(e) => setSupForm({ ...supForm, last_name: e.target.value })}
                    placeholder="Nom…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                  <input required value={supForm.first_name} onChange={(e) => setSupForm({ ...supForm, first_name: e.target.value })}
                    placeholder="Prénom…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                  placeholder="+225 …"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })}
                  placeholder="contact@fournisseur.com"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <textarea value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })}
                  rows={2}
                  placeholder="Adresse complète…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                <textarea value={supForm.notes} onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none" />
              </div>
              <button type="submit" disabled={savingSup}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {savingSup && <Loader2 className="w-5 h-5 animate-spin" />}
                {editingSup ? 'Enregistrer' : 'Créer'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
