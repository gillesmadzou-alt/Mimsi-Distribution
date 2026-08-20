import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  supabase, ROLE_LABELS, formatFCFA, UserRole, Profile,
  Driver, SalesPoint, DeliveryBatch, Deposit, Return, ProductionRecord,
  Receivable, StockMovement, Ingredient, DoughBatch, Kneader, Baker,
  AttendanceRecord,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { downloadPdfReport, downloadExcelReport, downloadMultiPdfReport, downloadMultiExcelReport } from '@/lib/exportUtils';
import LeafletMap, { MapMarker, escapeHtml } from '@/components/LeafletMap';
import {
  FileText, FileSpreadsheet, Loader2, Calendar, Filter, ChevronRight,
  TrendingUp, Package, Users, Wallet, Factory, FlaskConical, Truck, AlertCircle, Map as MapIcon,
  UserCheck, CheckSquare, Square, Layers, CloudOff,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ExportFormat = 'pdf' | 'excel';

interface ReportDef {
  id: string;
  title: string;
  description: string;
  icon: typeof FileText;
  roles: UserRole[];
  isMapReport?: boolean;
  build: (from: string, to: string) => Promise<{
    columns: { header: string; key: string; align?: 'left' | 'right' | 'center' }[];
    rows: Record<string, string | number>[];
    summary?: { label: string; value: string }[];
  }>;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');

const DRIVER_ROLES: UserRole[] = [1, 10, 11];
const BAKER_ROLES: UserRole[] = [9];
const KNEADER_TYPE = 'kneader';
const ADMIN_ROLES: UserRole[] = [4, 5, 6, 7, 8];
const OTHER_ROLES: UserRole[] = [2, 3, 12, 13, 14];

function buildAttendanceReport(
  records: AttendanceRecord[],
  filterType: 'baker' | 'driver' | 'kneader' | 'admin' | 'other' | 'all',
  fromDate: string,
  toDate: string,
  personFilter: string,
) {
  const filtered = records.filter((r) => {
    const d = r.attendance_date.slice(0, 10);
    return d >= fromDate && d <= toDate;
  });

  let scoped = filtered;
  if (filterType === 'baker') {
    scoped = filtered.filter((r) => BAKER_ROLES.includes(r.person_role));
  } else if (filterType === 'driver') {
    scoped = filtered.filter((r) => DRIVER_ROLES.includes(r.person_role));
  } else if (filterType === 'kneader') {
    scoped = filtered.filter((r) => r.person_type === KNEADER_TYPE);
  } else if (filterType === 'admin') {
    scoped = filtered.filter((r) => ADMIN_ROLES.includes(r.person_role));
  } else if (filterType === 'other') {
    scoped = filtered.filter((r) => OTHER_ROLES.includes(r.person_role));
  } else {
    scoped = filtered;
  }

  if (personFilter !== 'all') {
    scoped = scoped.filter((r) => r.person_name === personFilter);
  }

  const byPerson = new Map<string, {
    name: string;
    role: string;
    present: number;
    retard: number;
    absent: number;
    conge: number;
    mission: number;
    totalDays: number;
  }>();

  scoped.forEach((r) => {
    const entry = byPerson.get(r.person_id) ?? {
      name: r.person_name, role: ROLE_LABELS[r.person_role] ?? '—',
      present: 0, retard: 0, absent: 0, conge: 0, mission: 0, totalDays: 0,
    };
    entry.totalDays++;
    if (r.status === 'present') entry.present++;
    else if (r.status === 'retard') entry.retard++;
    else if (r.status === 'absent') entry.absent++;
    else if (r.status === 'conge') entry.conge++;
    else if (r.status === 'mission') entry.mission++;
    byPerson.set(r.person_id, entry);
  });

  const rows = Array.from(byPerson.values()).sort((a, b) => a.name.localeCompare(b.name));

  const totalPresent = rows.reduce((s, r) => s + r.present, 0);
  const totalRetard = rows.reduce((s, r) => s + r.retard, 0);
  const totalAbsent = rows.reduce((s, r) => s + r.absent, 0);
  const totalConge = rows.reduce((s, r) => s + r.conge, 0);
  const totalMission = rows.reduce((s, r) => s + r.mission, 0);

  return {
    columns: [
      { header: 'Personne', key: 'name' },
      { header: 'Poste', key: 'role' },
      { header: 'Présents', key: 'present', align: 'right' as const },
      { header: 'En retard', key: 'retard', align: 'right' as const },
      { header: 'Absents', key: 'absent', align: 'right' as const },
      { header: 'Congés', key: 'conge', align: 'right' as const },
      { header: 'Mission', key: 'mission', align: 'right' as const },
      { header: 'Total jours', key: 'totalDays', align: 'right' as const },
    ],
    rows: rows.map((r) => ({
      name: r.name, role: r.role,
      present: r.present, retard: r.retard, absent: r.absent,
      conge: r.conge, mission: r.mission, totalDays: r.totalDays,
    })),
    summary: [
      { label: 'Personnes concernées', value: String(rows.length) },
      { label: 'Total présences', value: String(totalPresent) },
      { label: 'Total retards', value: String(totalRetard) },
      { label: 'Total absences', value: String(totalAbsent) },
      { label: 'Total congés', value: String(totalConge) },
      { label: 'Total missions', value: String(totalMission) },
      { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
    ],
  };
}

export default function ReportsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const role = profile?.role ?? 1;
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attPersonType, setAttPersonType] = useState<string>('all');
  const [attPerson, setAttPerson] = useState<string>('all');

  // Cache data
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [returns, setReturns] = useState<Return[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [production, setProduction] = useState<ProductionRecord[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [doughBatches, setDoughBatches] = useState<DoughBatch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  // Unique person names from attendance records (filtered by type)
  const attendancePersonOptions = useMemo(() => {
    if (!attendanceRecords || attendanceRecords.length === 0) return [];
    let scoped = attendanceRecords;
    if (attPersonType === 'baker') scoped = scoped.filter((r) => BAKER_ROLES.includes(r.person_role));
    else if (attPersonType === 'driver') scoped = scoped.filter((r) => DRIVER_ROLES.includes(r.person_role));
    else if (attPersonType === 'kneader') scoped = scoped.filter((r) => r.person_type === KNEADER_TYPE);
    else if (attPersonType === 'admin') scoped = scoped.filter((r) => ADMIN_ROLES.includes(r.person_role));
    else if (attPersonType === 'other') scoped = scoped.filter((r) => OTHER_ROLES.includes(r.person_role));
    const names = new Set<string>();
    scoped.forEach((r) => { if (r.person_name) names.add(r.person_name); });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [attendanceRecords, attPersonType]);

  // Map report state
  const [mapMarkers, setMapMarkers] = useState<MapMarker[]>([]);
  const [mapVisible, setMapVisible] = useState(false);
  const mapCaptureRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('reports-page', async () => {
      const [b, dep, ret, recv, prod, stock, ing, db, dr, sp, kn, bk, pr, att] = await Promise.all([
        supabase.from('delivery_batches').select('*, driver:drivers(*), pot_type:pot_types(*)').order('batch_date', { ascending: false }).limit(500),
        supabase.from('deposits').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('deposited_at', { ascending: false }).limit(500),
        supabase.from('returns').select('*, sales_point:sales_points(*), batch:delivery_batches(*)').order('returned_at', { ascending: false }).limit(500),
        supabase.from('receivables').select('*, sales_point:sales_points(*), driver:drivers(*)').order('created_at', { ascending: false }).limit(500),
        supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }).limit(500),
        supabase.from('stock_movements').select('*, pot_type:pot_types(*), driver:drivers(*), baker:bakers(*)').order('created_at', { ascending: false }).limit(500),
        supabase.from('ingredients').select('*').order('name'),
        supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*))').order('batch_date', { ascending: false }).limit(500),
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('sales_points').select('*').order('name'),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('attendance_records').select('*').order('attendance_date', { ascending: false }).limit(2000),
      ]);
      return { b, dep, ret, recv, prod, stock, ing, db, dr, sp, kn, bk, pr, att };
    });
    if (result.data) {
      const { b, dep, ret, recv, prod, stock, ing, db, dr, sp, kn, bk, pr, att } = result.data;
      setAttendanceRecords(att.data ?? []);
      setBatches(b.data ?? []);
      setDeposits(dep.data ?? []);
      setReturns(ret.data ?? []);
      setReceivables(recv.data ?? []);
      setProduction(prod.data ?? []);
      setStockMovements(stock.data ?? []);
      setIngredients(ing.data ?? []);
      setDoughBatches(db.data ?? []);
      setDrivers(dr.data ?? []);
      setSalesPoints(sp.data ?? []);
      setKneaders(kn.data ?? []);
      setBakers(bk.data ?? []);
      setProfiles(pr.data ?? []);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeSubscription('reports-page', isOffline ? [] : ['delivery_batches', 'deposits', 'returns', 'receivables', 'production_records', 'stock_movements', 'ingredients', 'dough_batches'], () => { loadData(); });

  const inRange = (dateStr: string) => {
    const d = dateStr.slice(0, 10);
    return d >= fromDate && d <= toDate;
  };

  // --- Report definitions ---
  const reports: ReportDef[] = [
    {
      id: 'sales-summary',
      title: 'Rapport des ventes',
      description: 'Dépôts encaissés par point de vente sur la période',
      icon: TrendingUp,
      roles: [3, 4, 5, 6, 7],
      build: async () => {
        const filtered = deposits.filter((d) => inRange(d.deposited_at));
        const total = filtered.reduce((s, d) => s + d.amount_fcfa, 0);
        const bySP = new Map<string, { name: string; count: number; total: number }>();
        filtered.forEach((d) => {
          const key = d.sales_point_id;
          const entry = bySP.get(key) ?? { name: d.sales_point?.name ?? '—', count: 0, total: 0 };
          entry.count++; entry.total += d.amount_fcfa;
          bySP.set(key, entry);
        });
        return {
          columns: [
            { header: 'Point de vente', key: 'name' },
            { header: 'Nb dépôts', key: 'count', align: 'right' as const },
            { header: 'Total encaissé', key: 'total', align: 'right' as const },
          ],
          rows: Array.from(bySP.values()).map((r) => ({ name: r.name, count: r.count, total: formatFCFA(r.total) })),
          summary: [
            { label: 'Nombre de dépôts', value: String(filtered.length) },
            { label: 'Total encaissé', value: formatFCFA(total) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'receivables',
      title: 'Rapport des créances',
      description: 'Créances en attente, partielles et soldées',
      icon: Wallet,
      roles: [3, 4, 5, 6, 7],
      build: async () => {
        const filtered = receivables.filter((r) => inRange(r.created_at));
        const totalDue = filtered.reduce((s, r) => s + r.amount_fcfa, 0);
        const totalPaid = filtered.reduce((s, r) => s + r.amount_paid, 0);
        const outstanding = totalDue - totalPaid;
        return {
          columns: [
            { header: 'Point de vente', key: 'sp' },
            { header: 'commercial', key: 'driver' },
            { header: 'Montant dû', key: 'due', align: 'right' as const },
            { header: 'Encaissé', key: 'paid', align: 'right' as const },
            { header: 'Reste', key: 'rest', align: 'right' as const },
            { header: 'Statut', key: 'status', align: 'center' as const },
          ],
          rows: filtered.map((r) => ({
            sp: r.sales_point?.name ?? '—',
            driver: r.driver?.full_name ?? '—',
            due: formatFCFA(r.amount_fcfa),
            paid: formatFCFA(r.amount_paid),
            rest: formatFCFA(r.amount_fcfa - r.amount_paid),
            status: r.status,
          })),
          summary: [
            { label: 'Total dû', value: formatFCFA(totalDue) },
            { label: 'Total encaissé', value: formatFCFA(totalPaid) },
            { label: 'Reste à recouvrer', value: formatFCFA(outstanding) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'returns',
      title: 'Rapport des retours & invendus',
      description: 'Pots et madeleines retournés par point de vente',
      icon: Package,
      roles: [2, 3, 4, 5, 6, 7, 8],
      build: async () => {
        const filtered = returns.filter((r) => inRange(r.returned_at));
        const totalPots = filtered.reduce((s, r) => s + r.quantity, 0);
        const totalMadeleines = filtered.reduce((s, r) => s + r.madeleine_count, 0);
        return {
          columns: [
            { header: 'Date', key: 'date' },
            { header: 'Point de vente', key: 'sp' },
            { header: 'Pots', key: 'pots', align: 'right' as const },
            { header: 'Madeleines', key: 'madeleines', align: 'right' as const },
            { header: 'Motif', key: 'reason' },
          ],
          rows: filtered.map((r) => ({
            date: fmtDate(r.returned_at),
            sp: r.sales_point?.name ?? '—',
            pots: r.quantity,
            madeleines: r.madeleine_count,
            reason: r.reason ?? '—',
          })),
          summary: [
            { label: 'Total pots retournés', value: String(totalPots) },
            { label: 'Total madeleines', value: String(totalMadeleines) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'production',
      title: 'Rapport de production',
      description: 'Production de madeleines par pétrisseur',
      icon: Factory,
      roles: [4, 5, 6, 8],
      build: async () => {
        const filtered = production.filter((p) => inRange(p.production_date));
        const totalPots = filtered.reduce((s, p) => s + (p.pots_produced ?? 0), 0);
        const totalBurned = filtered.reduce((s, p) => s + (p.pots_burned ?? 0), 0);
        return {
          columns: [
            { header: 'Date', key: 'date' },
            { header: 'Pétrisseur', key: 'baker' },
            { header: 'Type de pot', key: 'pot' },
            { header: 'Pots produits', key: 'produced', align: 'right' as const },
            { header: 'Pots brûlés', key: 'burned', align: 'right' as const },
          ],
          rows: filtered.map((p) => ({
            date: fmtDate(p.production_date),
            baker: p.baker?.full_name ?? '—',
            pot: p.pot_type?.name ?? '—',
            produced: p.pots_produced ?? 0,
            burned: p.pots_burned ?? 0,
          })),
          summary: [
            { label: 'Total pots produits', value: String(totalPots) },
            { label: 'Total pots brûlés', value: String(totalBurned) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'dough-cost',
      title: 'Rapport des coûts de pâte',
      description: 'Fabrications de pâte, intrants utilisés et coûts',
      icon: FlaskConical,
      roles: [4, 5, 6, 8],
      build: async () => {
        const filtered = doughBatches.filter((b) => inRange(b.batch_date));
        const totalCost = filtered.reduce((s, b) => s + b.total_cost_fcfa, 0);
        const totalWeight = filtered.reduce((s, b) => s + (b.total_weight_kg ?? 0), 0);
        return {
          columns: [
            { header: 'Date', key: 'date' },
            { header: 'Pétrisseur', key: 'kneader' },
            { header: 'Poids (kg)', key: 'weight', align: 'right' as const },
            { header: 'Nb intrants', key: 'ingCount', align: 'right' as const },
            { header: 'Coût total', key: 'cost', align: 'right' as const },
          ],
          rows: filtered.map((b) => ({
            date: fmtDate(b.batch_date),
            kneader: b.kneader?.full_name ?? '—',
            weight: b.total_weight_kg ?? 0,
            ingCount: (b.ingredients ?? []).length,
            cost: formatFCFA(b.total_cost_fcfa),
          })),
          summary: [
            { label: 'Nombre de fabrications', value: String(filtered.length) },
            { label: 'Poids total (kg)', value: String(totalWeight) },
            { label: 'Coût total', value: formatFCFA(totalCost) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'ingredients-stock',
      title: 'Rapport des intrants & stock',
      description: 'Stock actuel, valeur et alertes par intrant',
      icon: Package,
      roles: [2, 4, 5, 6, 8],
      build: async () => {
        const totalValue = ingredients.reduce((s, i) => s + i.unit_cost_fcfa * i.stock_quantity, 0);
        const lowStock = ingredients.filter((i) => i.stock_alert_threshold !== null && i.stock_quantity <= (i.stock_alert_threshold ?? 0));
        return {
          columns: [
            { header: 'Intrant', key: 'name' },
            { header: 'Catégorie', key: 'category' },
            { header: 'Stock', key: 'stock', align: 'right' as const },
            { header: 'Coût unitaire', key: 'unitCost', align: 'right' as const },
            { header: 'Valeur stock', key: 'value', align: 'right' as const },
            { header: 'Alerte', key: 'alert', align: 'center' as const },
          ],
          rows: ingredients.map((i) => ({
            name: i.name,
            category: i.category ?? '—',
            stock: `${i.stock_quantity} ${i.unit}`,
            unitCost: formatFCFA(i.unit_cost_fcfa),
            value: formatFCFA(i.unit_cost_fcfa * i.stock_quantity),
            alert: i.stock_alert_threshold !== null && i.stock_quantity <= (i.stock_alert_threshold ?? 0) ? 'OUI' : '—',
          })),
          summary: [
            { label: 'Nombre d\'intrants', value: String(ingredients.length) },
            { label: 'Valeur totale du stock', value: formatFCFA(totalValue) },
            { label: 'Intrants en alerte', value: String(lowStock.length) },
          ],
        };
      },
    },
    {
      id: 'deliveries',
      title: 'Rapport des tournées',
      description: 'Lots de livraison par commercial avec dépôts et retours',
      icon: Truck,
      roles: [2, 3, 4, 5, 6, 7],
      build: async () => {
        const filtered = batches.filter((b) => inRange(b.batch_date));
        const totalDelivered = filtered.reduce((s, b) => s + b.pots_delivered, 0);
        const totalReturned = filtered.reduce((s, b) => s + b.pots_returned, 0);
        return {
          columns: [
            { header: 'Date', key: 'date' },
            { header: 'Code lot', key: 'code' },
            { header: 'commercial', key: 'driver' },
            { header: 'Zone', key: 'zone' },
            { header: 'Type', key: 'type' },
            { header: 'Pots livrés', key: 'delivered', align: 'right' as const },
            { header: 'Pots retournés', key: 'returned', align: 'right' as const },
            { header: 'Statut', key: 'status', align: 'center' as const },
          ],
          rows: filtered.map((b) => ({
            date: fmtDate(b.batch_date),
            code: b.batch_code,
            driver: b.driver?.full_name ?? '—',
            zone: b.zone,
            type: b.batch_type,
            delivered: b.pots_delivered,
            returned: b.pots_returned,
            status: b.status,
          })),
          summary: [
            { label: 'Nombre de lots', value: String(filtered.length) },
            { label: 'Total pots livrés', value: String(totalDelivered) },
            { label: 'Total pots retournés', value: String(totalReturned) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'stock-movements',
      title: 'Rapport des mouvements de stock',
      description: 'Entrées, attributions et retours de stock',
      icon: Package,
      roles: [2, 4, 5, 6],
      build: async () => {
        const filtered = stockMovements.filter((m) => inRange(m.created_at));
        return {
          columns: [
            { header: 'Date', key: 'date' },
            { header: 'Type', key: 'type' },
            { header: 'Article', key: 'item' },
            { header: 'Quantité', key: 'qty', align: 'right' as const },
            { header: 'commercial/pétrisseur', key: 'person' },
            { header: 'Notes', key: 'notes' },
          ],
          rows: filtered.map((m) => ({
            date: fmtDate(m.created_at),
            type: m.movement_type,
            item: `${m.pot_type?.name ?? '—'} (${m.item_type})`,
            qty: m.quantity,
            person: m.driver?.full_name ?? m.baker?.full_name ?? '—',
            notes: m.notes ?? '—',
          })),
          summary: [
            { label: 'Nombre de mouvements', value: String(filtered.length) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'drivers-performance',
      title: 'Rapport de performance des commerciaux',
      description: 'Dépôts et retours par commercial sur la période',
      icon: Users,
      roles: [4, 5, 6, 7],
      build: async () => {
        const driverStats = new Map<string, { name: string; deposits: number; delivered: number; returned: number; amount: number }>();
        drivers.forEach((d) => driverStats.set(d.id, { name: d.full_name, deposits: 0, delivered: 0, returned: 0, amount: 0 }));
        deposits.filter((d) => inRange(d.deposited_at)).forEach((dep) => {
          const batch = batches.find((b) => b.id === dep.batch_id);
          const drvId = batch?.driver_id ?? '';
          const entry = driverStats.get(drvId);
          if (entry) { entry.deposits++; entry.amount += dep.amount_fcfa; }
        });
        batches.filter((b) => inRange(b.batch_date)).forEach((b) => {
          const entry = driverStats.get(b.driver_id);
          if (entry) { entry.delivered += b.pots_delivered; entry.returned += b.pots_returned; }
        });
        const stats = Array.from(driverStats.values()).filter((s) => s.deposits > 0 || s.delivered > 0);
        return {
          columns: [
            { header: 'commercial', key: 'name' },
            { header: 'Nb dépôts', key: 'deposits', align: 'right' as const },
            { header: 'Pots livrés', key: 'delivered', align: 'right' as const },
            { header: 'Pots retournés', key: 'returned', align: 'right' as const },
            { header: 'Encaissé', key: 'amount', align: 'right' as const },
          ],
          rows: stats.map((s) => ({
            name: s.name, deposits: s.deposits, delivered: s.delivered, returned: s.returned, amount: formatFCFA(s.amount),
          })),
          summary: [
            { label: 'commerciaux actifs', value: String(stats.length) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
    {
      id: 'sales-points',
      title: 'Rapport des points de vente',
      description: 'État des points de vente, quotas et statuts',
      icon: Users,
      roles: [4, 5, 6, 7],
      build: async () => {
        return {
          columns: [
            { header: 'Nom', key: 'name' },
            { header: 'Quartier', key: 'district' },
            { header: 'Zone', key: 'zone' },
            { header: 'Quota', key: 'quota', align: 'right' as const },
            { header: 'Quota payé', key: 'paid', align: 'right' as const },
            { header: 'Statut quota', key: 'qStatus', align: 'center' as const },
            { header: 'Actif', key: 'active', align: 'center' as const },
          ],
          rows: salesPoints.map((sp) => ({
            name: sp.name, district: sp.district, zone: sp.zone,
            quota: formatFCFA(sp.quota_amount), paid: formatFCFA(sp.quota_paid),
            qStatus: sp.quota_status, active: sp.is_active ? 'Oui' : 'Non',
          })),
          summary: [
            { label: 'Total points de vente', value: String(salesPoints.length) },
            { label: 'Points actifs', value: String(salesPoints.filter((s) => s.is_active).length) },
          ],
        };
      },
    },
    {
      id: 'personnel',
      title: 'Rapport du personnel',
      description: 'Liste du personnel, rôles et statuts',
      icon: Users,
      roles: [4, 5, 6],
      build: async () => {
        return {
          columns: [
            { header: 'Nom', key: 'name' },
            { header: 'Rôle', key: 'role' },
            { header: 'Téléphone', key: 'phone' },
            { header: 'Actif', key: 'active', align: 'center' as const },
          ],
          rows: profiles.map((p) => ({
            name: p.full_name,
            role: ROLE_LABELS[p.role] ?? `Rôle ${p.role}`,
            phone: p.phone ?? '—',
            active: p.is_active ? 'Oui' : 'Non',
          })),
          summary: [
            { label: 'Total personnel', value: String(profiles.length) },
            { label: 'Personnel actif', value: String(profiles.filter((p) => p.is_active).length) },
          ],
        };
      },
    },
    {
      id: 'attendance-bakers',
      title: 'Rapport de présence — pétrisseurs',
      description: 'Présence des pétrisseurs sur la période',
      icon: UserCheck,
      roles: [4, 5, 6, 8],
      build: async () => buildAttendanceReport(attendanceRecords, 'baker', fromDate, toDate, attPerson),
    },
    {
      id: 'attendance-drivers',
      title: 'Rapport de présence — Commerciaux',
      description: 'Présence des commerciaux sur la période',
      icon: UserCheck,
      roles: [4, 5, 6, 7],
      build: async () => buildAttendanceReport(attendanceRecords, 'driver', fromDate, toDate, attPerson),
    },
    {
      id: 'attendance-kneaders',
      title: 'Rapport de présence — Pétrisseurs',
      description: 'Présence des pétrisseurs sur la période',
      icon: UserCheck,
      roles: [4, 5, 6, 8],
      build: async () => buildAttendanceReport(attendanceRecords, 'kneader', fromDate, toDate, attPerson),
    },
    {
      id: 'attendance-admin',
      title: 'Rapport de présence — Direction & administration',
      description: 'Présence de la direction et de l\'administration sur la période',
      icon: UserCheck,
      roles: [4, 5, 6],
      build: async () => buildAttendanceReport(attendanceRecords, 'admin', fromDate, toDate, attPerson),
    },
    {
      id: 'attendance-other',
      title: 'Rapport de présence — Autres départements',
      description: 'Présence du stock, comptabilité, sécurité, plonge et ménage sur la période',
      icon: UserCheck,
      roles: [4, 5, 6],
      build: async () => buildAttendanceReport(attendanceRecords, 'other', fromDate, toDate, attPerson),
    },
    {
      id: 'attendance-all',
      title: 'Rapport de présence — Tout le personnel',
      description: 'Présence de l\'ensemble du personnel sur la période',
      icon: UserCheck,
      roles: [4, 5, 6],
      build: async () => buildAttendanceReport(attendanceRecords, (attPersonType !== 'all' ? attPersonType : 'all') as 'baker' | 'driver' | 'kneader' | 'admin' | 'other' | 'all', fromDate, toDate, attPerson),
    },
    {
      id: 'delivery-map',
      title: 'Carte des livraisons',
      description: 'Carte interactive des points de vente livrés sur la période',
      icon: MapIcon,
      roles: [2, 3, 4, 5, 6, 7],
      isMapReport: true,
      build: async () => {
        const filteredDeposits = deposits.filter((d) => inRange(d.deposited_at));
        const filteredReturns = returns.filter((r) => inRange(r.returned_at));
        const markers: MapMarker[] = salesPoints
          .filter((sp) => sp.gps_lat != null && sp.gps_lng != null)
          .map((sp) => {
            const spDeposits = filteredDeposits.filter((d) => d.sales_point_id === sp.id);
            const spReturns = filteredReturns.filter((r) => r.sales_point_id === sp.id);
            const delivered = spDeposits.reduce((s, d) => s + d.quantity, 0);
            const returned = spReturns.reduce((s, r) => s + r.quantity, 0);
            let icon: MapMarker['icon'] = 'pending';
            if (returned > 0) icon = 'returned';
            else if (delivered > 0) icon = 'delivered';
            return {
              id: sp.id,
              lat: sp.gps_lat!,
              lng: sp.gps_lng!,
              title: escapeHtml(sp.name),
              icon,
              popupHtml: `<div style="min-width:160px;"><strong>${escapeHtml(sp.name)}</strong><br/><span style="color:#6b7280;font-size:12px;">${escapeHtml(sp.district)}</span><br/><hr style="margin:4px 0;"/><div style="font-size:12px;">✓ ${delivered} déposés<br/>↩ ${returned} retournés<br/><strong>Net: ${delivered - returned}</strong></div></div>`,
            };
          });
        return {
          columns: [],
          rows: [],
          summary: [
            { label: 'Points sur la carte', value: String(markers.length) },
            { label: 'Points livrés', value: String(markers.filter((m) => m.icon === 'delivered' || m.icon === 'returned').length) },
            { label: 'Points en attente', value: String(markers.filter((m) => m.icon === 'pending').length) },
            { label: 'Période', value: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
          ],
        };
      },
    },
  ];

  const availableReports = reports.filter((r) => r.roles.includes(role));

  // Multi-select state
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [exportingMulti, setExportingMulti] = useState<string | null>(null);

  const isDirector = role === 4 || role === 5 || role === 6;

  const toggleReport = (id: string) => {
    setSelectedReports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllReports = () => {
    setSelectedReports(new Set(availableReports.filter((r) => !r.isMapReport).map((r) => r.id)));
  };

  const deselectAllReports = () => {
    setSelectedReports(new Set());
  };

  const handleMultiExport = async (format: ExportFormat) => {
    const selected = availableReports.filter((r) => selectedReports.has(r.id) && !r.isMapReport);
    if (selected.length === 0) return;
    setExportingMulti(format);
    try {
      const built = await Promise.all(selected.map(async (r) => {
        const data = await r.build(fromDate, toDate);
        return {
          title: r.title,
          subtitle: `Période: ${fmtDate(fromDate)} — ${fmtDate(toDate)}`,
          columns: data.columns,
          rows: data.rows,
          summary: data.summary,
        };
      }));
      const fileBase = `Rapports_combines_${fromDate}_${toDate}`;
      if (format === 'pdf') {
        downloadMultiPdfReport(built, fileBase);
      } else {
        downloadMultiExcelReport(built, fileBase);
      }
    } catch (err) {
      console.error(err);
      toast('Erreur lors de la génération des rapports combinés.', 'error');
    }
    setExportingMulti(null);
  };

  const handleExport = async (report: ReportDef, format: ExportFormat) => {
    setGenerating(report.id + format);
    try {
      const data = await report.build(fromDate, toDate);
      const fileBase = `${report.title}_${fromDate}_${toDate}`;

      if (report.isMapReport && format === 'pdf') {
        // Build markers from the report build (recompute for rendering)
        const filteredDeposits = deposits.filter((d) => inRange(d.deposited_at));
        const filteredReturns = returns.filter((r) => inRange(r.returned_at));
        const markers: MapMarker[] = salesPoints
          .filter((sp) => sp.gps_lat != null && sp.gps_lng != null)
          .map((sp) => {
            const spDeposits = filteredDeposits.filter((d) => d.sales_point_id === sp.id);
            const spReturns = filteredReturns.filter((r) => r.sales_point_id === sp.id);
            const delivered = spDeposits.reduce((s, d) => s + d.quantity, 0);
            const returned = spReturns.reduce((s, r) => s + r.quantity, 0);
            let icon: MapMarker['icon'] = 'pending';
            if (returned > 0) icon = 'returned';
            else if (delivered > 0) icon = 'delivered';
            return {
              id: sp.id, lat: sp.gps_lat!, lng: sp.gps_lng!,
              title: escapeHtml(sp.name), icon,
              popupHtml: `<div style="min-width:160px;"><strong>${escapeHtml(sp.name)}</strong><br/><span style="color:#6b7280;font-size:12px;">${escapeHtml(sp.district)}</span><br/><hr style="margin:4px 0;"/><div style="font-size:12px;">✓ ${delivered} déposés<br/>↩ ${returned} retournés<br/><strong>Net: ${delivered - returned}</strong></div></div>`,
            };
          });

        setMapMarkers(markers);
        setMapVisible(true);

        // Wait for map to render + tiles to load
        await new Promise((r) => setTimeout(r, 2500));

        // Kept lazy because the map-image export is optional. It must never
        // prevent the rest of the application from loading if this optional
        // browser-only dependency has not been installed yet.
        const moduleName = 'html2canvas';
        const { default: html2canvas } = await import(/* @vite-ignore */ moduleName);
        const canvas = await html2canvas(mapCaptureRef.current!, {
          useCORS: true, allowTaint: false, scale: 2, backgroundColor: '#ffffff',
        });
        const imgData = canvas.toDataURL('image/png');

        setMapVisible(false);
        setMapMarkers([]);

        // Generate PDF with map image + summary
        const doc = new jsPDF({ orientation: 'landscape' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(55, 65, 81);
        doc.text(report.title, 14, 20);
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
        doc.text(`Période: ${fmtDate(fromDate)} — ${fmtDate(toDate)}`, 14, 27);
        doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth - 14, 20, { align: 'right' });

        // Summary table
        if (data.summary && data.summary.length > 0) {
          autoTable(doc, {
            startY: 34,
            head: [['Indicateur', 'Valeur']],
            body: data.summary.map((s) => [s.label, s.value]),
            theme: 'grid',
            headStyles: { fillColor: [251, 146, 60], textColor: 255 },
            styles: { fontSize: 9, cellPadding: 3 },
            margin: { left: 14, right: 14 },
          });
        }

        // Add map image on a new page
        doc.addPage();
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(55, 65, 81);
        doc.text('Carte des livraisons', 14, 20);
        const maxWidth = pageWidth - 28;
        const maxHeight = pageHeight - 40;
        const imgProps = { width: canvas.width, height: canvas.height };
        const ratio = Math.min(maxWidth / imgProps.width, maxHeight / imgProps.height);
        const w = imgProps.width * ratio;
        const h = imgProps.height * ratio;
        const x = (pageWidth - w) / 2;
        doc.addImage(imgData, 'PNG', x, 30, w, h);

        const blob = doc.output('blob');
        saveAs(blob, fileBase + '.pdf');
      } else if (format === 'pdf') {
        downloadPdfReport({
          title: report.title,
          subtitle: `Période: ${fmtDate(fromDate)} — ${fmtDate(toDate)}`,
          columns: data.columns,
          rows: data.rows,
          summary: data.summary,
          fileName: fileBase,
        });
      } else {
        downloadExcelReport({
          title: report.title,
          columns: data.columns,
          rows: data.rows,
          summary: data.summary,
          fileName: fileBase,
        });
      }
    } catch (err) {
      console.error(err);
      toast('Erreur lors de la génération du rapport.', 'error');
      setMapVisible(false);
    }
    setGenerating(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (isOffline && batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les rapports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Rapports</h2>
            <p className="text-sm text-slate-300">
              {ROLE_LABELS[role]} — Générez vos rapports en PDF ou Excel
            </p>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Période d'analyse</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Du</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Au</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type de personnel</label>
            <select value={attPersonType} onChange={(e) => { setAttPersonType(e.target.value); setAttPerson('all'); }}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none bg-white">
              <option value="all">Tous</option>
              <option value="baker">Boulangers</option>
              <option value="driver">Commerciaux</option>
              <option value="kneader">Pétrisseurs</option>
              <option value="admin">Administration</option>
              <option value="other">Autre</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Personne</label>
            <select value={attPerson} onChange={(e) => setAttPerson(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none bg-white min-w-[150px]">
              <option value="all">Toutes</option>
              {attendancePersonOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setFromDate(d.toISOString().slice(0,10)); setToDate(new Date().toISOString().slice(0,10)); }}
              className="px-3 py-2 rounded-xl bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors">7 derniers jours</button>
            <button onClick={() => { const d = new Date(); d.setDate(1); setFromDate(d.toISOString().slice(0,10)); setToDate(new Date().toISOString().slice(0,10)); }}
              className="px-3 py-2 rounded-xl bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors">Ce mois</button>
            <button onClick={() => { const d = new Date(); d.setMonth(0, 1); setFromDate(d.toISOString().slice(0,10)); setToDate(new Date().toISOString().slice(0,10)); }}
              className="px-3 py-2 rounded-xl bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors">Cette année</button>
          </div>
        </div>
      </div>

      {/* Attendance cross-link */}
      {onNavigate && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 text-sm">Rapport de présence</h3>
            <p className="text-xs text-gray-500">Consulter la liste de présence</p>
          </div>
          <button
            onClick={() => onNavigate('attendance')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
          >
            <UserCheck className="w-4 h-4" />
            Ouvrir
          </button>
        </div>
      )}

      {/* Reports grid */}
      {availableReports.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          <p className="text-gray-400">Aucun rapport disponible pour votre rôle.</p>
        </div>
      ) : (
        <>
          {/* Multi-select toolbar */}
          {isDirector && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-900">Export combiné</span>
                  <span className="text-xs text-gray-500">
                    ({selectedReports.size} sélectionné{selectedReports.size > 1 ? 's' : ''})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={selectAllReports}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 text-gray-700 text-xs font-medium hover:bg-gray-100 transition-colors"
                  >
                    <CheckSquare className="w-4 h-4" />
                    Tout sélectionner
                  </button>
                  <button
                    onClick={deselectAllReports}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 text-gray-700 text-xs font-medium hover:bg-gray-100 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Tout désélectionner
                  </button>
                  <button
                    onClick={() => handleMultiExport('pdf')}
                    disabled={selectedReports.size === 0 || exportingMulti !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {exportingMulti === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    PDF combiné
                  </button>
                  <button
                    onClick={() => handleMultiExport('excel')}
                    disabled={selectedReports.size === 0 || exportingMulti !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    {exportingMulti === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Excel combiné
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {availableReports.map((report) => {
              const Icon = report.icon;
              const isGenerating = generating === report.id + 'pdf' || generating === report.id + 'excel';
              const isSelected = selectedReports.has(report.id);
              const canSelect = isDirector && !report.isMapReport;
              return (
                <div
                  key={report.id}
                  className={`bg-white rounded-2xl border p-4 flex flex-col transition-all ${
                    isSelected ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    {canSelect && (
                      <button
                        onClick={() => toggleReport(report.id)}
                        className="mt-0.5 shrink-0"
                        aria-label={isSelected ? 'Désélectionner' : 'Sélectionner'}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-amber-500" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-300 hover:text-gray-400" />
                        )}
                      </button>
                    )}
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-sm">{report.title}</h3>
                      <p className="text-xs text-gray-500">{report.description}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={() => handleExport(report, 'pdf')}
                      disabled={isGenerating}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      {generating === report.id + 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      PDF
                    </button>
                    <button
                      onClick={() => handleExport(report, 'excel')}
                      disabled={isGenerating}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors disabled:opacity-50"
                    >
                      {generating === report.id + 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                      Excel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Hidden map for PDF capture */}
      <div
        ref={mapCaptureRef}
        style={{
          position: mapVisible ? 'fixed' : 'absolute',
          left: '-9999px',
          top: 0,
          width: '900px',
          height: '500px',
          zIndex: -1,
          background: '#fff',
        }}
      >
        {mapVisible && mapMarkers.length > 0 && (
          <LeafletMap markers={mapMarkers} fitToMarkers={true} />
        )}
      </div>

      {/* Role info */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
        <Filter className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">Rapports adaptés à votre rôle</p>
          <p className="text-xs text-blue-700 mt-0.5">
            En tant que <strong>{ROLE_LABELS[role]}</strong>, vous avez accès à {availableReports.length} rapport(s).
            Les directrices, directeurs adjoints et administrateurs ont accès à l'ensemble des rapports.
          </p>
        </div>
      </div>
    </div>
  );
}
