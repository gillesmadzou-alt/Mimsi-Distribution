import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  supabase, formatFCFA,
  type Driver, type DeliveryBatch, type PotType, type ProductionRecord,
  type DoughDelivery, type Baker, type Kneader, type Receivable,
  type Deposit, type Return as ReturnRecord, type DeliveryExpense,
  type DoughBatch, type OpportunisticSale, type WeddingOrder,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import PeriodFilter, { PeriodRange } from '@/components/PeriodFilter';
import { sharePdfReport, downloadExcelReport } from '@/lib/exportUtils';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, Package, Factory, Cookie,
  ChevronDown, Users, ArrowRight, BarChart2, PieChart as PieIcon,
  Activity, AlertTriangle, CheckCircle2, XCircle, Flame, Scale,
  FileDown, FileSpreadsheet, Sparkles, Heart, CloudOff,
} from 'lucide-react';

type ChartTab = 'sales' | 'treasury' | 'receivables' | 'production';

const CHART_COLORS = {
  blue: '#3b82f6',
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  rose: '#f43f5e',
  indigo: '#6366f1',
  teal: '#14b8a6',
  orange: '#f97316',
};

const PIE_COLORS = [
  CHART_COLORS.blue, CHART_COLORS.emerald, CHART_COLORS.amber, CHART_COLORS.red,
  CHART_COLORS.violet, CHART_COLORS.cyan, CHART_COLORS.rose, CHART_COLORS.indigo,
  CHART_COLORS.teal, CHART_COLORS.orange,
];

interface DailyPoint {
  date: string;
  label: string;
  revenue: number;
  deposits: number;
  returns: number;
  expenses: number;
  net: number;
}

interface DriverPoint {
  name: string;
  revenue: number;
  deposits: number;
  returns: number;
  sellThrough: number;
}

interface ReceivablePoint {
  name: string;
  due: number;
  paid: number;
  outstanding: number;
}

interface ProductionPoint {
  date: string;
  label: string;
  good: number;
  burned: number;
  broken: number;
  defective: number;
  pots: number;
}

interface BakerPoint {
  name: string;
  good: number;
  burned: number;
  pots: number;
}

interface DoughPoint {
  date: string;
  label: string;
  buckets: number;
  weight: number;
}

