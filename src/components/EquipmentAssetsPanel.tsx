import { useCallback, useEffect, useState } from 'react';
import { Hammer, PackagePlus, Pencil, Wrench, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { buildSteps, useOfflineSave } from '@/lib/useOfflineSave';
import { useToast } from '@/contexts/ToastContext';

type AssetType = 'materiel' | 'outil';
type Condition = 'neuf' | 'bon' | 'a_reparer' | 'hors_service';

interface EquipmentAsset {
  id: string; name: string; asset_type: AssetType; quantity: number; unit_value_fcfa: number;
  annual_annuity_fcfa: number; condition: Condition; location: string | null; notes: string | null; is_active: boolean;
}

const FCFA = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const conditionLabel: Record<Condition, string> = { neuf: 'Neuf', bon: 'Bon état', a_reparer: 'À réparer', hors_service: 'Hors service' };

export default function EquipmentAssetsPanel({ canRecord }: { canRecord: boolean }) {
  const { toast } = useToast();
  const { fetchWithCache } = useOfflineFetch();
  const { save } = useOfflineSave();
  const [items, setItems] = useState<EquipmentAsset[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EquipmentAsset | null>(null);
  const empty = { name: '', asset_type: 'materiel' as AssetType, quantity: '1', unit_value_fcfa: '', annual_annuity_fcfa: '', condition: 'bon' as Condition, location: '', notes: '' };
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    const result = await fetchWithCache('stock:equipment-assets:v1', async () => {
      const { data, error } = await supabase.from('equipment_assets').select('*').eq('is_active', true).order('asset_type').order('name');
      if (error) throw error;
      return data ?? [];
    });
    setItems((result.data ?? []) as EquipmentAsset[]);
  }, [fetchWithCache]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const channel = supabase.channel('equipment-assets').on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_assets' }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const openNew = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (item: EquipmentAsset) => { setEditing(item); setForm({ name: item.name, asset_type: item.asset_type, quantity: String(item.quantity), unit_value_fcfa: String(item.unit_value_fcfa), annual_annuity_fcfa: String(item.annual_annuity_fcfa), condition: item.condition, location: item.location ?? '', notes: item.notes ?? '' }); setShowForm(true); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = { name: form.name.trim(), asset_type: form.asset_type, quantity: Number(form.quantity), unit_value_fcfa: Number(form.unit_value_fcfa || 0), annual_annuity_fcfa: Number(form.annual_annuity_fcfa || 0), condition: form.condition, location: form.location.trim() || null, notes: form.notes.trim() || null };
    if (!payload.name || !Number.isFinite(payload.quantity) || payload.quantity < 0) { toast('Indiquez un nom et une quantité valide.', 'error'); return; }
    if (editing) {
      const { error } = await supabase.from('equipment_assets').update(payload).eq('id', editing.id);
      if (error) { toast('La modification n’a pas pu être enregistrée.', 'error'); return; }
      toast('Matériel mis à jour.', 'success'); load();
    } else {
      const result = await save('Matériel ou outil', 'stock', buildSteps().insert('equipment_assets', payload).getSteps());
      if (result.error && !result.queued) { toast('Le matériel n’a pas pu être enregistré.', 'error'); return; }
      toast(result.queued ? 'Matériel enregistré hors ligne : synchronisation automatique prévue.' : 'Matériel enregistré.', 'success');
      if (!result.queued) load();
    }
    setShowForm(false);
  };

  const totalValue = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_value_fcfa), 0);
  const annualTotal = items.reduce((sum, item) => sum + Number(item.annual_annuity_fcfa), 0);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-slate-800"><Wrench className="h-5 w-5 text-amber-600" /><h2 className="font-bold">Matériels et outils</h2></div><p className="mt-1 text-xs text-gray-600">Inventaire du matériel, valeur immobilisée et annuité annuelle.</p></div>{canRecord && <button onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white"><PackagePlus className="h-4 w-4" /> Ajouter un matériel</button>}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-gray-500">Éléments</p><p className="mt-1 font-bold text-slate-800">{items.length}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-gray-500">Quantité totale</p><p className="mt-1 font-bold text-slate-800">{items.reduce((sum, item) => sum + Number(item.quantity), 0)}</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Valeur totale</p><p className="mt-1 font-bold text-amber-800">{FCFA.format(totalValue)} FCFA</p></div><div className="rounded-xl bg-blue-50 p-3"><p className="text-xs text-blue-700">Annuité annuelle</p><p className="mt-1 font-bold text-blue-800">{FCFA.format(annualTotal)} FCFA</p></div></div>
    <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">{items.length === 0 ? <p className="p-5 text-center text-sm text-gray-400">Aucun matériel ou outil enregistré.</p> : items.map((item) => <div key={item.id} className="flex items-center gap-3 p-3"><span className="rounded-lg bg-amber-50 p-2 text-amber-700">{item.asset_type === 'outil' ? <Hammer className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate font-medium text-gray-800">{item.name}</p><p className="text-xs text-gray-500">{item.asset_type === 'outil' ? 'Outil' : 'Matériel'} · {item.quantity} · {conditionLabel[item.condition]}{item.location ? ` · ${item.location}` : ''}</p></div><div className="text-right text-xs"><p className="font-semibold text-gray-700">{FCFA.format(Number(item.quantity) * Number(item.unit_value_fcfa))} FCFA</p><p className="text-gray-500">annuité {FCFA.format(item.annual_annuity_fcfa)} FCFA</p></div>{canRecord && <button onClick={() => openEdit(item)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>}</div>)}</div>
    {showForm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}><form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{editing ? 'Modifier le matériel' : 'Nouveau matériel ou outil'}</h3><button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium sm:col-span-2">Nom<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-medium">Type<select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value as AssetType })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5"><option value="materiel">Matériel</option><option value="outil">Outil</option></select></label><label className="block text-sm font-medium">État<select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as Condition })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5">{Object.entries(conditionLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm font-medium">Quantité<input required min="0" step="any" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-medium">Valeur unitaire (FCFA)<input min="0" type="number" value={form.unit_value_fcfa} onChange={(e) => setForm({ ...form, unit_value_fcfa: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-medium">Annuité annuelle (FCFA)<input min="0" type="number" value={form.annual_annuity_fcfa} onChange={(e) => setForm({ ...form, annual_annuity_fcfa: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-medium">Emplacement<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-medium sm:col-span-2">Observation<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label></div><button className="mt-4 w-full rounded-xl bg-slate-800 py-2.5 font-semibold text-white">{editing ? 'Enregistrer les modifications' : 'Ajouter au registre'}</button></form></div>}
  </section>;
}
