import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Building2, CircleDollarSign, Loader2, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { supabase, formatFCFA, getRoleAccessLevel, type AccountingEntry } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useConfirm } from '@/contexts/ConfirmContext';

type Tab = 'cash' | 'clients' | 'bank';
type ClientBalance = { id: string; name: string; billed: number; paid: number; due: number };

const TABS: { id: Tab; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'Journal de caisse', icon: Banknote },
  { id: 'clients', label: 'Comptes clients', icon: Users },
  { id: 'bank', label: 'Compte banque', icon: Building2 },
];

const PAYMENT_LABELS: Record<AccountingEntry['payment_method'], string> = {
  especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement',
  cheque: 'Chèque', carte: 'Carte', autre: 'Autre',
};

function buildRunningBalances(items: AccountingEntry[], clientScoped = false) {
  const balances = new Map<string, number>();
  const runningByAccount = new Map<string, number>();
  [...items]
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at))
    .forEach((entry) => {
      const accountKey = clientScoped ? (entry.client_name?.trim().toLowerCase() || entry.id) : entry.account_type;
      const previous = runningByAccount.get(accountKey) ?? 0;
      const signedAmount = entry.movement_type === (clientScoped ? 'expense' : 'income')
        ? Number(entry.amount_fcfa)
        : -Number(entry.amount_fcfa);
      const balance = previous + signedAmount;
      runningByAccount.set(accountKey, balance);
      balances.set(entry.id, balance);
    });
  return balances;
}