interface KneaderPoint {
  name: string;
  buckets: number;
  weight: number;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function compactFCFA(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

function ChartCard({
  title, subtitle, icon: Icon, children, action,
}: {
  title: string; subtitle?: string; icon: typeof TrendingUp;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, gradient, sublabel,
}: {
  label: string; value: string; icon: typeof TrendingUp;
  gradient: string; sublabel?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 overflow-hidden relative">
      <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full bg-gradient-to-br ${gradient} opacity-10`} />
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sublabel && <p className="text-xs text-gray-400 mt-1">{sublabel}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color || entry.fill }} className="font-medium">
          {entry.name}: {typeof entry.value === 'number' && entry.value > 1000
            ? formatFCFA(entry.value)
            : entry.value}
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);
  const [activeTab, setActiveTab] = useState<ChartTab>('sales');
  const [loading, setLoading] = useState(true);

  // Person filters
  const [driverFilter, setDriverFilter] = useState('all');
  const [bakerFilter, setBakerFilter] = useState('all');
  const [kneaderFilter, setKneaderFilter] = useState('all');
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const [showBakerDropdown, setShowBakerDropdown] = useState(false);
  const [showKneaderDropdown, setShowKneaderDropdown] = useState(false);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [batches, setBatches] = useState<(DeliveryBatch & { driver?: Driver; pot_type?: PotType })[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [doughDeliveries, setDoughDeliveries] = useState<DoughDelivery[]>([]);
  const [doughBatches, setDoughBatches] = useState<DoughBatch[]>([]);
  const [expenses, setExpenses] = useState<DeliveryExpense[]>([]);
  const [oppSales, setOppSales] = useState<OpportunisticSale[]>([]);
  const [weddingOrders, setWeddingOrders] = useState<WeddingOrder[]>([]);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const startDate = useMemo(() => periodRange?.startISO.slice(0, 10) ?? new Date().toISOString().slice(0, 10), [periodRange]);
  const endDate = useMemo(() => periodRange?.endISO.slice(0, 10) ?? new Date().toISOString().slice(0, 10), [periodRange]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('analytics-page', async () => {
      const [
        driversRes, bakersRes, kneadersRes, batchesRes, depositsRes, returnsRes,
        receivablesRes, prodRes, doughRes, doughBatchRes, expensesRes,
        oppSalesRes, weddingOrdersRes,
      ] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('created_at', { ascending: false }).limit(1000),
        supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('deposited_at', { ascending: false }).limit(2000),
        supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('returned_at', { ascending: false }).limit(2000),
        supabase.from('receivables').select('*, sales_point:sales_points(*), driver:drivers(*)').order('created_at', { ascending: false }).limit(1000),
        supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }).limit(1000),
        supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*)').order('delivery_date', { ascending: false }).limit(1000),
        supabase.from('dough_batches').select('*, kneader:kneaders(*)').order('batch_date', { ascending: false }).limit(500),
        supabase.from('delivery_expenses').select('*').order('expense_date', { ascending: false }).limit(2000),
        supabase.from('opportunistic_sales').select('*, driver:drivers(*), pot_type:pot_types(*)').order('sale_date', { ascending: false }).limit(2000),
        supabase.from('wedding_orders').select('*, driver:drivers(*), pot_type:pot_types(*)').order('order_date', { ascending: false }).limit(1000),
      ]);
      return {
        drivers: driversRes.data ?? [],
        bakers: bakersRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        batches: batchesRes.data ?? [],
        deposits: depositsRes.data ?? [],
        returns: returnsRes.data ?? [],
        receivables: receivablesRes.data ?? [],
        productionRecords: prodRes.data ?? [],
        doughDeliveries: doughRes.data ?? [],
        doughBatches: doughBatchRes.data ?? [],
        expenses: expensesRes.data ?? [],
        oppSales: oppSalesRes.data ?? [],
        weddingOrders: weddingOrdersRes.data ?? [],
      };
    });
    if (result.data) {
      setDrivers(result.data.drivers);
      setBakers(result.data.bakers);
      setKneaders(result.data.kneaders);
      setBatches(result.data.batches);
      setDeposits(result.data.deposits);
      setReturns(result.data.returns);
      setReceivables(result.data.receivables);
      setProductionRecords(result.data.productionRecords);
      setDoughDeliveries(result.data.doughDeliveries);
      setDoughBatches(result.data.doughBatches);
      setExpenses(result.data.expenses);
      setOppSales(result.data.oppSales);
      setWeddingOrders(result.data.weddingOrders);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeSubscription('analytics-page', isOffline ? [] : ['delivery_batches', 'deposits', 'returns', 'receivables', 'production_records', 'dough_deliveries', 'dough_batches', 'delivery_expenses', 'opportunistic_sales', 'wedding_orders'], () => { loadData(); });

  const inPeriod = useCallback((d: string) => {
    const s = d.slice(0, 10);
    return s >= startDate && s <= endDate;
  }, [startDate, endDate]);

  // --- Person-filtered data ---
  const filtered = useMemo(() => {
    let fBatches = batches;
    let fDeposits = deposits;
    let fReturns = returns;
    let fReceivables = receivables;
    let fExpenses = expenses;
    let fProd = productionRecords;
    let fDough = doughDeliveries;
    let fOppSales = oppSales;
    let fWeddings = weddingOrders;

    if (driverFilter !== 'all') {
      const driverBatchIds = new Set(batches.filter((b) => b.driver_id === driverFilter).map((b) => b.id));
      fBatches = fBatches.filter((b) => b.driver_id === driverFilter);
      fDeposits = fDeposits.filter((d) => driverBatchIds.has(d.batch_id));
      fReturns = fReturns.filter((r) => driverBatchIds.has(r.batch_id));
      fReceivables = fReceivables.filter((r) => r.driver_id === driverFilter);
      fExpenses = fExpenses.filter((e) => e.driver_id === driverFilter);
      fOppSales = fOppSales.filter((s) => s.driver_id === driverFilter);
      fWeddings = fWeddings.filter((w) => w.driver_id === driverFilter);
    }

    if (kneaderFilter !== 'all') {
      fDough = fDough.filter((d) => d.kneader_id === kneaderFilter);
      const doughIds = new Set(fDough.map((d) => d.id));
      fProd = fProd.filter((r) => r.dough_delivery_id && doughIds.has(r.dough_delivery_id));
    }

    if (bakerFilter !== 'all') {
      fProd = fProd.filter((r) => r.baker_id === bakerFilter);
      fDough = fDough.filter((d) => d.baker_id === bakerFilter);
    }

    return { fBatches, fDeposits, fReturns, fReceivables, fExpenses, fProd, fDough, fOppSales, fWeddings };
  }, [batches, deposits, returns, receivables, expenses, productionRecords, doughDeliveries, oppSales, weddingOrders, driverFilter, kneaderFilter, bakerFilter]);

  // --- Sales data ---
  const salesDaily = useMemo<DailyPoint[]>(() => {
    const map = new Map<string, DailyPoint>();
    const fDeposits = filtered.fDeposits.filter((d) => inPeriod(d.deposited_at));
    const fReturns = filtered.fReturns.filter((r) => inPeriod(r.returned_at));
    const fExpenses = filtered.fExpenses.filter((e) => inPeriod(e.expense_date));

    for (const d of fDeposits) {
      const key = d.deposited_at.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), revenue: 0, deposits: 0, returns: 0, expenses: 0, net: 0 };
      entry.revenue += d.amount_fcfa || 0;
      entry.deposits += d.quantity || 0;
      map.set(key, entry);
    }
    for (const r of fReturns) {
      const key = r.returned_at.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), revenue: 0, deposits: 0, returns: 0, expenses: 0, net: 0 };
      entry.returns += r.quantity || 0;
      map.set(key, entry);
    }
    for (const e of fExpenses) {
      const key = e.expense_date.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), revenue: 0, deposits: 0, returns: 0, expenses: 0, net: 0 };
      entry.expenses += e.amount_fcfa || 0;
      map.set(key, entry);
    }
    // Add opportunistic sales to revenue
    for (const s of filtered.fOppSales.filter((s) => inPeriod(s.sale_date))) {
      const key = s.sale_date.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), revenue: 0, deposits: 0, returns: 0, expenses: 0, net: 0 };
      entry.revenue += s.total_amount_fcfa || 0;
      entry.deposits += s.quantity || 0;
      map.set(key, entry);
    }
    // Add wedding orders to revenue (only delivered or confirmed orders)
    for (const w of filtered.fWeddings.filter((w) => inPeriod(w.order_date) && w.status !== 'annule')) {
      const key = w.order_date.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), revenue: 0, deposits: 0, returns: 0, expenses: 0, net: 0 };
      entry.revenue += w.total_amount_fcfa || 0;
      entry.deposits += w.quantity || 0;
      map.set(key, entry);
    }
    for (const entry of map.values()) {
      entry.net = entry.revenue - entry.expenses;
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, inPeriod]);

  const driverPerformance = useMemo<DriverPoint[]>(() => {
    const fBatches = filtered.fBatches.filter((b) => inPeriod(b.batch_date));
    return drivers.map((d) => {
      const dBatches = fBatches.filter((b) => b.driver_id === d.id);
      const dBatchIds = new Set(dBatches.map((b) => b.id));
      const dDeposits = filtered.fDeposits.filter((dep) => dBatchIds.has(dep.batch_id) && inPeriod(dep.deposited_at));
      const dReturns = filtered.fReturns.filter((r) => dBatchIds.has(r.batch_id) && inPeriod(r.returned_at));
      const dRevenue = dDeposits.reduce((s, dep) => s + dep.amount_fcfa, 0);
      const dDepCount = dDeposits.reduce((s, dep) => s + dep.quantity, 0);
      const dRetCount = dReturns.reduce((s, r) => s + r.quantity, 0);
      return {
        name: d.full_name,
        revenue: dRevenue,
        deposits: dDepCount,
        returns: dRetCount,
        sellThrough: dDepCount > 0 ? ((dDepCount - dRetCount) / dDepCount) * 100 : 0,
      };
    }).filter((s) => s.revenue > 0 || s.deposits > 0).sort((a, b) => b.revenue - a.revenue);
  }, [drivers, filtered, inPeriod]);

  const salesByPotType = useMemo(() => {
    const map = new Map<string, { name: string; value: number; count: number }>();
    const fDeposits = filtered.fDeposits.filter((d) => inPeriod(d.deposited_at));
    for (const d of fDeposits) {
      const batch = filtered.fBatches.find((b) => b.id === d.batch_id);
      const ptName = batch?.pot_type?.name ?? 'Autres';
      const entry = map.get(ptName) ?? { name: ptName, value: 0, count: 0 };
      entry.value += d.amount_fcfa || 0;
      entry.count += d.quantity || 0;
      map.set(ptName, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [filtered, inPeriod]);

  const oppSalesByDriver = useMemo(() => {
    return drivers.map((d) => {
      const dSales = filtered.fOppSales.filter((s) => inPeriod(s.sale_date) && s.driver_id === d.id);
      return {
        name: d.full_name,
        amount: dSales.reduce((sum, s) => sum + s.total_amount_fcfa, 0),
        count: dSales.reduce((sum, s) => sum + s.quantity, 0),
      };
    }).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [drivers, filtered, inPeriod]);

  const weddingByDriver = useMemo(() => {
    return drivers.map((d) => {
      const dWeddings = filtered.fWeddings.filter((w) => inPeriod(w.order_date) && w.driver_id === d.id && w.status !== 'annule');
      return {
        name: d.full_name,
        amount: dWeddings.reduce((sum, w) => sum + w.total_amount_fcfa, 0),
        count: dWeddings.reduce((sum, w) => sum + w.quantity, 0),
      };
    }).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [drivers, filtered, inPeriod]);
  const treasuryDaily = useMemo(() => {
    return salesDaily.map((d) => ({
      date: d.date,
      label: d.label,
      revenue: d.revenue,
      expenses: d.expenses,
      net: d.net,
    }));
  }, [salesDaily]);

  const expensesByType = useMemo(() => {
    const map = new Map<string, { name: string; value: number }>();
    for (const e of filtered.fExpenses.filter((e) => inPeriod(e.expense_date))) {
      const label = e.expense_type.replace(/_/g, ' ');
      const entry = map.get(label) ?? { name: label, value: 0 };
      entry.value += e.amount_fcfa || 0;
      map.set(label, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [filtered, inPeriod]);

  // --- Receivables data ---
  const receivablesByStatus = useMemo(() => {
    const filteredRec = filtered.fReceivables.filter((r) => inPeriod(r.created_at));
    const enAttente = filteredRec.filter((r) => r.status === 'en_attente').reduce((s, r) => s + r.amount_fcfa - r.amount_paid, 0);
    const partiel = filteredRec.filter((r) => r.status === 'partiel').reduce((s, r) => s + r.amount_fcfa - r.amount_paid, 0);
    const solde = filteredRec.filter((r) => r.status === 'solde').reduce((s, r) => s + r.amount_fcfa, 0);
    return [
      { name: 'En attente', value: enAttente },
      { name: 'Partiel', value: partiel },
      { name: 'Soldé', value: solde },
    ];
  }, [filtered, inPeriod]);

  const receivablesByDriver = useMemo<ReceivablePoint[]>(() => {
    return drivers.map((d) => {
      const dRec = filtered.fReceivables.filter((r) => r.driver_id === d.id && inPeriod(r.created_at));
      const due = dRec.reduce((s, r) => s + r.amount_fcfa, 0);
      const paid = dRec.reduce((s, r) => s + r.amount_paid, 0);
      return { name: d.full_name, due, paid, outstanding: due - paid };
    }).filter((r) => r.due > 0).sort((a, b) => b.outstanding - a.outstanding);
  }, [drivers, filtered, inPeriod]);

  const receivableCollectionRate = useMemo(() => {
    const fRec = filtered.fReceivables.filter((r) => inPeriod(r.created_at));
    const totalDue = fRec.reduce((s, r) => s + r.amount_fcfa, 0);
    const totalPaid = fRec.reduce((s, r) => s + r.amount_paid, 0);
    return totalDue > 0 ? (totalPaid / totalDue) * 100 : 0;
  }, [filtered, inPeriod]);

  // --- Production data ---
  const productionDaily = useMemo<ProductionPoint[]>(() => {
    const map = new Map<string, ProductionPoint>();
    for (const r of filtered.fProd.filter((r) => inPeriod(r.production_date))) {
      const key = r.production_date.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), good: 0, burned: 0, broken: 0, defective: 0, pots: 0 };
      entry.good += r.madeleines_good || 0;
      entry.burned += r.madeleines_burned || 0;
      entry.broken += r.madeleines_broken || 0;
      entry.defective += r.madeleines_defective || 0;
      entry.pots += r.quantity || 0;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, inPeriod]);

  const bakerPerformance = useMemo<BakerPoint[]>(() => {
    return bakers.map((b) => {
      const bProd = filtered.fProd.filter((r) => inPeriod(r.production_date) && r.baker_id === b.id);
      return {
        name: b.full_name,
        good: bProd.reduce((s, r) => s + r.madeleines_good, 0),
        burned: bProd.reduce((s, r) => s + (r.madeleines_burned ?? 0), 0),
        pots: bProd.reduce((s, r) => s + r.quantity, 0),
      };
    }).filter((s) => s.pots > 0 || s.good > 0).sort((a, b) => b.good - a.good);
  }, [bakers, filtered, inPeriod]);

  const doughDaily = useMemo<DoughPoint[]>(() => {
    const map = new Map<string, DoughPoint>();
    for (const d of filtered.fDough.filter((d) => inPeriod(d.delivery_date))) {
      const key = d.delivery_date.slice(0, 10);
      const entry = map.get(key) ?? { date: key, label: shortDate(key), buckets: 0, weight: 0 };
      entry.buckets += d.bucket_count || 0;
      entry.weight += Number(d.total_weight_kg) || 0;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, inPeriod]);

  const kneaderPerformance = useMemo<KneaderPoint[]>(() => {
    return kneaders.map((k) => {
      const kDough = filtered.fDough.filter((d) => inPeriod(d.delivery_date) && d.kneader_id === k.id);
      return {
        name: k.full_name,
        buckets: kDough.reduce((s, d) => s + d.bucket_count, 0),
        weight: kDough.reduce((s, d) => s + Number(d.total_weight_kg), 0),
      };
    }).filter((s) => s.buckets > 0 || s.weight > 0).sort((a, b) => b.weight - a.weight);
  }, [kneaders, filtered, inPeriod]);

  const productionQuality = useMemo(() => {
    const fProd = filtered.fProd.filter((r) => inPeriod(r.production_date));
    const good = fProd.reduce((s, r) => s + r.madeleines_good, 0);
    const burned = fProd.reduce((s, r) => s + (r.madeleines_burned ?? 0), 0);
    const broken = fProd.reduce((s, r) => s + (r.madeleines_broken ?? 0), 0);
    const defective = fProd.reduce((s, r) => s + (r.madeleines_defective ?? 0), 0);
    const total = good + burned + broken + defective;
    return { good, burned, broken, defective, total };
  }, [filtered, inPeriod]);

  // --- KPIs ---
  const totalRevenue = salesDaily.reduce((s, d) => s + d.revenue, 0);
  const totalDepositsCount = salesDaily.reduce((s, d) => s + d.deposits, 0);
  const totalReturnsCount = salesDaily.reduce((s, d) => s + d.returns, 0);
  const totalExpenses = salesDaily.reduce((s, d) => s + d.expenses, 0);
  const netCash = totalRevenue - totalExpenses;
  const sellThrough = totalDepositsCount > 0 ? ((totalDepositsCount - totalReturnsCount) / totalDepositsCount) * 100 : 0;
  const totalReceivableDue = filtered.fReceivables.filter((r) => inPeriod(r.created_at)).reduce((s, r) => s + r.amount_fcfa, 0);
  const totalReceivablePaid = filtered.fReceivables.filter((r) => inPeriod(r.created_at)).reduce((s, r) => s + r.amount_paid, 0);
  const totalReceivableOutstanding = totalReceivableDue - totalReceivablePaid;

  // --- Filter labels ---
  const periodLabel = periodRange?.label ?? '—';
  const driverLabel = driverFilter === 'all' ? 'Tous commerciaux' : drivers.find((d) => d.id === driverFilter)?.full_name ?? '—';
  const bakerLabel = bakerFilter === 'all' ? 'Tous fours' : bakers.find((b) => b.id === bakerFilter)?.full_name ?? '—';
  const kneaderLabel = kneaderFilter === 'all' ? 'Tous pétrisseurs' : kneaders.find((k) => k.id === kneaderFilter)?.full_name ?? '—';

  // --- Export functions ---
  const buildExportSubtitle = () => `${periodLabel} · ${driverLabel} · ${bakerLabel} · ${kneaderLabel}`;

  const handleExportPdf = () => {
    const tabLabel = tabs.find((t) => t.id === activeTab)?.label ?? '';
    sharePdfReport({
      title: `Analytique - ${tabLabel}`,
      subtitle: buildExportSubtitle(),
      columns: [
        { header: 'Indicateur', key: 'label', align: 'left' as const },
        { header: 'Valeur', key: 'value', align: 'right' as const },
      ],
      rows: [
        { label: 'Chiffre d\'affaires', value: formatFCFA(totalRevenue) },
        { label: 'Pots déposés', value: totalDepositsCount.toLocaleString('fr-FR') },
        { label: 'Pots retournés', value: totalReturnsCount.toLocaleString('fr-FR') },
        { label: 'Taux de vente', value: sellThrough.toFixed(1) + '%' },
        { label: 'Dépenses totales', value: formatFCFA(totalExpenses) },
        { label: 'Trésorerie nette', value: formatFCFA(netCash) },
        { label: 'Créances totales', value: formatFCFA(totalReceivableDue) },
        { label: 'Créances encaissées', value: formatFCFA(totalReceivablePaid) },
        { label: 'Créances restantes', value: formatFCFA(totalReceivableOutstanding) },
        { label: 'Taux de recouvrement', value: receivableCollectionRate.toFixed(1) + '%' },
        { label: 'Madeleines bonnes', value: productionQuality.good.toLocaleString('fr-FR') },
        { label: 'Madeleines cramées', value: productionQuality.burned.toLocaleString('fr-FR') },
        { label: 'Madeleines cassées', value: productionQuality.broken.toLocaleString('fr-FR') },
        { label: 'Madeleines défectueuses', value: productionQuality.defective.toLocaleString('fr-FR') },
        { label: 'Pots produits', value: productionDaily.reduce((s, d) => s + d.pots, 0).toLocaleString('fr-FR') },
        { label: 'Seaux de pâte', value: doughDaily.reduce((s, d) => s + d.buckets, 0).toLocaleString('fr-FR') },
        { label: 'Poids pâte (kg)', value: doughDaily.reduce((s, d) => s + d.weight, 0).toFixed(1) },
        { label: 'Ventes opportunes (FCFA)', value: formatFCFA(filtered.fOppSales.filter((s) => inPeriod(s.sale_date)).reduce((s, sale) => s + sale.total_amount_fcfa, 0)) },
        { label: 'Commandes mariage (FCFA)', value: formatFCFA(filtered.fWeddings.filter((w) => inPeriod(w.order_date) && w.status !== 'annule').reduce((s, w) => s + w.total_amount_fcfa, 0)) },
      ],
      summary: [
        { label: 'Période', value: periodLabel },
        { label: 'Onglet', value: tabLabel },
        { label: 'Commercial', value: driverLabel },
        { label: 'Pétrisseur', value: bakerLabel },
        { label: 'Pétrisseur', value: kneaderLabel },
      ],
      fileName: `analytique-${activeTab}`,
    });
  };

  const handleExportExcel = () => {
    const tabLabel = tabs.find((t) => t.id === activeTab)?.label ?? '';
    const summary = [
      { label: 'Période', value: periodLabel },
      { label: 'Onglet', value: tabLabel },
      { label: 'Commercial', value: driverLabel },
      { label: 'Pétrisseur', value: bakerLabel },
      { label: 'Pétrisseur', value: kneaderLabel },
      { label: 'CA total', value: formatFCFA(totalRevenue) },
      { label: 'Trésorerie nette', value: formatFCFA(netCash) },
      { label: 'Créances restantes', value: formatFCFA(totalReceivableOutstanding) },
    ];

    if (activeTab === 'sales') {
      downloadExcelReport({
        title: 'Analytique - Ventes',
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'CA (FCFA)', key: 'revenue' },
          { header: 'Pots déposés', key: 'deposits' },
          { header: 'Pots retournés', key: 'returns' },
          { header: 'Dépenses (FCFA)', key: 'expenses' },
          { header: 'Net (FCFA)', key: 'net' },
        ],
        rows: salesDaily.map((d) => ({
          date: d.label,
          revenue: d.revenue,
          deposits: d.deposits,
          returns: d.returns,
          expenses: d.expenses,
          net: d.net,
        })),
        summary,
        fileName: 'analytique-ventes',
      });
    } else if (activeTab === 'treasury') {
      downloadExcelReport({
        title: 'Analytique - Trésorerie',
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'Encaissements', key: 'revenue' },
          { header: 'Dépenses', key: 'expenses' },
          { header: 'Net', key: 'net' },
        ],
        rows: treasuryDaily.map((d) => ({
          date: d.label,
          revenue: d.revenue,
          expenses: d.expenses,
          net: d.net,
        })),
        summary,
        fileName: 'analytique-tresorerie',
      });
    } else if (activeTab === 'receivables') {
      downloadExcelReport({
        title: 'Analytique - Créances',
        columns: [
          { header: 'Commercial', key: 'name' },
          { header: 'Montant dû (FCFA)', key: 'due' },
          { header: 'Encaissé (FCFA)', key: 'paid' },
          { header: 'Restant (FCFA)', key: 'outstanding' },
        ],
        rows: receivablesByDriver.map((r) => ({
          name: r.name,
          due: r.due,
          paid: r.paid,
          outstanding: r.outstanding,
        })),
        summary,
        fileName: 'analytique-creances',
      });
    } else if (activeTab === 'production') {
      downloadExcelReport({
        title: 'Analytique - Production',
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'Madeleines bonnes', key: 'good' },
          { header: 'Cramées', key: 'burned' },
          { header: 'Cassées', key: 'broken' },
          { header: 'Défectueuses', key: 'defective' },
          { header: 'Pots produits', key: 'pots' },
        ],
        rows: productionDaily.map((d) => ({
          date: d.label,
          good: d.good,
          burned: d.burned,
          broken: d.broken,
          defective: d.defective,
          pots: d.pots,
        })),
        summary,
        fileName: 'analytique-production',
      });
    }
  };

  const tabs: { id: ChartTab; label: string; icon: typeof TrendingUp }[] = [
    { id: 'sales', label: 'Ventes', icon: TrendingUp },
    { id: 'treasury', label: 'Trésorerie', icon: Wallet },
    { id: 'receivables', label: 'Créances', icon: Scale },
    { id: 'production', label: 'Production', icon: Factory },
  ];

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">Chargement des données…</div>;
  }

  if (isOffline && batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les analyses.</p>
      </div>
    );
  }

  const filterBtn = (label: string, onClick: () => void, open: boolean) => (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-blue-500 outline-none transition-colors hover:border-blue-300">
      {label}
      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  const dropdownPanel = (open: boolean, allLabel: string, current: string, onSelect: (id: string) => void, items: { id: string; full_name: string }[]) =>
    open && (
      <div className="absolute top-full mt-1 left-0 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto min-w-48">
        <button onClick={() => { onSelect('all'); }}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${current === 'all' ? 'font-semibold text-amber-600' : 'text-gray-700'}`}>
          {allLabel}
        </button>
        {items.map((it) => (
          <button key={it.id} onClick={() => { onSelect(it.id); }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${current === it.id ? 'font-semibold text-amber-600' : 'text-gray-700'}`}>
            {it.full_name}
          </button>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-blue-500" />
          Analytique & Graphiques
        </h2>
        <div className="mobile-action-stack flex items-center gap-2 sm:w-auto sm:flex-row">
          {onNavigate && (
            <button
              onClick={() => onNavigate('statistics')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors"
            >
              Statistiques détaillées
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 transition-colors">
            <FileDown className="w-3.5 h-3.5" /> PDF
          </button>
          <button onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      <PeriodFilter onRangeChange={setPeriodRange} defaultPreset="month" />

      {/* Person filters */}
      <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            {filterBtn(driverLabel, () => { setShowDriverDropdown(!showDriverDropdown); setShowBakerDropdown(false); setShowKneaderDropdown(false); }, showDriverDropdown)}
            {dropdownPanel(showDriverDropdown, 'Tous les commerciaux', driverFilter, (id) => { setDriverFilter(id); setShowDriverDropdown(false); }, drivers)}
          </div>
          <div className="relative">
            {filterBtn(bakerLabel, () => { setShowBakerDropdown(!showBakerDropdown); setShowDriverDropdown(false); setShowKneaderDropdown(false); }, showBakerDropdown)}
            {dropdownPanel(showBakerDropdown, 'Tous les fours', bakerFilter, (id) => { setBakerFilter(id); setShowBakerDropdown(false); }, bakers)}
          </div>
          <div className="relative">
            {filterBtn(kneaderLabel, () => { setShowKneaderDropdown(!showKneaderDropdown); setShowDriverDropdown(false); setShowBakerDropdown(false); }, showKneaderDropdown)}
            {dropdownPanel(showKneaderDropdown, 'Tous les pétrisseurs', kneaderFilter, (id) => { setKneaderFilter(id); setShowKneaderDropdown(false); }, kneaders)}
          </div>
          {(driverFilter !== 'all' || bakerFilter !== 'all' || kneaderFilter !== 'all') && (
            <button
              onClick={() => { setDriverFilter('all'); setBakerFilter('all'); setKneaderFilter('all'); }}
              className="px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Chiffre d'affaires" value={formatFCFA(totalRevenue)} icon={Wallet} gradient="from-emerald-500 to-emerald-600" sublabel={`${totalDepositsCount.toLocaleString('fr-FR')} pots déposés`} />
        <KpiCard label="Trésorerie nette" value={formatFCFA(netCash)} icon={Activity} gradient={netCash >= 0 ? 'from-blue-500 to-blue-600' : 'from-red-500 to-red-600'} sublabel={`Dépenses: ${formatFCFA(totalExpenses)}`} />
        <KpiCard label="Créances restantes" value={formatFCFA(totalReceivableOutstanding)} icon={Scale} gradient="from-amber-500 to-amber-600" sublabel={`Encaissé: ${formatFCFA(totalReceivablePaid)}`} />
        <KpiCard label="Taux de vente" value={sellThrough.toFixed(1) + '%'} icon={TrendingUp} gradient="from-violet-500 to-violet-600" sublabel={`${totalReturnsCount.toLocaleString('fr-FR')} pots retournés`} />
      </div>

      {/* Tab selector */}
      <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 p-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                active ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== SALES TAB ===== */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          <ChartCard title="Évolution des ventes" subtitle="Chiffre d'affaires et pots déposés par jour" icon={TrendingUp}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={salesDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.emerald} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.emerald} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area yAxisId="left" type="monotone" dataKey="revenue" name="CA (FCFA)" stroke={CHART_COLORS.emerald} fill="url(#revGrad)" strokeWidth={2} />
                <Area yAxisId="right" type="monotone" dataKey="deposits" name="Pots déposés" stroke={CHART_COLORS.blue} fill="url(#depGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Performance par commercial" subtitle="Chiffre d'affaires par commercial" icon={Users}>
              {driverPerformance.length === 0 ? (
                <EmptyState text="Aucune donnée sur la période" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={driverPerformance} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" name="CA" fill={CHART_COLORS.blue} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Ventes par type de pot" subtitle="Répartition du chiffre d'affaires" icon={PieIcon}>
              {salesByPotType.length === 0 ? (
                <EmptyState text="Aucune donnée sur la période" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={salesByPotType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={2}>
                      {salesByPotType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <ChartCard title="Dépôts vs Retours par jour" subtitle="Comparaison des pots déposés et retournés" icon={Package}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={salesDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="deposits" name="Pots déposés" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="returns" name="Pots retournés" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Opportunistic sales & wedding orders */}
          {(filtered.fOppSales.length > 0 || filtered.fWeddings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.fOppSales.length > 0 && (
                <ChartCard title="Ventes opportunes" subtitle="Ventes additionnelles des commerciaux" icon={Sparkles}>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={oppSalesByDriver} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" name="Montant" fill={CHART_COLORS.amber} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
              {filtered.fWeddings.length > 0 && (
                <ChartCard title="Commandes mariage" subtitle="Pots commandés pour mariages" icon={Heart}>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={weddingByDriver} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" name="Montant" fill={CHART_COLORS.rose} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== TREASURY TAB ===== */}
      {activeTab === 'treasury' && (
        <div className="space-y-4">
          <ChartCard title="Flux de trésorerie" subtitle="Encaissements vs dépenses par jour" icon={Wallet}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={treasuryDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.red} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART_COLORS.red} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="Encaissements" stroke={CHART_COLORS.emerald} fill={CHART_COLORS.emerald} fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" name="Dépenses" stroke={CHART_COLORS.red} fill="url(#expGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Trésorerie nette cumulée" subtitle="Encaissements moins dépenses" icon={Activity}>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={treasuryDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="net" name="Net" stroke={CHART_COLORS.blue} strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Répartition des dépenses" subtitle="Par type de dépense" icon={PieIcon}>
              {expensesByType.length === 0 ? (
                <EmptyState text="Aucune dépense sur la période" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={expensesByType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                      {expensesByType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </div>
      )}

      {/* ===== RECEIVABLES TAB ===== */}
      {activeTab === 'receivables' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Statut des créances" subtitle="Répartition par statut" icon={Scale}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={receivablesByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={3}>
                    <Cell fill={CHART_COLORS.amber} />
                    <Cell fill={CHART_COLORS.blue} />
                    <Cell fill={CHART_COLORS.emerald} />
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="lg:col-span-2">
              <ChartCard title="Créances par commercial" subtitle="Montant dû vs encaissé par commercial" icon={Users}>
                {receivablesByDriver.length === 0 ? (
                  <EmptyState text="Aucune créance sur la période" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={receivablesByDriver} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={compactFCFA} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="paid" name="Encaissé" fill={CHART_COLORS.emerald} stackId="a" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="outstanding" name="Restant" fill={CHART_COLORS.red} stackId="a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </div>

          <ChartCard title="Taux de recouvrement" subtitle="Part des créances encaissées" icon={CheckCircle2}>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <RadialBarChart innerRadius="60%" outerRadius="100%" data={[{ name: 'Recouvrement', value: receivableCollectionRate, fill: CHART_COLORS.emerald }]} startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="value" cornerRadius={10} background={{ fill: '#f3f4f6' }} />
                  <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-2xl font-bold" fill="#374151">
                    {receivableCollectionRate.toFixed(1)}%
                  </text>
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50">
                  <span className="text-sm text-emerald-700 font-medium">Total encaissé</span>
                  <span className="text-sm font-bold text-emerald-900">{formatFCFA(totalReceivablePaid)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50">
                  <span className="text-sm text-amber-700 font-medium">Reste à recouvrer</span>
                  <span className="text-sm font-bold text-amber-900">{formatFCFA(totalReceivableOutstanding)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                  <span className="text-sm text-gray-600 font-medium">Total dû</span>
                  <span className="text-sm font-bold text-gray-900">{formatFCFA(totalReceivableDue)}</span>
                </div>
              </div>
            </div>
          </ChartCard>
        </div>
      )}

      {/* ===== PRODUCTION TAB ===== */}
      {activeTab === 'production' && (
        <div className="space-y-4">
          <ChartCard title="Production de madeleines" subtitle="Madeleines bonnes, cramées et cassées par jour" icon={Cookie}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={productionDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="goodGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.emerald} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="good" name="Bonnes" stroke={CHART_COLORS.emerald} fill="url(#goodGrad)" strokeWidth={2} />
                <Bar dataKey="burned" name="Cramées" fill={CHART_COLORS.red} radius={[2, 2, 0, 0]} barSize={12} />
                <Bar dataKey="broken" name="Cassées" fill={CHART_COLORS.amber} radius={[2, 2, 0, 0]} barSize={12} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Pots produits par jour" subtitle="Volume de production" icon={Package}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={productionDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="pots" name="Pots produits" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Qualité de production" subtitle="Répartition des madeleines" icon={CheckCircle2}>
              {productionQuality.total === 0 ? (
                <EmptyState text="Aucune production sur la période" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Bonnes', value: productionQuality.good },
                        { name: 'Cramées', value: productionQuality.burned },
                        { name: 'Cassées', value: productionQuality.broken },
                        { name: 'Défectueuses', value: productionQuality.defective },
                      ]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      <Cell fill={CHART_COLORS.emerald} />
                      <Cell fill={CHART_COLORS.red} />
                      <Cell fill={CHART_COLORS.amber} />
                      <Cell fill={CHART_COLORS.violet} />
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <ChartCard title="Performance par pétrisseur" subtitle="Madeleines bonnes et pots produits" icon={Factory}>
            {bakerPerformance.length === 0 ? (
              <EmptyState text="Aucune production sur la période" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={bakerPerformance} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-20} textAnchor="end" height={50} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="good" name="Madeleines bonnes" fill={CHART_COLORS.emerald} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="pots" name="Pots produits" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Livraisons de pâte" subtitle="Seaux et poids par jour" icon={Flame}>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={doughDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => v + 'kg'} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left" type="monotone" dataKey="buckets" name="Seaux" stroke={CHART_COLORS.orange} strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="weight" name="Poids (kg)" stroke={CHART_COLORS.teal} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Performance par pétrisseur" subtitle="Poids de pâte produit" icon={Users}>
              {kneaderPerformance.length === 0 ? (
                <EmptyState text="Aucune livraison de pâte sur la période" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={kneaderPerformance} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => v + 'kg'} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="weight" name="Poids (kg)" fill={CHART_COLORS.teal} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">
      {text}
    </div>
  );
}
