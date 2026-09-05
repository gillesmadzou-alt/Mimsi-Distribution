import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Boxes, CalendarClock, ClipboardList, Cookie, Disc3, Download, Package, Plus, Wheat, X } from 'lucide-react';
import { Ingredient, PotType, supabase } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { useToast } from '@/contexts/ToastContext';

type Category = 'ingredient' | 'madeleine' | 'ready_pot' | 'empty_pot' | 'lid';
type Operation = 'initial' | 'entree' | 'sortie' | 'retour';

interface LedgerEntry {
  id: string;
  occurred_on: string;
  item_category: Category;
  pot_type_id: string | null;
  ingredient_id: string | null;
  operation: Operation;
  quantity: number;
  delta: number;
  source_type: string | null;
  notes: string | null;
  created_at: string;
}

interface InventorySchedule { id: string; name: string; frequency: string; next_inventory_on: string; categories: Category[]; is_active: boolean; }
interface InventoryLine { id: string; item_category: Category; pot_type_id: string | null; ingredient_id: string | null; theoretical_quantity: number; counted_quantity: number | null; notes: string | null; }

const CATEGORY: Record<Category, { label: string; Icon: typeof Package; tone: string }> = {
  ingredient: { label: 'Intrants de production', Icon: Wheat, tone: 'bg-amber-50 text-amber-700' },
  madeleine: { label: 'Madeleines', Icon: Cookie, tone: 'bg-rose-50 text-rose-700' },
  ready_pot: { label: 'Pots prêts', Icon: Package, tone: 'bg-emerald-50 text-emerald-700' },
  empty_pot: { label: 'Pots vides', Icon: Archive, tone: 'bg-orange-50 text-orange-700' },
  lid: { label: 'Couvercles', Icon: Disc3, tone: 'bg-cyan-50 text-cyan-700' },
};

const OPERATION_LABEL: Record<Operation, string> = {
  initial: 'Stock initial', entree: 'Entrée', sortie: 'Sortie', retour: 'Retour',
};

const stockFor = (pot: PotType, category: Exclude<Category, 'ingredient'>) => {
  if (category === 'ready_pot') return pot.stock_quantity ?? 0;
  if (category === 'empty_pot') return pot.empty_pots_stock ?? 0;
  if (category === 'lid') return pot.empty_lids_stock ?? 0;
  return pot.madeleines_stock ?? 0;
};

