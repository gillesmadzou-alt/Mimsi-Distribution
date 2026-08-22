import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, formatFCFA, EXPENSE_TYPE_LABELS, type DeliveryExpense, type ExpenseType, type SalesPoint } from '@/lib/supabase';
import { downloadExcelReport, downloadPdfReport } from '@/lib/exportUtils';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { mergePendingSalesPoints } from '@/lib/offlineSalesPoints';
import { Receipt, Calendar, Truck, Users, ChevronDown, ChevronRight, TrendingDown, MapPin, Store, FileSpreadsheet, FileText, X, CloudOff } from 'lucide-react';

type GroupBy = 'day' | 'tournee' | 'driver';
type PeriodFilter = 'today' | 'month' | 'year' | 'custom' | 'all';

export default function ExpensesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [expenses, setExpenses] = useState<DeliveryExpense[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filters
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [salesPointFilter, setSalesPointFilter] = useState<string>('');
  const [zoneFilter, setZoneFilter] = useState<string>('');

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await fetchWithCache('expenses_page', async () => {
      const [expRes, spRes] = await Promise.all([
        supabase
          .from('delivery_expenses')
          .select('*, sales_point:sales_points(*), driver:drivers(*), batch:delivery_batches(batch_code)')
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
      ]);
      if (expRes.error) throw expRes.error;
      return { expenses: (expRes.data as DeliveryExpense[]) ?? [], salesPoints: (spRes.data as SalesPoint[]) ?? [] };
    });
    if (result.data) {
      setExpenses(result.data.expenses);
      setSalesPoints(await mergePendingSalesPoints(result.data.salesPoints));
    } else {
      setLoadError(result.error ?? 'Erreur lors du chargement des depenses.');
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('expenses_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_expenses' }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData, isOffline]);

  const zones = useMemo(() => {
    const set = new Set<string>();
    salesPoints.forEach((sp) => { if (sp.zone) set.add(sp.zone); });
    return Array.from(set).sort();
  }, [salesPoints]);

  // Date range computation
  const dateRange = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      const today = now.toISOString().slice(0, 10);
      return { start: today, end: today };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      return { start, end };
    }
    if (period === 'year') {
      const start = `${now.getFullYear()}-01-01`;
      const end = `${now.getFullYear()}-12-31`;
      return { start, end };
    }
    if (period === 'custom') {
      return { start: customStart || '0000-01-01', end: customEnd || '9999-12-31' };
    }
    return { start: '0000-01-01', end: '9999-12-31' };
  }, [period, customStart, customEnd]);

  // Apply filters
  const filtered = useMemo(() => {
    return expenses.filter((exp) => {
      // Date filter
      if (exp.expense_date < dateRange.start || exp.expense_date > dateRange.end) return false;
      // Sales point filter
      if (salesPointFilter && exp.sales_point_id !== salesPointFilter) return false;
      // Zone filter
      if (zoneFilter && exp.sales_point?.zone !== zoneFilter) return false;
      return true;
    });
  }, [expenses, dateRange, salesPointFilter, zoneFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, DeliveryExpense[]>();
    for (const exp of filtered) {
      let key: string;
      let label: string;
      if (groupBy === 'day') {
        key = exp.expense_date;
        label = new Date(exp.expense_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      } else if (groupBy === 'tournee') {
        key = exp.batch?.batch_code ?? exp.batch_id ?? '—';
        label = `Tournée ${key}`;
      } else {
        key = exp.driver?.full_name ?? exp.driver_id ?? '—';
        label = key;
      }
      if (!map.has(key)) map.set(key, []);
      (map.get(key)! as DeliveryExpense[]).push({ ...exp, _groupLabel: label } as DeliveryExpense);
    }
    return map;
  }, [filtered, groupBy]);

  const grandTotal = filtered.reduce((s, e) => s + e.amount_fcfa, 0);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupByLabel: Record<GroupBy, string> = {
    day: 'Par jour',
    tournee: 'Par tournée',
    driver: 'Par commercial',
  };

  const periodLabel: Record<PeriodFilter, string> = {
    today: "Aujourd'hui",
    month: 'Ce mois',
    year: 'Cette année',
    custom: 'Période personnalisée',
    all: 'Toutes les périodes',
  };

  const hasActiveFilters = salesPointFilter || zoneFilter || period !== 'all';

  const resetFilters = () => {
    setPeriod('all');
    setCustomStart('');
    setCustomEnd('');
    setSalesPointFilter('');
    setZoneFilter('');
  };

  // Export functions
  const buildExportRows = () => {
    return filtered.map((exp) => ({
      date: new Date(exp.expense_date).toLocaleDateString('fr-FR'),
      type: EXPENSE_TYPE_LABELS[exp.expense_type],
      amount: exp.amount_fcfa,
      amountFormatted: formatFCFA(exp.amount_fcfa),
      salesPoint: exp.sales_point?.name ?? '—',
      zone: exp.sales_point?.zone ?? '—',
      driver: exp.driver?.full_name ?? '—',
      batch: exp.batch?.batch_code ?? '—',
      reason: exp.reason || '—',
      authorizedBy: exp.authorized_by || '—',
    }));
  };

  const exportColumns = [
    { header: 'Date', key: 'date' },
    { header: 'Type', key: 'type' },
    { header: 'Montant (FCFA)', key: 'amount', align: 'right' as const },
    { header: 'Point de vente', key: 'salesPoint' },
    { header: 'Zone', key: 'zone' },
    { header: 'Commercial', key: 'driver' },
    { header: 'Tournée', key: 'batch' },
    { header: 'Motif', key: 'reason' },
    { header: 'Autorisé par', key: 'authorizedBy' },
  ];

  const exportSummary = [
    { label: 'Période', value: periodLabel[period] + (period === 'custom' && customStart ? ` (${customStart}${customEnd ? ' → ' + customEnd : ''})` : '') },
    { label: 'Point de vente', value: salesPointFilter ? salesPoints.find((sp) => sp.id === salesPointFilter)?.name ?? '—' : 'Tous' },
    { label: 'Zone', value: zoneFilter || 'Toutes' },
    { label: 'Nombre de dépenses', value: String(filtered.length) },
    { label: 'Total', value: formatFCFA(grandTotal) },
  ];

  const handleExportExcel = () => {
    downloadExcelReport({
      title: 'Dépenses de livraison',
      columns: exportColumns,
      rows: buildExportRows(),
      summary: exportSummary,
      fileName: 'depenses_livraison',
    });
  };

  const handleExportPdf = () => {
    downloadPdfReport({
      title: 'Dépenses de livraison',
      subtitle: `${periodLabel[period]}${zoneFilter ? ` · Zone: ${zoneFilter}` : ''}${salesPointFilter ? ` · PDV: ${salesPoints.find((sp) => sp.id === salesPointFilter)?.name ?? ''}` : ''}`,
      columns: exportColumns,
      rows: buildExportRows(),
      summary: exportSummary,
      fileName: 'depenses_livraison',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Receipt className="w-5 h-5 text-amber-500" />
          Dépenses de livraison
        </h2>
        <div className="flex items-center gap-2">
          {/* Export buttons */}
          <button
            onClick={handleExportExcel}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={handleExportPdf}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
        {/* Period filter */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Période</label>
          <div className="flex flex-wrap gap-2">
            {(['today', 'month', 'year', 'custom', 'all'] as PeriodFilter[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  period === p ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {periodLabel[p]}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-amber-500"
              />
              <span className="text-gray-400 text-xs">à</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-amber-500"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Sales point filter */}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
              <Store className="w-3.5 h-3.5" /> Point de vente
            </label>
            <select
              value={salesPointFilter}
              onChange={(e) => setSalesPointFilter(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500 bg-white"
            >
              <option value="">Tous les points de vente</option>
              {salesPoints.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </div>

          {/* Zone filter */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Zone
            </label>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-amber-500 bg-white"
            >
              <option value="">Toutes les zones</option>
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {/* Group by selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400">Regrouper :</span>
        {(['day', 'tournee', 'driver'] as GroupBy[]).map((g) => (
          <button
            key={g}
            onClick={() => { setGroupBy(g); setExpanded(new Set()); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              groupBy === g ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {groupByLabel[g]}
          </button>
        ))}
      </div>

      {/* Grand total card */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-2xl p-5 text-white shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-amber-100">Total des dépenses (filtré)</p>
            <p className="text-3xl font-bold mt-1">{formatFCFA(grandTotal)}</p>
          </div>
          <TrendingDown className="w-12 h-12 text-amber-200" />
        </div>
        <div className="flex gap-4 mt-3 text-sm">
          <span className="text-amber-100">{filtered.length} dépense(s)</span>
          <span className="text-amber-100">{grouped.size} groupe(s)</span>
          {zoneFilter && <span className="text-amber-100">Zone: {zoneFilter}</span>}
        </div>
      </div>

      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && expenses.length === 0 ? (
        <div className="text-center py-20 text-gray-400 flex flex-col items-center gap-2">
          <CloudOff className="w-12 h-12 text-gray-300" />
          <p>Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les dépenses.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          {hasActiveFilters ? 'Aucune dépense ne correspond aux filtres' : 'Aucune dépense enregistrée'}
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([key, items]) => {
            const groupTotal = items.reduce((s, e) => s + e.amount_fcfa, 0);
            const isExpanded = expanded.has(key);
            const label = (items[0] as any)._groupLabel ?? key;
            const icon = groupBy === 'day' ? Calendar : groupBy === 'tournee' ? Truck : Users;
            const Icon = icon;

            const byType = new Map<ExpenseType, number>();
            for (const e of items) {
              byType.set(e.expense_type, (byType.get(e.expense_type) ?? 0) + e.amount_fcfa);
            }

            return (
              <div key={key} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors flex items-center gap-3"
                  onClick={() => toggle(key)}
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 capitalize">{label}</p>
                    <p className="text-xs text-gray-500">{items.length} dépense(s) · {byType.size} type(s)</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-gray-900">{formatFCFA(groupTotal)}</p>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </div>

                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-gray-100 pt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {Array.from(byType.entries()).map(([type, amt]) => (
                        <span key={type} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 text-amber-700">
                          {EXPENSE_TYPE_LABELS[type]}: {formatFCFA(amt)}
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {items.map((exp) => (
                        <div key={exp.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
                          <Receipt className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-900">{EXPENSE_TYPE_LABELS[exp.expense_type]}</span>
                              {exp.expense_type === 'credit_autorise' && exp.authorized_by && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                                  Autorisé par {exp.authorized_by}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              {exp.sales_point?.name ?? '—'}
                              {exp.sales_point?.zone ? ` · ${exp.sales_point.zone}` : ''}
                              {exp.batch?.batch_code ? (
                                <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate?.('batches')}> · {exp.batch.batch_code}</span>
                              ) : ''}
                              {exp.driver?.full_name ? (
                                <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate?.('drivers')}> · {exp.driver.full_name}</span>
                              ) : ''}
                              {exp.reason ? ` · ${exp.reason}` : ''}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-gray-900 shrink-0">{formatFCFA(exp.amount_fcfa)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