function EntryActions({ entry, allowed, onEdit, onDelete }: {
  entry: AccountingEntry;
  allowed: boolean;
  onEdit: (entry: AccountingEntry) => void;
  onDelete: (entry: AccountingEntry) => void;
}) {
  if (!allowed) return <span className="text-xs text-gray-400">Protégée</span>;

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onEdit(entry)} title="Modifier" aria-label={`Modifier ${entry.label}`} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50">
        <Pencil className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => void onDelete(entry)} title="Supprimer" aria-label={`Supprimer ${entry.label}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AccountKeepingPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { confirmDialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<Tab>('cash');
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AccountingEntry | null>(null);
  const [form, setForm] = useState({
    movement_type: 'income' as AccountingEntry['movement_type'], entry_date: new Date().toISOString().slice(0, 10),
    label: '', amount: '', payment_method: 'especes' as AccountingEntry['payment_method'], notes: '', client_name: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const entriesResult = await supabase.from('accounting_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false });
    if (entriesResult.error) {
      setError(entriesResult.error.message ?? 'Chargement impossible.');
    } else {
      setEntries((entriesResult.data as AccountingEntry[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeSubscription('account-keeping-page', ['accounting_entries'], loadData);

  const allAccountEntries = useMemo(() => {
    const accountType = activeTab === 'bank' ? 'bank' : 'cash';
    return entries.filter((entry) => entry.account_type === accountType);
  }, [activeTab, entries]);

  const accountBalances = useMemo(() => buildRunningBalances(allAccountEntries), [allAccountEntries]);

  const accountEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allAccountEntries.filter((entry) => !query
      || entry.label.toLowerCase().includes(query)
      || (entry.reference ?? '').toLowerCase().includes(query)
      || entry.operation_nature.toLowerCase().includes(query)
      || entry.account_number.includes(query));
  }, [allAccountEntries, search]);

  const totals = useMemo(() => {
    const income = allAccountEntries.filter((entry) => entry.movement_type === 'income').reduce((sum, entry) => sum + Number(entry.amount_fcfa), 0);
    const expense = allAccountEntries.filter((entry) => entry.movement_type === 'expense').reduce((sum, entry) => sum + Number(entry.amount_fcfa), 0);
    return { income, expense, balance: income - expense };
  }, [allAccountEntries]);

  const clientBalances = useMemo<ClientBalance[]>(() => {
    const grouped = new Map<string, ClientBalance>();
    for (const entry of entries.filter((item) => item.account_type === 'client' && item.client_name)) {
      const normalizedName = entry.client_name!.trim().toLowerCase();
      const id = `client:${normalizedName}`;
      const current = grouped.get(id) ?? { id, name: entry.client_name!, billed: 0, paid: 0, due: 0 };
      if (entry.movement_type === 'expense') current.billed += Number(entry.amount_fcfa);
      else current.paid += Number(entry.amount_fcfa);
      current.due = current.billed - current.paid;
      grouped.set(current.id, current);
    }
    const query = search.trim().toLowerCase();
    return [...grouped.values()].filter((client) => !query || client.name.toLowerCase().includes(query)).sort((a, b) => b.due - a.due);
  }, [entries, search]);

  const manualClientEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => entry.account_type === 'client' && (!query
      || (entry.client_name ?? '').toLowerCase().includes(query)
      || entry.label.toLowerCase().includes(query)
      || (entry.reference ?? '').toLowerCase().includes(query)
      || entry.operation_nature.toLowerCase().includes(query)
      || entry.account_number.includes(query)));
  }, [entries, search]);
  const allManualClientEntries = useMemo(() => entries.filter((entry) => entry.account_type === 'client'), [entries]);
  const clientEntryBalances = useMemo(() => buildRunningBalances(allManualClientEntries, true), [allManualClientEntries]);
  const accessLevel = getRoleAccessLevel(profile?.role ?? 1, profile?.access_level);
  const canManageEntry = (entry: AccountingEntry) => !entry.source_table && (accessLevel >= 5 || entry.created_by === profile?.id);

  const openCreate = () => {
    setEditingEntry(null);
    setForm({ movement_type: activeTab === 'clients' ? 'expense' : 'income', entry_date: new Date().toISOString().slice(0, 10), label: '', amount: '', payment_method: 'especes', notes: '', client_name: '' });
    setShowForm(true);
  };

  const openEdit = (entry: AccountingEntry) => {
    setEditingEntry(entry);
    setActiveTab(entry.account_type === 'client' ? 'clients' : entry.account_type);
    setForm({ movement_type: entry.movement_type, entry_date: entry.entry_date, label: entry.label, amount: String(entry.amount_fcfa), payment_method: entry.payment_method, notes: entry.notes ?? '', client_name: entry.client_name ?? '' });
    setShowForm(true);
  };

  const deleteEntry = async (entry: AccountingEntry) => {
    if (!(await confirmDialog({ message: `Supprimer définitivement l’écriture « ${entry.label} » ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    const { error: deleteError } = await supabase.from('accounting_entries').delete().eq('id', entry.id);
    if (deleteError) setError(deleteError.message);
    else await loadData();
  };

  const saveEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !form.label.trim() || Number(form.amount) <= 0 || (activeTab === 'clients' && !form.client_name.trim())) return;
    setSaving(true);
    setError(null);
    const payload = {
      account_type: activeTab === 'clients' ? 'client' : activeTab === 'bank' ? 'bank' : 'cash', movement_type: form.movement_type,
      entry_date: form.entry_date, label: form.label.trim(), amount_fcfa: Number(form.amount),
      payment_method: form.payment_method,
      notes: form.notes.trim() || null, client_name: activeTab === 'clients' ? form.client_name.trim() : null,
    };
    const result = editingEntry
      ? await supabase.from('accounting_entries').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingEntry.id)
      : await supabase.from('accounting_entries').insert({ ...payload, created_by: profile.id });
    if (result.error) setError(result.error.message);
    else {
      setShowForm(false);
      setEditingEntry(null);
      await loadData();
    }
    setSaving(false);
  };

  const clientTotals = clientBalances.reduce((result, client) => ({
    billed: result.billed + client.billed, paid: result.paid + client.paid, due: result.due + client.due,
  }), { billed: 0, paid: 0, due: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tenue de compte</h2>
          <p className="mt-1 text-sm text-gray-500">Caisse, soldes clients et mouvements bancaires dans un même espace.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 font-medium text-white shadow-md">
            <Plus className="h-4 w-4" /> Nouvelle écriture
        </button>
      </div>

      <div className="grid gap-2 rounded-2xl border border-gray-200 bg-white p-2 sm:grid-cols-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setActiveTab(id); setSearch(''); }} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${activeTab === id ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === 'clients' ? 'Rechercher un client…' : 'Rechercher un libellé ou une référence…'} className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div> : activeTab === 'clients' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[['Total facturé', clientTotals.billed], ['Total encaissé', clientTotals.paid], ['Reste à encaisser', clientTotals.due]].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{formatFCFA(Number(value))}</p></div>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50"><tr>{['Client', 'Facturé', 'Encaissé', 'Solde', ''].map((header) => <th key={header} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{header}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">{clientBalances.map((client) => <tr key={client.id}><td className="px-4 py-3 font-medium text-gray-900">{client.name}</td><td className="px-4 py-3 text-sm">{formatFCFA(client.billed)}</td><td className="px-4 py-3 text-sm text-emerald-700">{formatFCFA(client.paid)}</td><td className="px-4 py-3 text-sm font-semibold text-amber-700">{formatFCFA(client.due)}</td><td className="px-4 py-3 text-right"><button onClick={() => onNavigate?.('receivables')} className="text-xs font-medium text-blue-600 hover:underline">Voir les créances</button></td></tr>)}</tbody>
            </table></div>
            {clientBalances.length === 0 && <p className="p-10 text-center text-sm text-gray-400">Aucun compte client trouvé.</p>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-semibold text-gray-900">Mouvements des comptes clients</h3><p className="text-xs text-gray-500">Les écritures automatiques sont protégées ; les ajustements manuels restent modifiables.</p></div>
            <div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50"><tr>{['Date', 'Référence', 'Journal', 'Classe', 'Compte', 'Nature', 'Contrepartie', 'Client', 'Libellé', 'Entrée / débit', 'Sortie / crédit', 'Solde', 'Actions'].map((header) => <th key={header} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{header}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">
              {manualClientEntries.map((entry) => <tr key={entry.id}><td className="px-4 py-3 text-sm text-gray-500">{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString('fr-FR')}</td><td className="px-4 py-3 text-xs font-semibold text-gray-600">{entry.reference}</td><td className="px-4 py-3 text-xs font-bold text-orange-700">{entry.journal_code}</td><td className="px-4 py-3 text-sm">{entry.account_class}</td><td className="px-4 py-3 text-sm"><span className="font-semibold">{entry.account_number}</span> — {entry.account_label}</td><td className="px-4 py-3 text-sm">{entry.operation_nature}</td><td className="px-4 py-3 text-sm"><span className="font-semibold">{entry.counterpart_account_number}</span> — {entry.counterpart_account_label}</td><td className="px-4 py-3 text-sm font-medium">{entry.client_name}</td><td className="px-4 py-3 text-sm">{entry.label}</td><td className="px-4 py-3 text-sm font-semibold text-amber-700">{entry.movement_type === 'expense' ? formatFCFA(entry.amount_fcfa) : '—'}</td><td className="px-4 py-3 text-sm font-semibold text-emerald-700">{entry.movement_type === 'income' ? formatFCFA(entry.amount_fcfa) : '—'}</td><td className="px-4 py-3 text-sm font-bold text-gray-900">{formatFCFA(clientEntryBalances.get(entry.id) ?? 0)}</td><td className="px-4 py-3"><EntryActions entry={entry} allowed={canManageEntry(entry)} onEdit={openEdit} onDelete={deleteEntry} /></td></tr>)}
            </tbody></table></div>{manualClientEntries.length === 0 && <p className="p-8 text-center text-sm text-gray-400">Aucun ajustement manuel.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[['Entrées', totals.income], ['Sorties', totals.expense], ['Solde', totals.balance]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{formatFCFA(Number(value))}</p></div>)}
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50"><tr>{['Date', 'Référence', 'Journal', 'Classe', 'Compte', 'Nature', 'Contrepartie', 'Libellé', 'Moyen', 'Entrée', 'Sortie', 'Solde', 'Actions'].map((header) => <th key={header} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{header}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">
            {accountEntries.map((entry) => <tr key={entry.id}><td className="px-4 py-3 text-sm text-gray-500">{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString('fr-FR')}</td><td className="px-4 py-3 text-sm text-gray-500">{entry.reference ?? '—'}</td><td className="px-4 py-3 text-xs font-bold text-orange-700">{entry.journal_code}</td><td className="px-4 py-3 text-sm">{entry.account_class}</td><td className="px-4 py-3 text-sm"><span className="font-semibold">{entry.account_number}</span> — {entry.account_label}</td><td className="px-4 py-3 text-sm">{entry.operation_nature}</td><td className="px-4 py-3 text-sm"><span className="font-semibold">{entry.counterpart_account_number}</span> — {entry.counterpart_account_label}</td><td className="px-4 py-3 text-sm font-medium text-gray-900">{entry.label}</td><td className="px-4 py-3 text-sm text-gray-500">{PAYMENT_LABELS[entry.payment_method]}</td><td className="px-4 py-3 text-sm font-semibold text-emerald-700">{entry.movement_type === 'income' ? formatFCFA(entry.amount_fcfa) : '—'}</td><td className="px-4 py-3 text-sm font-semibold text-red-600">{entry.movement_type === 'expense' ? formatFCFA(entry.amount_fcfa) : '—'}</td><td className="px-4 py-3 text-sm font-bold text-gray-900">{formatFCFA(accountBalances.get(entry.id) ?? 0)}</td><td className="px-4 py-3"><EntryActions entry={entry} allowed={canManageEntry(entry)} onEdit={openEdit} onDelete={deleteEntry} /></td></tr>)}
          </tbody></table></div>{accountEntries.length === 0 && <p className="p-10 text-center text-sm text-gray-400">Aucune écriture enregistrée.</p>}</div>
        </>
      )}

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold text-gray-900">{editingEntry ? 'Modifier' : 'Nouvelle'} écriture — {activeTab === 'clients' ? 'Client' : activeTab === 'bank' ? 'Banque' : 'Caisse'}</h3><button onClick={() => setShowForm(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div><form onSubmit={saveEntry} className="space-y-3">
        {activeTab === 'clients' && <input required value={form.client_name} onChange={(event) => setForm({ ...form, client_name: event.target.value })} placeholder="Nom du client" className="w-full rounded-xl border border-gray-200 px-3 py-2.5" />}
        <div className="grid grid-cols-2 gap-3"><select value={form.movement_type} onChange={(event) => setForm({ ...form, movement_type: event.target.value as AccountingEntry['movement_type'] })} className="rounded-xl border border-gray-200 px-3 py-2.5"><option value="income">{activeTab === 'clients' ? 'Crédit / règlement' : 'Entrée'}</option><option value="expense">{activeTab === 'clients' ? 'Débit / nouvelle dette' : 'Sortie'}</option></select><input type="date" required value={form.entry_date} onChange={(event) => setForm({ ...form, entry_date: event.target.value })} className="rounded-xl border border-gray-200 px-3 py-2.5" /></div>
        <input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Libellé de l’écriture" className="w-full rounded-xl border border-gray-200 px-3 py-2.5" />
        <div className="grid grid-cols-2 gap-3"><input type="number" min="1" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Montant FCFA" className="rounded-xl border border-gray-200 px-3 py-2.5" /><select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value as AccountingEntry['payment_method'] })} className="rounded-xl border border-gray-200 px-3 py-2.5">{Object.entries(PAYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">La référence, le journal, la nature, le compte et la classe SYSCOHADA sont générés automatiquement. Une saisie ancienne actualise automatiquement le classement et la numérotation.</p><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes (facultatif)" rows={2} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5" />
        <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />} {editingEntry ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
      </form></div></div>}
    </div>
  );
}