export default function InventoryLedgerPanel({ canRecord }: { canRecord: boolean }) {
  const { toast } = useToast();
  const { fetchWithCache, isOffline } = useOfflineFetch();
  const { save } = useOfflineSave();
  const [pots, setPots] = useState<PotType[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [schedules, setSchedules] = useState<InventorySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('ingredient');
  const [showForm, setShowForm] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [activeLines, setActiveLines] = useState<InventoryLine[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ name: 'Inventaire de stock', frequency: 'hebdomadaire', nextInventoryOn: new Date().toISOString().slice(0, 10) });
  const [form, setForm] = useState({ itemId: '', operation: 'entree' as Operation, quantity: '', notes: '', occurredOn: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('inventory:ledger:v1', async () => {
      const [potRes, ingredientRes, entryRes, scheduleRes] = await Promise.all([
        supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
        supabase.from('ingredients').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_entries').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('inventory_schedules').select('*').eq('is_active', true).order('next_inventory_on'),
      ]);
      if (potRes.error) throw potRes.error;
      if (ingredientRes.error) throw ingredientRes.error;
      if (entryRes.error) throw entryRes.error;
      return { pots: potRes.data ?? [], ingredients: ingredientRes.data ?? [], entries: entryRes.data ?? [], schedules: scheduleRes.data ?? [] };
    });
    if (result.data) {
      setPots(result.data.pots as PotType[]);
      setIngredients(result.data.ingredients as Ingredient[]);
      setEntries(result.data.entries as LedgerEntry[]);
      setSchedules(result.data.schedules as InventorySchedule[]);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase.channel('inventory-ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_entries' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pot_types' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOffline, load]);

  const selectedItems = category === 'ingredient' ? ingredients : pots;
  const rows = useMemo(() => selectedItems.map((item) => {
    const id = item.id;
    const related = entries.filter((entry) => category === 'ingredient' ? entry.ingredient_id === id : entry.pot_type_id === id && entry.item_category === category);
    const entriesTotal = related.filter((e) => e.operation === 'entree' || e.operation === 'retour').reduce((sum, e) => sum + Number(e.quantity), 0);
    const exitsTotal = related.filter((e) => e.operation === 'sortie').reduce((sum, e) => sum + Number(e.quantity), 0);
    const lastInitial = related.find((e) => e.operation === 'initial');
    const final = category === 'ingredient' ? (item as Ingredient).stock_quantity : stockFor(item as PotType, category as Exclude<Category, 'ingredient'>);
    return { item, final, entriesTotal, exitsTotal, initial: lastInitial?.quantity ?? null, related };
  }), [category, entries, ingredients, pots, selectedItems]);

  const openForm = () => {
    setForm({ itemId: '', operation: 'entree', quantity: '', notes: '', occurredOn: new Date().toISOString().slice(0, 10) });
    setShowForm(true);
  };

  const downloadReport = () => {
    const content = ['Article;Stock initial;Entrées;Sorties;Stock final', ...rows.map(({ item, initial, entriesTotal, exitsTotal, final }) => `${item.name};${initial ?? ''};${entriesTotal};${exitsTotal};${final}`)].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `rapport-stock-${category}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const saveSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    const { error } = await supabase.from('inventory_schedules').insert({ name: scheduleForm.name, frequency: scheduleForm.frequency, next_inventory_on: scheduleForm.nextInventoryOn, categories: Object.keys(CATEGORY) });
    if (error) { toast('Le programme n’a pas pu être créé.', 'error'); return; }
    setShowSchedule(false); toast('Programme d’inventaire créé.', 'success'); load();
  };

  const startInventory = async (schedule: InventorySchedule) => {
    const { data, error } = await supabase.rpc('create_inventory_session', { p_schedule_id: schedule.id, p_inventory_date: schedule.next_inventory_on });
    if (error || !data) { toast('La fiche d’inventaire n’a pas pu être créée.', 'error'); return; }
    const { data: lines } = await supabase.from('inventory_session_lines').select('*').eq('session_id', data).order('item_category');
    setActiveSessionId(data);
    setActiveLines((lines ?? []) as InventoryLine[]);
    toast('Fiche d’inventaire créée. Saisissez les quantités comptées.', 'success');
  };

  const updateCount = async (line: InventoryLine, value: string) => {
    const count = value === '' ? null : Number(value);
    setActiveLines((current) => current?.map((entry) => entry.id === line.id ? { ...entry, counted_quantity: count } : entry) ?? null);
    const { error } = await supabase.from('inventory_session_lines').update({ counted_quantity: count }).eq('id', line.id);
    if (error) toast('La quantité comptée n’a pas pu être enregistrée.', 'error');
  };

  const validateInventory = async () => {
    if (!activeSessionId) return;
    const { error } = await supabase.from('inventory_sessions').update({ status: 'valide', validated_at: new Date().toISOString() }).eq('id', activeSessionId);
    if (error) { toast('La fiche n’a pas pu être validée.', 'error'); return; }
    toast('Inventaire validé. La fiche et les écarts restent consultables.', 'success');
    setActiveLines(null); setActiveSessionId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    if (!form.itemId || !Number.isFinite(quantity) || quantity <= 0) {
      toast('Sélectionnez un article et une quantité valide.', 'error');
      return;
    }
    const args = {
      p_item_category: category,
      p_pot_type_id: category === 'ingredient' ? null : form.itemId,
      p_ingredient_id: category === 'ingredient' ? form.itemId : null,
      p_operation: form.operation,
      p_quantity: quantity,
      p_notes: form.notes || null,
      p_occurred_on: form.occurredOn,
    };
    const result = await save('Mouvement de registre de stock', 'stock', buildSteps().rpc('record_inventory_entry', args).getSteps());
    if (result.error && !result.queued) {
      toast('Le mouvement n’a pas pu être enregistré.', 'error');
      return;
    }
    setShowForm(false);
    toast(result.queued ? 'Mouvement enregistré hors ligne : il sera synchronisé automatiquement.' : 'Mouvement de stock enregistré.', 'success');
    if (!result.queued) load();
  };

  const config = CATEGORY[category];
  const Icon = config.Icon;
  return (
    <section className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/80 to-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-amber-800"><ClipboardList className="h-5 w-5" /><h2 className="font-bold">Registre de gestion de stock</h2></div>
          <p className="mt-1 text-xs text-gray-600">Stock initial, entrées, sorties et stock final. Les mouvements de production, tournées et retours sont ajoutés automatiquement.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">{canRecord && <button onClick={() => setShowSchedule(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800"><CalendarClock className="h-4 w-4" /> Programmer inventaire</button>}{canRecord && <button onClick={openForm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"><Plus className="h-4 w-4" /> Enregistrer un mouvement</button>}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(CATEGORY) as Category[]).map((key) => {
          const ItemIcon = CATEGORY[key].Icon;
          return <button key={key} onClick={() => setCategory(key)} className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${category === key ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-gray-700 hover:bg-amber-100'}`}><ItemIcon className="h-4 w-4 shrink-0" />{CATEGORY[key].label}</button>;
        })}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="min-w-[700px] w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Article</th><th className="px-3 py-3 text-right">Stock initial</th><th className="px-3 py-3 text-right">Entrées</th><th className="px-3 py-3 text-right">Sorties</th><th className="px-4 py-3 text-right">Stock final</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Chargement du registre…</td></tr> : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun article dans cette catégorie.</td></tr> : rows.map(({ item, initial, entriesTotal, exitsTotal, final }) => <tr key={item.id} className="border-t border-gray-100"><td className="px-4 py-3 font-medium text-gray-800">{item.name}{category === 'ingredient' && <span className="ml-1 text-xs font-normal text-gray-400">/ {(item as Ingredient).unit}</span>}</td><td className="px-3 py-3 text-right text-gray-600">{initial ?? '—'}</td><td className="px-3 py-3 text-right font-medium text-emerald-700">+{entriesTotal}</td><td className="px-3 py-3 text-right font-medium text-rose-700">−{exitsTotal}</td><td className="px-4 py-3 text-right text-base font-bold text-gray-900">{final}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Le stock initial est défini une fois par article. Le stock final est le stock réellement disponible et se met à jour sur tous les appareils connectés.</p>
      <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-700">Rapport : <strong>{config.label}</strong></p><button onClick={downloadReport} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700"><Download className="h-4 w-4" /> Télécharger le rapport CSV</button></div>
      {schedules.length > 0 && <div className="mt-3 space-y-2">{schedules.map((schedule) => <div key={schedule.id} className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-gray-800">{schedule.name}</p><p className="text-xs text-gray-500">{schedule.frequency} · prochain inventaire : {new Date(schedule.next_inventory_on).toLocaleDateString('fr-FR')}</p></div>{canRecord && <button onClick={() => startInventory(schedule)} className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Ouvrir la fiche</button>}</div>)}</div>}

      {showForm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}><div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className={`rounded-lg p-2 ${config.tone}`}><Icon className="h-5 w-5" /></span><h3 className="font-bold text-gray-900">{config.label}</h3></div><button onClick={() => setShowForm(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">Article<select required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-amber-500"><option value="">— Sélectionner —</option>{selectedItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block text-sm font-medium text-gray-700">Opération<select value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value as Operation })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-amber-500">{(Object.keys(OPERATION_LABEL) as Operation[]).map((key) => <option key={key} value={key}>{OPERATION_LABEL[key]}</option>)}</select></label>
          <label className="block text-sm font-medium text-gray-700">{form.operation === 'initial' ? 'Quantité comptée au démarrage' : 'Quantité'}<input required min="0.01" step="any" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-amber-500" /></label>
          <label className="block text-sm font-medium text-gray-700">Date<input required type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-amber-500" /></label>
          <label className="block text-sm font-medium text-gray-700">Observation (facultatif)<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-amber-500" /></label>
          {form.operation === 'initial' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Le stock actuel sera ajusté pour correspondre à la quantité comptée.</p>}
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 font-semibold text-white"><Boxes className="h-4 w-4" /> Enregistrer</button>
        </form>
      </div></div>}
      {showSchedule && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowSchedule(false)}><form onSubmit={saveSchedule} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex justify-between"><h3 className="font-bold">Programmer un inventaire</h3><button type="button" onClick={() => setShowSchedule(false)}><X className="h-5 w-5" /></button></div><div className="space-y-3"><label className="block text-sm font-medium">Nom<input required value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" /></label><label className="block text-sm font-medium">Fréquence<select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"><option value="quotidien">Quotidien</option><option value="hebdomadaire">Hebdomadaire</option><option value="mensuel">Mensuel</option></select></label><label className="block text-sm font-medium">Première date<input type="date" required value={scheduleForm.nextInventoryOn} onChange={(e) => setScheduleForm({ ...scheduleForm, nextInventoryOn: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" /></label><button className="w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-white">Créer le programme</button></div></form></div>}
      {activeLines && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="mb-3 flex justify-between"><div><h3 className="font-bold">Fiche d’inventaire</h3><p className="text-xs text-gray-500">Saisissez le stock compté ; l’écart est calculé automatiquement.</p></div><button onClick={() => { setActiveLines(null); setActiveSessionId(null); }}><X className="h-5 w-5" /></button></div><div className="space-y-2">{activeLines.map((line) => { const item = line.item_category === 'ingredient' ? ingredients.find((i) => i.id === line.ingredient_id) : pots.find((p) => p.id === line.pot_type_id); const diff = line.counted_quantity == null ? null : line.counted_quantity - Number(line.theoretical_quantity); return <div key={line.id} className="grid grid-cols-[1fr_90px_90px] gap-2 rounded-lg border border-gray-100 p-2 text-sm"><div><p className="font-medium">{item?.name ?? 'Article'}</p><p className="text-xs text-gray-500">{CATEGORY[line.item_category].label} · théorique {line.theoretical_quantity}</p></div><input type="number" placeholder="Compté" value={line.counted_quantity ?? ''} onChange={(e) => updateCount(line, e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" /><p className={`self-center text-right font-semibold ${diff == null || diff === 0 ? 'text-gray-500' : diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff}`}</p></div>; })}</div><button onClick={validateInventory} className="mt-4 w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-white">Valider la fiche d’inventaire</button></div></div>}
    </section>
  );
}
