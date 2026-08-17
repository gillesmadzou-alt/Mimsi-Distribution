import { useEffect, useState } from 'react';
import { Plus, Trash2, Receipt, UserCheck, Truck, Store, User } from 'lucide-react';
import { supabase, EXPENSE_TYPE_LABELS, type ExpenseType, type Profile } from '@/lib/supabase';
import { getCachedPageData, cachePageData } from '@/lib/readCache';

export interface ExpenseLine {
  id: string;
  expense_type: ExpenseType;
  amount_fcfa: number;
  authorized_by: string;
  reason: string;
}

interface ExpenseEntrySectionProps {
  expenses: ExpenseLine[];
  onChange: (expenses: ExpenseLine[]) => void;
  accent?: 'amber' | 'emerald';
  driverName?: string;
  salesPointName?: string;
  batchCode?: string;
}

export default function ExpenseEntrySection({ expenses, onChange, accent = 'amber', driverName, salesPointName, batchCode }: ExpenseEntrySectionProps) {
  const [authorizers, setAuthorizers] = useState<Profile[]>([]);

  useEffect(() => {
    const loadAuthorizers = async () => {
      if (!navigator.onLine) {
        const cached = await getCachedPageData<Profile[]>('expense:authorizers');
        setAuthorizers(cached?.data ?? []);
        return;
      }
      const { data } = await supabase.from('profiles').select('id, full_name, role, phone, avatar_url, is_active, created_at, updated_at')
        .gte('role', 4).eq('is_active', true).order('full_name');
      const authorizers = (data as Profile[]) ?? [];
      setAuthorizers(authorizers);
      await cachePageData('expense:authorizers', authorizers);
    };
    loadAuthorizers();
  }, []);

  const accentColor = accent === 'amber' ? 'amber' : 'emerald';
  const borderClass = `border-${accentColor}-200`;
  const focusClass = `focus:border-${accentColor}-500 focus:ring-${accentColor}-200`;
  const bgClass = `bg-${accentColor}-50`;
  const textClass = `text-${accentColor}-700`;
  const btnClass = `bg-${accentColor}-50 ${textClass} hover:bg-${accentColor}-100`;

  const addExpense = () => {
    onChange([
      ...expenses,
      { id: crypto.randomUUID(), expense_type: 'papier_pdv', amount_fcfa: 200, authorized_by: '', reason: '' },
    ]);
  };

  const updateExpense = (id: string, patch: Partial<ExpenseLine>) => {
    onChange(expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeExpense = (id: string) => {
    onChange(expenses.filter((e) => e.id !== id));
  };

  const total = expenses.reduce((s, e) => s + (e.amount_fcfa || 0), 0);

  return (
    <div className={`rounded-xl border ${borderClass} p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Receipt className="w-4 h-4 text-gray-400" />
            Dépenses de livraison
          </span>
          {(driverName || salesPointName || batchCode) && (
            <div className="flex flex-wrap gap-2 mt-1">
              {batchCode && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Truck className="w-3 h-3" /> {batchCode}
                </span>
              )}
              {driverName && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <User className="w-3 h-3" /> {driverName}
                </span>
              )}
              {salesPointName && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Store className="w-3 h-3" /> {salesPointName}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={addExpense}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${btnClass} text-xs font-medium transition-colors`}
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter
        </button>
      </div>

      {expenses.length === 0 && (
        <p className="text-xs text-gray-400 px-2 py-1.5 rounded-lg bg-gray-50 border border-dashed border-gray-200">
          Aucune dépense. Cliquez sur « Ajouter » pour enregistrer une dépense (carburant, papier, etc.).
        </p>
      )}

      {expenses.map((exp) => (
        <div key={exp.id} className="rounded-lg border border-gray-200 p-2.5 space-y-2 bg-white">
          <div className="flex gap-2 items-center">
            <select
              value={exp.expense_type}
              onChange={(e) => updateExpense(exp.id, { expense_type: e.target.value as ExpenseType })}
              className={`flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm ${focusClass} focus:ring-2 outline-none`}
            >
              {(Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[]).map((t) => (
                <option key={t} value={t}>
                  {EXPENSE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeExpense(exp.id)}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder="Montant"
              value={exp.amount_fcfa || ''}
              onChange={(e) => updateExpense(exp.id, { amount_fcfa: Number(e.target.value) })}
              className={`w-32 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm ${focusClass} focus:ring-2 outline-none`}
            />
            <span className="text-xs text-gray-400">FCFA</span>
            <input
              type="text"
              placeholder="Note (optionnel)"
              value={exp.reason}
              onChange={(e) => updateExpense(exp.id, { reason: e.target.value })}
              className={`flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm ${focusClass} focus:ring-2 outline-none`}
            />
          </div>
          {exp.expense_type === 'credit_autorise' && (
            <div className="flex items-center gap-2 pl-1">
              <UserCheck className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <select
                value={exp.authorized_by}
                onChange={(e) => updateExpense(exp.id, { authorized_by: e.target.value })}
                className={`flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm ${focusClass} focus:ring-2 outline-none`}
              >
                <option value="">Qui a autorisé ce crédit ?</option>
                {authorizers.map((a) => (
                  <option key={a.id} value={a.full_name}>{a.full_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}

      {expenses.length > 0 && (
        <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${bgClass}`}>
          <span className="text-xs font-medium text-gray-600">Total des dépenses</span>
          <span className={`text-sm font-bold ${textClass}`}>{total.toLocaleString('fr-FR')} FCFA</span>
        </div>
      )}
    </div>
  );
}
