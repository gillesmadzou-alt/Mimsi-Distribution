import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  supabase, Profile, ROLE_LABELS, SalaryPayment, SalaryPaymentMethod, formatFCFA,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import { downloadPdfReport } from '@/lib/exportUtils';
import {
  Wallet, Loader2, Save, FileDown, Trash2, Users, CalendarDays,
} from 'lucide-react';

const PAYMENT_METHOD_LABELS: Record<SalaryPaymentMethod, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement',
  cheque: 'Chèque',
  autre: 'Autre',
};

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function currentPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function PayrollPage() {
  const { toast } = useToast();
  const { isOffline } = useOfflineFetch();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, string>>({});
  const [salarySaving, setSalarySaving] = useState<string | null>(null);

  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const { month: initialMonth, year: initialYear } = currentPeriod();
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [periodMonth, setPeriodMonth] = useState(initialMonth);
  const [periodYear, setPeriodYear] = useState(initialYear);
  const [grossAmount, setGrossAmount] = useState('');
  const [deductions, setDeductions] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<SalaryPaymentMethod>('virement');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name');
    if (!error && data) {
      const rows = data as Profile[];
      setProfiles(rows);
      setSalaryDrafts((prev) => {
        const next = { ...prev };
        for (const p of rows) if (next[p.id] === undefined) next[p.id] = p.monthly_salary_fcfa != null ? String(p.monthly_salary_fcfa) : '';
        return next;
      });
    }
    setProfilesLoading(false);
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  useRealtimeSubscription('payroll-profiles', isOffline ? [] : ['profiles'], loadProfiles);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    const { data, error } = await supabase
      .from('salary_payments')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error) setPayments((data as SalaryPayment[]) ?? []);
    setPaymentsLoading(false);
  }, []);

  useEffect(() => { loadPayments(); }, [loadPayments]);
  useRealtimeSubscription('payroll-payments', isOffline ? [] : ['salary_payments'], loadPayments);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const saveReferenceSalary = async (profileId: string) => {
    const raw = (salaryDrafts[profileId] ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (Number.isNaN(value) || (value as number) < 0)) {
      toast('Montant invalide.', 'error');
      return;
    }
    setSalarySaving(profileId);
    const { error } = await supabase.from('profiles').update({ monthly_salary_fcfa: value }).eq('id', profileId);
    setSalarySaving(null);
    if (error) {
      toast("Impossible d'enregistrer le salaire de référence.", 'error');
      return;
    }
    toast('Salaire de référence enregistré.', 'success');
  };

  const selectProfileForPayslip = (profileId: string) => {
    setSelectedProfileId(profileId);
    const p = profileById.get(profileId);
    if (p?.monthly_salary_fcfa != null) setGrossAmount(String(p.monthly_salary_fcfa));
  };

  const createPayslip = async (event: React.FormEvent) => {
    event.preventDefault();
    const gross = Number(grossAmount);
    const ded = Number(deductions || '0');
    if (!selectedProfileId) {
      toast('Choisissez un employé.', 'error');
      return;
    }
    if (!gross || gross <= 0 || Number.isNaN(gross)) {
      toast('Le salaire brut doit être un montant positif.', 'error');
      return;
    }
    if (Number.isNaN(ded) || ded < 0 || ded > gross) {
      toast('Les déductions doivent être comprises entre 0 et le salaire brut.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('salary_payments').insert({
      profile_id: selectedProfileId,
      period_month: periodMonth,
      period_year: periodYear,
      gross_amount_fcfa: gross,
      deductions_fcfa: ded,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast(
        error.message.includes('duplicate') || error.message.includes('unique')
          ? 'Une fiche de paie existe déjà pour cet employé sur cette période.'
          : "Impossible d'enregistrer la fiche de paie.",
        'error',
      );
      return;
    }
    toast('Fiche de paie enregistrée et transmise à la tenue de compte.', 'success');
    setNotes('');
    loadPayments();
  };

  const deletePayslip = async (id: string) => {
    if (!window.confirm('Supprimer cette fiche de paie ? L\'écriture comptable liée sera aussi supprimée.')) return;
    const { error } = await supabase.from('salary_payments').delete().eq('id', id);
    if (error) {
      toast('Impossible de supprimer.', 'error');
      return;
    }
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const downloadPayslip = (payment: SalaryPayment) => {
    const employee = profileById.get(payment.profile_id);
    const employeeName = employee?.full_name ?? 'Employé';
    downloadPdfReport({
      title: `Fiche de paie — ${employeeName}`,
      subtitle: `Période : ${MONTH_LABELS[payment.period_month - 1]} ${payment.period_year} · Mimsi Distribution`,
      columns: [
        { header: 'Élément', key: 'label' },
        { header: 'Montant (FCFA)', key: 'amount', align: 'right' },
      ],
      rows: [
        { label: 'Salaire brut', amount: formatFCFA(payment.gross_amount_fcfa) },
        { label: 'Déductions', amount: '-' + formatFCFA(payment.deductions_fcfa) },
      ],
      summary: [
        { label: 'Net à payer', value: formatFCFA(payment.net_amount_fcfa) },
        { label: 'Mode de paiement', value: PAYMENT_METHOD_LABELS[payment.payment_method] },
        { label: 'Date de paiement', value: new Date(payment.payment_date).toLocaleDateString('fr-FR') },
        { label: 'Fonction', value: employee ? ROLE_LABELS[employee.role] : '—' },
      ],
      fileName: `Fiche_de_paie_${employeeName.replace(/\s+/g, '_')}_${payment.period_month}_${payment.period_year}`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" /> Paiement des salaires</h1>
        <p className="text-sm text-gray-500 mt-1">
          Préparez les fiches de paie du personnel — chaque versement génère automatiquement une écriture dans la Tenue de compte (classée SYSCOHADA, compte 661).
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><Users className="w-4 h-4 text-gray-400" /> Salaires de référence</h3>
        <p className="text-xs text-gray-400">Préremplit le montant brut lors de la préparation d'une fiche de paie. Sans effet sur les fiches déjà enregistrées.</p>
        {profilesLoading ? (
          <div className="text-sm text-gray-400">Chargement…</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.full_name}</p>
                  <p className="text-xs text-gray-400">{ROLE_LABELS[p.role]}</p>
                </div>
                <input
                  type="number"
                  min="0"
                  value={salaryDrafts[p.id] ?? ''}
                  onChange={(e) => setSalaryDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="Salaire brut"
                  className="w-32 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => saveReferenceSalary(p.id)}
                  disabled={salarySaving === p.id}
                  className="shrink-0 p-2 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                  title="Enregistrer"
                >
                  {salarySaving === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-gray-400" /> Nouvelle fiche de paie</h3>
        <form onSubmit={createPayslip} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={selectedProfileId}
              onChange={(e) => selectProfileForPayslip(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">Employé…</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {ROLE_LABELS[p.role]}</option>)}
            </select>
            <div className="flex gap-2">
              <select
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                {MONTH_LABELS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input
                type="number"
                value={periodYear}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
                className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <input
              type="number"
              min="0"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              placeholder="Salaire brut (FCFA)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <input
              type="number"
              min="0"
              value={deductions}
              onChange={(e) => setDeductions(e.target.value)}
              placeholder="Déductions (FCFA)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as SalaryPaymentMethod)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optionnel)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          {grossAmount && (
            <p className="text-sm text-gray-500">
              Net à payer : <span className="font-semibold text-gray-800">{formatFCFA(Math.max(0, Number(grossAmount || '0') - Number(deductions || '0')))}</span>
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer la fiche de paie
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {paymentsLoading ? (
          <div className="text-sm text-gray-400 px-1">Chargement…</div>
        ) : payments.length === 0 ? (
          <p className="text-sm text-gray-400 px-1">Aucune fiche de paie enregistrée pour l'instant.</p>
        ) : (
          payments.map((payment) => {
            const employee = profileById.get(payment.profile_id);
            return (
              <div key={payment.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{employee?.full_name ?? 'Employé'}</p>
                  <p className="text-xs text-gray-400">
                    {MONTH_LABELS[payment.period_month - 1]} {payment.period_year} · {PAYMENT_METHOD_LABELS[payment.payment_method]} · {new Date(payment.payment_date).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-emerald-700 text-sm">{formatFCFA(payment.net_amount_fcfa)}</p>
                  {payment.deductions_fcfa > 0 && <p className="text-xs text-gray-400">brut {formatFCFA(payment.gross_amount_fcfa)}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => downloadPayslip(payment)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400" title="Télécharger la fiche de paie (PDF)">
                    <FileDown className="w-4 h-4" />
                  </button>
                  <button onClick={() => deletePayslip(payment.id)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Supprimer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
