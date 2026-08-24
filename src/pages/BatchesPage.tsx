import { useEffect, useState, useCallback } from 'react';
import {
  supabase, DeliveryBatch, Driver, PotType, SalesPoint, Deposit, Receivable,
  Barcode as BarcodeType, formatFCFA, createNotification,
  BatchType, BATCH_TYPE_LABELS, BatchSalesPoint, BatchPotType, DeliveryExpense, DeliveryBatchApproval,
  EXPENSE_TYPE_LABELS,
} from '@/lib/supabase';
import ExpenseEntrySection, { type ExpenseLine } from '@/components/ExpenseEntrySection';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { mergePendingSalesPoints } from '@/lib/offlineSalesPoints';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { useSync } from '@/contexts/SyncContext';
import BarcodeScanner from '@/components/BarcodeScanner';
import {
  Plus, X, Truck, Package, CheckCircle2, Clock, MapPin, Camera, Wallet,
  UserCheck, ScanLine, Trash2,
  Pencil, Search, ChevronDown, ChevronRight, HandCoins, Store, Receipt, FileText, AlertTriangle, CloudOff,
} from 'lucide-react';

type BatchTypeKey = BatchType;

function deliveredPotsFromDeposits(batch: DeliveryBatch & { deposits?: Deposit[] }): number {
  const deposits = batch.deposits;
  if (!deposits?.length) return batch.pots_delivered ?? 0;
  return deposits
    .filter((deposit) => (deposit as Deposit & { is_confirmed?: boolean }).is_confirmed !== false)
    .reduce((total, deposit) => total + Number(deposit.quantity ?? 0), 0);
}

export default function BatchesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [batches, setBatches] = useState<(DeliveryBatch & { driver?: Driver; pot_type?: PotType; deposits?: Deposit[]; sales_points?: BatchSalesPoint[]; batch_pot_types?: BatchPotType[]; approval?: DeliveryBatchApproval })[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showDirectDelivery, setShowDirectDelivery] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [editBatchId, setEditBatchId] = useState<string | null>(null);
  const [collectBatchId, setCollectBatchId] = useState<string | null>(null);
  const [batchReceivables, setBatchReceivables] = useState<Receivable[]>([]);
  const [collectLoading, setCollectLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [directForm, setDirectForm] = useState({
    pot_type_id: '', sales_point_id: '', quantity: 0,
    payment_type: 'comptant' as 'comptant' | 'credit', amount_fcfa: 0, notes: '',
  });
  const [directExpenses, setDirectExpenses] = useState<ExpenseLine[]>([]);

  const [form, setForm] = useState({
    driver_id: '', zone: '',
    batch_type: 'livraison' as BatchTypeKey,
    sales_point_ids: [] as string[],
    pot_entries: [] as { pot_type_id: string; quantity: number; empty_pots: number; empty_lids: number }[],
  });

  const [editForm, setEditForm] = useState({
    sales_point_ids: [] as string[],
  });

  const [depositForm, setDepositForm] = useState({
    batch_id: '', sales_point_id: '', pot_type_id: '', quantity: 0, payment_type: 'comptant' as 'comptant' | 'credit',
    amount_fcfa: 0, notes: '',
  });
  const [depositExpenses, setDepositExpenses] = useState<ExpenseLine[]>([]);

  const [collectForm, setCollectForm] = useState<Record<string, number>>({});

  const [showScanner, setShowScanner] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [scannedBarcodes, setScannedBarcodes] = useState<{ code: string; barcode?: BarcodeType }[]>([]);
  const [scanTarget, setScanTarget] = useState<number | null>(null);
  const [summaryBatch, setSummaryBatch] = useState<(DeliveryBatch & { driver?: Driver; pot_type?: PotType; deposits?: Deposit[]; sales_points?: BatchSalesPoint[]; batch_pot_types?: BatchPotType[] }) | null>(null);
  const [stockAlerts, setStockAlerts] = useState<{ pot_type: PotType; current: number; threshold: number }[]>([]);
  const [showStockAlerts, setShowStockAlerts] = useState(false);
  const { fetchWithCache, isOffline } = useOfflineFetch();

  // Le rôle 16 est l'assistant de gestion de stock : il exerce les mêmes
  // opérations quotidiennes que la gestionnaire (rôle 2).
  const canCreateBatch = [2, 4, 5, 6, 16].includes(profile?.role ?? 1);
  const canSuperviseBatch = [2, 4, 5, 6, 16].includes(profile?.role ?? 1);
  const canApproveBatch = [4, 5, 6].includes(profile?.role ?? 1);
  const canDeposit = (profile?.role ?? 1) >= 2;
  const canDirectDeliver = [2, 4, 5, 6, 16].includes(profile?.role ?? 1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchWithCache<{
        batches: (DeliveryBatch & { driver?: Driver; pot_type?: PotType; deposits?: Deposit[]; sales_points?: BatchSalesPoint[]; batch_pot_types?: BatchPotType[]; approval?: DeliveryBatchApproval })[];
        drivers: Driver[];
        potTypes: PotType[];
        salesPoints: SalesPoint[];
        stockAlerts: { pot_type: PotType; current: number; threshold: number }[];
      }>('batches_page', async () => {
    const isDriver = profile?.role === 1;
    let driverId: string | null = null;

    if (isDriver) {
      const { data: d } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', profile!.id)
        .maybeSingle();
      driverId = d?.id ?? null;
    }

    let batchQuery = supabase
      .from('delivery_batches')
      .select('*, driver:drivers(*), pot_type:pot_types(*)')
      .order('created_at', { ascending: false });

    if (isDriver && driverId) {
      batchQuery = batchQuery.eq('driver_id', driverId);
    }

    const [batchesRes, driversRes, potsRes, pointsRes] = await Promise.all([
      batchQuery,
      supabase.from('drivers').select('*').eq('status', 'actif').order('full_name'),
      supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
      supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
    ]);

    const initialError = [batchesRes, driversRes, potsRes, pointsRes]
      .map((response) => response.error)
      .find(Boolean);
    if (initialError) throw initialError;

    const batchesData = batchesRes.data ?? [];
    const batchIds = batchesData.map((b) => b.id);

    let depositsMap: Record<string, Deposit[]> = {};
    let salesPointsMap: Record<string, BatchSalesPoint[]> = {};
    let potTypesMap: Record<string, BatchPotType[]> = {};
    let approvalsMap: Record<string, DeliveryBatchApproval> = {};

    if (batchIds.length > 0) {
      const [depsRes, bspRes, bptRes, approvalsRes] = await Promise.all([
        supabase
          .from('deposits')
          .select('*, sales_point:sales_points(*), barcode:barcodes(*)')
          .in('batch_id', batchIds),
        supabase
          .from('batch_sales_points')
          .select('*, sales_point:sales_points(*)')
          .in('batch_id', batchIds),
        supabase
          .from('batch_pot_types')
          .select('*, pot_type:pot_types(*)')
          .in('batch_id', batchIds),
        supabase
          .from('delivery_batch_approvals')
          .select('*')
          .in('batch_id', batchIds),
      ]);

      const detailError = [depsRes, bspRes, bptRes, approvalsRes]
        .map((response) => response.error)
        .find(Boolean);
      if (detailError) throw detailError;

      const depositIds = (depsRes.data ?? []).map((d) => d.id);
      let receivablesByDeposit: Record<string, Receivable> = {};
      if (depositIds.length > 0) {
        const { data: recvs, error: receivablesError } = await supabase
          .from('receivables')
          .select('*, sales_point:sales_points(*), driver:drivers(*)')
          .in('deposit_id', depositIds);
        if (receivablesError) throw receivablesError;
        (recvs ?? []).forEach((r) => {
          if (r.deposit_id) receivablesByDeposit[r.deposit_id] = r;
        });
      }
      (depsRes.data ?? []).forEach((d) => {
        if (!depositsMap[d.batch_id]) depositsMap[d.batch_id] = [];
        depositsMap[d.batch_id].push({ ...d, receivable: receivablesByDeposit[d.id] });
      });

      (bspRes.data ?? []).forEach((bsp) => {
        if (!salesPointsMap[bsp.batch_id]) salesPointsMap[bsp.batch_id] = [];
        salesPointsMap[bsp.batch_id].push(bsp as BatchSalesPoint);
      });

      (bptRes.data ?? []).forEach((bpt) => {
        if (!potTypesMap[bpt.batch_id]) potTypesMap[bpt.batch_id] = [];
        potTypesMap[bpt.batch_id].push(bpt as BatchPotType);
      });
      (approvalsRes.data ?? []).forEach((approval) => {
        approvalsMap[approval.batch_id] = approval as DeliveryBatchApproval;
      });
    }

    // Check stock alerts: pot types below their low_stock_threshold
    const alerts: { pot_type: PotType; current: number; threshold: number }[] = [];
    (potsRes.data ?? []).forEach((pt) => {
      const threshold = pt.low_stock_threshold ?? 0;
      if (threshold > 0 && pt.stock_quantity <= threshold) {
        alerts.push({ pot_type: pt, current: pt.stock_quantity, threshold });
      }
    });

    return {
      batches: batchesData.map((b) => ({
        ...b,
        deposits: depositsMap[b.id] ?? [],
        sales_points: salesPointsMap[b.id] ?? [],
        batch_pot_types: potTypesMap[b.id] ?? [],
        approval: approvalsMap[b.id],
      })),
      drivers: driversRes.data ?? [],
      potTypes: potsRes.data ?? [],
      salesPoints: pointsRes.data ?? [],
      stockAlerts: alerts,
    };
      });
      if (result.data) {
        setBatches(result.data.batches);
        setDrivers(result.data.drivers);
        setPotTypes(result.data.potTypes);
        setSalesPoints(await mergePendingSalesPoints(result.data.salesPoints));
        setStockAlerts(result.data.stockAlerts);
      }
      setLoadError(result.error);
    } catch {
      setLoadError('Erreur lors du chargement des tournees.');
    }
    setLoading(false);
  }, [profile, fetchWithCache]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('batches_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_batches' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivables' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receivable_payments' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_expenses' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_pot_types' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_batch_approvals' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_sales_points' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_points' }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll, isOffline]);

  const generateBatchCode = () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `LOT-${ymd}-${rnd}`;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.driver_id) {
      setActionError('Choisissez un commercial actif pour cette tournée.');
      return;
    }
    const batchCode = generateBatchCode();
    const needsPots = form.batch_type === 'livraison' || form.batch_type === 'mixte';

    if (needsPots && form.pot_entries.length === 0) {
      setActionError('Ajoutez au moins un type de pot pour cette tournée de livraison.');
      return;
    }
    if (needsPots && form.pot_entries.some((pe) => !pe.pot_type_id || pe.quantity <= 0)) {
      setActionError('Chaque type de pot doit avoir un type et une quantité valide.');
      return;
    }

    const totalQty = needsPots ? form.pot_entries.reduce((s, pe) => s + pe.quantity, 0) : null;
    const firstPotType = needsPots ? form.pot_entries[0].pot_type_id : null;

    const { data, error } = await supabase.from('delivery_batches').insert({
      batch_code: batchCode,
      driver_id: form.driver_id,
      pot_type_id: firstPotType,
      quantity: totalQty,
      zone: form.zone,
      batch_type: form.batch_type,
      status: 'actif',
    }).select().single();

    if (!error && data) {
      if (form.sales_point_ids.length > 0) {
        await supabase.from('batch_sales_points').insert(
          form.sales_point_ids.map((spId) => ({
            batch_id: data.id,
            sales_point_id: spId,
          }))
        );
      }

      if (needsPots) {
        await supabase.from('batch_pot_types').insert(
          form.pot_entries.map((pe) => ({
            batch_id: data.id,
            pot_type_id: pe.pot_type_id,
            quantity: pe.quantity,
            empty_pots: pe.empty_pots ?? 0,
            empty_lids: pe.empty_lids ?? 0,
          }))
        );

        for (const pe of form.pot_entries) {
          const pot = potTypes.find((p) => p.id === pe.pot_type_id);
          await supabase.from('stock_movements').insert({
            pot_type_id: pe.pot_type_id,
            movement_type: 'attribution',
            quantity: pe.quantity,
            batch_id: data.id,
            driver_id: form.driver_id,
            reference_id: data.id,
            notes: `Attribution lot ${batchCode}`,
          });
          if (pot) {
            const { error: stockErr } = await supabase.rpc('decrement_stock', {
              p_pot_type_id: pe.pot_type_id,
              p_quantity: pe.quantity,
            });
            if (stockErr) {
              console.error('stock decrement failed:', stockErr);
              setActionError(`Erreur de stock pour ${pot.name}.`);
              return;
            }
          }
        }
      }

      const potSummary = needsPots
        ? form.pot_entries.map((pe) => {
            const pt = potTypes.find((p) => p.id === pe.pot_type_id);
            const parts = [`${pt?.name ?? '—'}×${pe.quantity}`];
            if (pe.empty_pots > 0) parts.push(`${pe.empty_pots} vides`);
            if (pe.empty_lids > 0) parts.push(`${pe.empty_lids} couvercles`);
            return parts.join(' + ');
          }).join(', ')
        : 'aucun pot';

      await supabase.from('delivery_events').insert({
        event_type: 'lot_cree',
        batch_id: data.id,
        driver_id: form.driver_id,
        description: `Tournée ${batchCode} créée (${BATCH_TYPE_LABELS[form.batch_type]}) — ${form.sales_point_ids.length} PDV · ${potSummary}`,
      });

      const { error: approvalError } = await supabase.from('delivery_batch_approvals').insert({
        batch_id: data.id,
        requested_by: profile?.id,
      });
      if (approvalError) {
        setActionError('Le lot est opérationnel, mais la demande de validation n’a pas pu être créée. Réessayez après connexion.');
      } else {
        const { data: approvers } = await supabase
          .from('profiles')
          .select('id')
          .in('role', [4, 5, 6])
          .eq('is_active', true);
        await Promise.all((approvers ?? []).map((approver) =>
          createNotification(approver.id, 'Validation de lot requise', `Le lot ${batchCode} a été créé et est déjà opérationnel. Validation à effectuer.`, 'warning', 'batches')
        ));
      }
    }

    setShowModal(false);
    setForm({ driver_id: '', zone: '', batch_type: 'livraison', sales_point_ids: [], pot_entries: [] });
    setActionError(null);
    loadAll();
  };

  const decideBatchApproval = async (batch: DeliveryBatch, decision: 'approuve' | 'rejete') => {
    if (!batch.approval) return;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('delivery_batch_approvals')
      .update({ status: decision, decided_by: userData.user?.id, decided_at: new Date().toISOString() })
      .eq('id', batch.approval.id)
      .eq('status', 'en_attente');
    if (error) {
      toast('La validation du lot a échoué.', 'error');
      return;
    }
    await createNotification(batch.approval.requested_by, `Lot ${decision === 'approuve' ? 'approuvé' : 'rejeté'}`, `Le lot ${batch.batch_code} a été ${decision === 'approuve' ? 'approuvé' : 'rejeté'}. Il reste traçable dans l’historique.`, decision === 'approuve' ? 'success' : 'warning', 'batches');
    toast(decision === 'approuve' ? 'Lot validé.' : 'Lot rejeté : il reste dans l’historique pour la traçabilité.', decision === 'approuve' ? 'success' : 'info');
    loadAll();
  };

  const updatePotEntry = (idx: number, patch: Partial<{ pot_type_id: string; quantity: number; empty_pots: number; empty_lids: number }>) => {
    setForm((prev) => {
      const next = [...prev.pot_entries];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, pot_entries: next };
    });
  };

  const openEdit = async (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    setEditBatchId(batchId);
    setEditForm({
      sales_point_ids: (batch.sales_points ?? []).map((bsp) => bsp.sales_point_id),
    });
    setShowEditModal(true);
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBatchId) return;

    const existing = batches.find((b) => b.id === editBatchId);
    const existingIds = new Set((existing?.sales_points ?? []).map((bsp) => bsp.sales_point_id));
    const newIds = new Set(editForm.sales_point_ids);

    const toAdd = editForm.sales_point_ids.filter((id) => !existingIds.has(id));
    const toRemove = (existing?.sales_points ?? []).filter((bsp) => !newIds.has(bsp.sales_point_id));

    if (toRemove.length > 0) {
      const { error } = await supabase.from('batch_sales_points')
        .delete()
        .eq('batch_id', editBatchId)
        .in('sales_point_id', toRemove.map((bsp) => bsp.sales_point_id));
      if (error) { toast('Erreur lors de la suppression des points de vente.', 'error'); return; }
    }
    if (toAdd.length > 0) {
      const { error } = await supabase.from('batch_sales_points').insert(
        toAdd.map((spId) => ({ batch_id: editBatchId, sales_point_id: spId }))
      );
      if (error) { toast('Erreur lors de l ajout des points de vente.', 'error'); return; }
    }

    await supabase.from('delivery_events').insert({
      event_type: 'stock_mouvement',
      batch_id: editBatchId,
      description: `Points de vente modifiés pour ${existing?.batch_code ?? ''} — ${editForm.sales_point_ids.length} point(s)`,
    });

    setShowEditModal(false);
    setEditBatchId(null);
    loadAll();
  };

  const deleteBatchCore = async (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    const batchPots = batch.batch_pot_types ?? [];
    const delivered = deliveredPotsFromDeposits(batch);
    const totalQty = batchPots.reduce((s, bp) => s + bp.quantity, 0) || (batch.quantity ?? 0);
    const undeliveredTotal = Math.max(0, totalQty - delivered);

    if (batchPots.length > 0 && undeliveredTotal > 0) {
      const ratio = undeliveredTotal / totalQty;
      for (const bp of batchPots) {
        const returnQty = Math.round(bp.quantity * ratio);
        if (returnQty > 0) {
          await supabase.rpc('adjust_pot_stock', {
            p_pot_type_id: bp.pot_type_id,
            p_column: 'stock_quantity',
            p_delta: returnQty,
          });
          await supabase.from('stock_movements').insert({
            pot_type_id: bp.pot_type_id,
            movement_type: 'retour_stock',
            quantity: returnQty,
            reference_id: id,
            notes: `Restock après suppression tournée ${batch.batch_code}`,
          });
        }
      }
    } else if (batch.pot_type_id && batch.quantity && !batchPots.length) {
      const pot = potTypes.find((p) => p.id === batch.pot_type_id);
      if (pot) {
        const undelivered = Math.max(0, batch.quantity - delivered);
        if (undelivered > 0) {
          await supabase.rpc('adjust_pot_stock', {
            p_pot_type_id: batch.pot_type_id,
            p_column: 'stock_quantity',
            p_delta: undelivered,
          });
          await supabase.from('stock_movements').insert({
            pot_type_id: batch.pot_type_id,
            movement_type: 'retour_stock',
            quantity: undelivered,
            reference_id: id,
            notes: `Restock après suppression tournée ${batch.batch_code}`,
          });
        }
      }
    }

    await supabase.from('delivery_events').insert({
      event_type: 'tournee_annulee',
      batch_id: id,
      driver_id: batch.driver_id,
      description: `Tournée ${batch.batch_code} supprimée`,
    });

    const { error: delErr } = await supabase.from('delivery_batches').delete().eq('id', id);
    if (delErr) {
      const { error: statusErr } = await supabase
        .from('delivery_batches')
        .update({ status: 'annule' })
        .eq('id', id);
      if (statusErr) setActionError('Impossible de supprimer la tournée. Elle a été marquée comme annulée.');
    }
  };

  const handleDelete = async (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    if (!(await confirmDialog({ message: `Supprimer la tournée ${batch.batch_code} ? Cette action est irréversible.`, confirmLabel: 'Supprimer', danger: true }))) return;
    await deleteBatchCore(id);
    loadAll();
  };

  const handleBulkDelete = async () => {
    if (selectedBatchIds.size === 0) return;
    if (!(await confirmDialog({ message: `Supprimer ${selectedBatchIds.size} tournée(s) ? Cette action est irréversible.`, confirmLabel: 'Supprimer', danger: true }))) return;
    setBulkDeleting(true);
    for (const id of selectedBatchIds) {
      await deleteBatchCore(id);
    }
    setBulkDeleting(false);
    setSelectedBatchIds(new Set());
    setSelectMode(false);
    loadAll();
  };

  const toggleBatchSelection = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDeposit = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    const batchPots = batch?.batch_pot_types ?? [];
    const firstPot = batchPots.length > 0 ? batchPots[0].pot_type_id : (batch?.pot_type_id ?? '');
    setDepositForm({ batch_id: batchId, sales_point_id: '', pot_type_id: firstPot, quantity: 0, payment_type: 'comptant', amount_fcfa: 0, notes: '' });
    setDepositExpenses([]);
    if (batch?.sales_points && batch.sales_points.length > 0) {
      setDepositForm((prev) => ({ ...prev, sales_point_id: batch.sales_points![0].sales_point_id }));
    }
    setScannedBarcodes([]);
    setShowDeposit(true);
  };

  const { save } = useOfflineSave();
  const { syncNow } = useSync();

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const batch = batches.find((b) => b.id === depositForm.batch_id);
    const pot = potTypes.find((p) => p.id === depositForm.pot_type_id);
    const amount = depositForm.amount_fcfa || (pot ? pot.unit_price_fcfa * depositForm.quantity : 0);

    const steps = buildSteps()
      .insertSingle('deposits', {
        batch_id: depositForm.batch_id,
        sales_point_id: depositForm.sales_point_id,
        pot_type_id: depositForm.pot_type_id || null,
        quantity: depositForm.quantity,
        payment_type: depositForm.payment_type,
        amount_fcfa: amount,
        is_confirmed: true,
        notes: depositForm.notes,
      }, { id: 'deposit' })
      .getSteps();

    steps.push({
      id: 'delivery_event',
      table: 'delivery_events',
      operation: 'insert',
      body: {
        event_type: 'depot',
        batch_id: depositForm.batch_id,
        sales_point_id: depositForm.sales_point_id,
        quantity: depositForm.quantity,
        description: `Dépôt — ${depositForm.quantity} pots (${depositForm.payment_type === 'comptant' ? 'Comptant' : 'Crédit'})`,
      },
    });

    const result = await save('Dépôt de pots', 'batches', steps, () => loadAll());

    let depositId: { data: { id: string } | null } = { data: null };

    if (!result.offline && !result.queued) {
      // Online success: handle secondary operations (barcodes, shortfall receivable, notifications)
      depositId = await supabase.from('deposits')
        .select('id').eq('batch_id', depositForm.batch_id)
        .eq('sales_point_id', depositForm.sales_point_id)
        .order('created_at', { ascending: false }).limit(1).single();

      if (depositId.data) {
        const barcodeIds = [...new Set(
          scannedBarcodes.flatMap((scan) => scan.barcode ? [scan.barcode.id] : []),
        )];
        if (barcodeIds.length > 0) {
          const { error: barcodeLinkError } = await supabase
            .from('deposit_barcodes')
            .insert(barcodeIds.map((barcode_id) => ({
              deposit_id: depositId.data.id,
              barcode_id,
            })));
          if (barcodeLinkError) {
            console.error('barcode delivery trace failed:', barcodeLinkError);
            toast('Un ou plusieurs codes n’ont pas pu être liés au dépôt. Vérifiez qu’ils ne sont pas déjà utilisés.', 'error');
          }
        }
        if (scannedBarcodes.length < depositForm.quantity) {
          const unscannedCount = depositForm.quantity - scannedBarcodes.length;
          const { data: supervisors } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('role', [4, 5, 6]);
          const salesPoint = salesPoints.find((sp) => sp.id === depositForm.sales_point_id);
          const driverName = batch?.driver?.full_name ?? 'le commercial';
          const message =
            `Pot livré sans scan — ${unscannedCount} pot(s) non scanné(s) par ${driverName} ` +
            `lors du dépôt au point « ${salesPoint?.name ?? '—'} » ` +
            `(tournée ${batch?.batch_code ?? '—'}). Quantité déclarée : ${depositForm.quantity}, scannés : ${scannedBarcodes.length}.`;
          for (const sup of supervisors ?? []) {
            await createNotification(sup.id, 'Pot livré sans scan', message, 'warning', 'batches');
          }
        }
      }
    } else if (result.offline) {
      toast('Hors-ligne : votre dépôt a été enregistré sur ce téléphone. La consigne et le commercial de la tournée seront synchronisés automatiquement au retour de la connexion.', 'info');
    } else if (!result.queued) {
      toast('Dépôt validé : la consigne du point de vente a été mise à jour avec le commercial de la tournée.', 'success');
    }
    if (!result.offline) syncNow();

    // Insert delivery expenses
    if (depositExpenses.length > 0 && !result.offline && depositId.data) {
      const batch = batches.find((b) => b.id === depositForm.batch_id);
      await supabase.from('delivery_expenses').insert(
        depositExpenses.filter((e) => e.amount_fcfa > 0).map((e) => ({
          deposit_id: depositId.data.id,
          batch_id: depositForm.batch_id,
          sales_point_id: depositForm.sales_point_id,
          driver_id: batch?.driver_id ?? null,
          amount_fcfa: e.amount_fcfa,
          expense_type: e.expense_type,
          authorized_by: e.expense_type === 'credit_autorise' ? e.authorized_by || null : null,
          reason: e.reason || EXPENSE_TYPE_LABELS[e.expense_type],
          tournee: batch?.batch_code ?? null,
        }))
      );
    }

    setShowDeposit(false);
    setDepositForm({ batch_id: '', sales_point_id: '', pot_type_id: '', quantity: 0, payment_type: 'comptant', amount_fcfa: 0, notes: '' });
    setDepositExpenses([]);
    setScannedBarcodes([]);
    loadAll();
  };

  const closeBatch = async (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    setSummaryBatch(batch);
  };

  const confirmCloseBatch = async () => {
    if (!summaryBatch) return;
    const id = summaryBatch.id;
    if (isOffline || !navigator.onLine) {
      toast('La clôture de tournée nécessite une connexion Internet.', 'error');
      return;
    }
    const { data: batch } = await supabase.from('delivery_batches')
      .select('*, driver:drivers(full_name)')
      .eq('id', id).single();
    const { error: closeErr } = await supabase.from('delivery_batches').update({ status: 'cloture' }).eq('id', id);
    if (closeErr) { toast('Erreur lors de la clôture de la tournée.', 'error'); return; }
    if (batch) {
      await supabase.from('delivery_events').insert({
        event_type: 'tournee_close',
        batch_id: id,
        driver_id: batch.driver_id,
        quantity: deliveredPotsFromDeposits(summaryBatch),
        description: `Tournée ${batch.batch_code} clôturée — ${deliveredPotsFromDeposits(summaryBatch)}/${batch.quantity ?? 0} pots déposés`,
      });
    }
    setSummaryBatch(null);
    loadAll();
  };

  const escapeHtml = (value: unknown): string =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const exportSummaryPDF = () => {
    if (!summaryBatch) return;
    const deposits = summaryBatch.deposits ?? [];
    const totalPots = deposits.reduce((s, d) => s + (d.quantity || 0), 0);
    const totalCash = deposits.filter((d) => d.payment_type === 'comptant').reduce((s, d) => s + (d.amount_fcfa || 0), 0);
    const totalCredit = deposits.filter((d) => d.payment_type === 'credit').reduce((s, d) => s + (d.amount_fcfa || 0), 0);
    const sps = summaryBatch.sales_points ?? [];
    const driverName = summaryBatch.driver?.full_name ?? '—';

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Résumé tournée ${escapeHtml(summaryBatch.batch_code)}</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; color: #1f2937; }
        h1 { font-size: 20px; border-bottom: 2px solid #f59e0b; padding-bottom: 8px; }
        h2 { font-size: 14px; margin-top: 24px; color: #6b7280; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
        th { color: #6b7280; font-weight: 600; }
        .total { font-weight: 700; color: #f59e0b; }
        .header { display: flex; justify-content: space-between; }
        .meta { font-size: 12px; color: #6b7280; }
      </style></head><body>
      <div class="header">
        <div><h1>Résumé de tournée</h1><p class="meta">${escapeHtml(summaryBatch.batch_code)} · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p></div>
        <div class="meta">Commercial : ${escapeHtml(driverName)}</div>
      </div>
      <h2>Points de vente (${(summaryBatch.sales_points ?? []).length})</h2>
      <table><tbody>
      ${(summaryBatch.sales_points ?? []).map((sp) => {
        const name = (sp.sales_point as any)?.name ?? '—';
        const addr = (sp.sales_point as any)?.address || '';
        return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(addr)}</td></tr>`;
      }).join('')}
      </tbody></table>
      <h2>Dépôts (${deposits.length})</h2>
      <table><thead><tr><th>Point de vente</th><th>Pots</th><th>Paiement</th><th>Montant</th></tr></thead><tbody>
      ${deposits.map((d) => {
        const spName = (d.sales_point as any)?.name ?? '—';
        return `<tr><td>${escapeHtml(spName)}</td><td>${escapeHtml(d.quantity)}</td><td>${d.payment_type === 'comptant' ? 'Comptant' : 'Crédit'}</td><td>${escapeHtml(formatFCFA(d.amount_fcfa || 0))}</td></tr>`;
      }).join('')}
      </tbody></table>
      <h2>Totaux</h2>
      <table><tbody>
      <tr><td>Total pots déposés</td><td class="total">${escapeHtml(totalPots)}</td></tr>
      <tr><td>Total encaissé (comptant)</td><td class="total">${escapeHtml(formatFCFA(totalCash))}</td></tr>
      <tr><td>Total crédit</td><td class="total">${escapeHtml(formatFCFA(totalCredit))}</td></tr>
      <tr><td>Points de vente visités</td><td class="total">${sps.length}</td></tr>
      </tbody></table>
      <p class="meta" style="margin-top:32px">Document généré automatiquement.</p>
      </body></html>`);
    win.document.close();
    win.print();
  };

  const handleScan = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    if (isOffline || !navigator.onLine) {
      toast('Le scan de codes-barres nécessite une connexion Internet.', 'error');
      return;
    }

    if (scannedBarcodes.some((s) => s.code === code)) {
      toast('Ce code a déjà été scanné pour ce dépôt.', 'error');
      return;
    }

    const { data: barcode, error } = await supabase
      .from('barcodes')
      .select('*, pot_type:pot_types(*), production_record:production_records(*, baker:bakers(*))')
      .eq('code', code)
      .maybeSingle();

    if (error || !barcode) {
      toast(`Code « ${code} » introuvable dans la base.`, 'error');
      return;
    }

    if (barcode.is_used) {
      toast(`Code « ${code} » déjà utilisé.`, 'error');
      return;
    }

    const batch = batches.find((b) => b.id === depositForm.batch_id);
    const batchPotTypeIds = (batch?.batch_pot_types ?? []).map((bp) => bp.pot_type_id);
    const allowedPotTypeIds = batchPotTypeIds.length > 0 ? batchPotTypeIds : (batch?.pot_type_id ? [batch.pot_type_id] : []);
    if (allowedPotTypeIds.length > 0 && !allowedPotTypeIds.includes(barcode.pot_type_id)) {
      toast(`Ce code correspond à « ${barcode.pot_type?.name ?? 'un autre type'} », pas aux types de cette tournée.`, 'error');
      return;
    }

    setScannedBarcodes((prev) => [...prev, { code, barcode: barcode as BarcodeType }]);
    if (barcode.production_record) {
      toast(`Lot identifié : ${barcode.production_record.pot_type?.name ?? barcode.pot_type?.name ?? 'pot'} produit par ${barcode.production_record.baker?.full_name ?? 'pétrisseur inconnu'} le ${new Date(barcode.production_record.production_date).toLocaleDateString('fr-FR')}.`, 'success');
    }
    if (scanTarget == null) {
      setDepositForm((prev) => ({ ...prev, quantity: prev.quantity + 1 }));
    }
  };

  const handleDirectDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    const pot = potTypes.find((p) => p.id === directForm.pot_type_id);
    const amount = directForm.amount_fcfa || (pot ? pot.unit_price_fcfa * directForm.quantity : 0);
    const batchCode = generateBatchCode();

    const { data: batch, error: batchErr } = await supabase.from('delivery_batches').insert({
      batch_code: batchCode,
      driver_id: drivers[0]?.id,
      pot_type_id: directForm.pot_type_id,
      quantity: directForm.quantity,
      zone: directForm.notes || 'Livraison opportune',
      batch_type: 'livraison',
      status: 'actif',
    }).select().single();

    if (batchErr || !batch) return;

    if (directForm.sales_point_id) {
      await supabase.from('batch_sales_points').insert({
        batch_id: batch.id,
        sales_point_id: directForm.sales_point_id,
      });
    }

    const { data: deposit, error: depErr } = await supabase.from('deposits').insert({
      batch_id: batch.id,
      sales_point_id: directForm.sales_point_id,
      pot_type_id: directForm.pot_type_id || null,
      quantity: directForm.quantity,
      payment_type: directForm.payment_type,
      amount_fcfa: amount,
      is_confirmed: true,
      notes: `Livraison opportune — ${directForm.notes || 'Direction générale'}`,
    }).select().single();

    if (!depErr && deposit) {
      await supabase.from('delivery_events').insert({
        event_type: 'depot',
        batch_id: batch.id,
        sales_point_id: directForm.sales_point_id,
        quantity: directForm.quantity,
        description: `Livraison opportune — ${directForm.quantity} pots (${directForm.payment_type === 'comptant' ? 'Comptant' : 'Crédit'})`,
      });
    }

    if (pot) {
      await supabase.from('stock_movements').insert({
        pot_type_id: directForm.pot_type_id,
        movement_type: 'attribution',
        quantity: directForm.quantity,
        reference_id: batch.id,
        notes: `Attribution lot ${batchCode} (livraison opportune)`,
      });
      const { error: stockErr } = await supabase.rpc('decrement_stock', {
        p_pot_type_id: directForm.pot_type_id,
        p_quantity: directForm.quantity,
      });
      if (stockErr) {
        console.error('stock decrement failed:', stockErr);
        setActionError('Erreur de stock.');
        return;
      }
    }

    // Insert delivery expenses
    if (directExpenses.length > 0 && !depErr && deposit) {
      await supabase.from('delivery_expenses').insert(
        directExpenses.filter((e) => e.amount_fcfa > 0).map((e) => ({
          deposit_id: deposit.id,
          batch_id: batch.id,
          sales_point_id: directForm.sales_point_id,
          driver_id: batch.driver_id,
          amount_fcfa: e.amount_fcfa,
          expense_type: e.expense_type,
          authorized_by: e.expense_type === 'credit_autorise' ? e.authorized_by || null : null,
          reason: e.reason || EXPENSE_TYPE_LABELS[e.expense_type],
          tournee: batch.batch_code,
        }))
      );
    }

    setShowDirectDelivery(false);
    setDirectForm({ pot_type_id: '', sales_point_id: '', quantity: 0, payment_type: 'comptant', amount_fcfa: 0, notes: '' });
    setDirectExpenses([]);
    loadAll();
  };

  const openCollect = async (batchId: string) => {
    setCollectBatchId(batchId);
    setShowCollect(true);
    setCollectLoading(true);
    setCollectForm({});

    const batch = batches.find((b) => b.id === batchId);
    const spIds = (batch?.sales_points ?? []).map((bsp) => bsp.sales_point_id);

    if (isOffline || !navigator.onLine) {
      const cached = await getCachedPageData<Receivable[]>(`batches:collect:${batchId}`);
      setBatchReceivables(cached?.data ?? []);
      setCollectLoading(false);
      return;
    }

    let query = supabase
      .from('receivables')
      .select('*, sales_point:sales_points(*), driver:drivers(*)')
      .neq('status', 'solde')
      .order('created_at', { ascending: false });

    if (spIds.length > 0) {
      query = query.in('sales_point_id', spIds);
    } else {
      query = query.eq('batch_id', batchId);
    }

    const { data } = await query;
    const receivables = (data as Receivable[]) ?? [];
    setBatchReceivables(receivables);
    await cachePageData(`batches:collect:${batchId}`, receivables);
    setCollectLoading(false);
  };

  const handleCollectPayment = async (receivableId: string) => {
    const amount = collectForm[receivableId];
    if (!amount || amount <= 0) return;

    const recv = batchReceivables.find((r) => r.id === receivableId);
    if (!recv) return;

    const { data: result, error: rpcErr } = await supabase.rpc('collect_receivable_payment', {
      p_receivable_id: receivableId,
      p_amount: amount,
      p_batch_id: collectBatchId,
    });

    if (rpcErr) {
      console.error('collect_receivable_payment failed:', rpcErr);
      setActionError('Le paiement n’a pas pu être enregistré.');
      return;
    }

    const resultObj = result as { status: string; amount_paid: number } | null;
    const newStatus = resultObj?.status ?? 'partiel';

    const spName = (recv.sales_point as any)?.name ?? '—';
    await supabase.from('delivery_events').insert({
      event_type: 'depot',
      batch_id: collectBatchId,
      sales_point_id: recv.sales_point_id,
      quantity: 0,
      description: `Recouvrement créance — ${formatFCFA(amount)} encaissé chez « ${spName} » (${newStatus === 'solde' ? 'soldé' : 'partiel'})`,
    });

    setCollectForm((prev) => {
      const next = { ...prev };
      delete next[receivableId];
      return next;
    });
    openCollect(collectBatchId!);
  };

  const toggleSalesPoint = (spId: string, target: 'form' | 'edit') => {
    if (target === 'form') {
      setForm((prev) => {
        const ids = prev.sales_point_ids.includes(spId)
          ? prev.sales_point_ids.filter((id) => id !== spId)
          : [...prev.sales_point_ids, spId];
        return { ...prev, sales_point_ids: ids };
      });
    } else {
      setEditForm((prev) => {
        const ids = prev.sales_point_ids.includes(spId)
          ? prev.sales_point_ids.filter((id) => id !== spId)
          : [...prev.sales_point_ids, spId];
        return { ...prev, sales_point_ids: ids };
      });
    }
  };

  const needsPots = (bt: BatchTypeKey) => bt === 'livraison' || bt === 'mixte';

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {canDirectDeliver && (
            <button onClick={() => setShowDirectDelivery(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <UserCheck className="w-5 h-5" />
              Livraison opportune
            </button>
          )}
          {canCreateBatch && !selectMode && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <Plus className="w-5 h-5" />
              Nouvelle tournée
            </button>
          )}
          {canSuperviseBatch && !selectMode && (
            <button onClick={() => { setSelectMode(true); setSelectedBatchIds(new Set()); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <Trash2 className="w-5 h-5" />
              Supprimer tournée
            </button>
          )}
          {selectMode && (
            <>
              <button
                onClick={handleBulkDelete}
                disabled={selectedBatchIds.size === 0 || bulkDeleting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                <Trash2 className="w-5 h-5" />
                {bulkDeleting ? 'Suppression…' : `Supprimer (${selectedBatchIds.size})`}
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedBatchIds(new Set()); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 transition-all">
                <X className="w-5 h-5" />
                Annuler
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && batches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les tournées.</p>
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune tournée</div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch) => {
            const expanded = selectedBatch === batch.id;
            const deposits = batch.deposits ?? [];
            const batchSPs = batch.sales_points ?? [];
            return (
              <div key={batch.id} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${selectMode && selectedBatchIds.has(batch.id) ? 'border-red-300 ring-2 ring-red-200' : 'border-gray-100'}`}>
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => selectMode ? toggleBatchSelection(batch.id) : setSelectedBatch(expanded ? null : batch.id)}
                >
                  <div className="flex items-center gap-4">
                    {selectMode && (
                      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${selectedBatchIds.has(batch.id) ? 'bg-red-500 border-red-500' : 'bg-white border-gray-300 hover:border-red-400'}`}>
                        {selectedBatchIds.has(batch.id) && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                    )}
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shrink-0">
                      <Truck className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">{batch.batch_code}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          batch.status === 'actif' ? 'bg-blue-50 text-blue-700' :
                          batch.status === 'cloture' ? 'bg-emerald-50 text-emerald-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {batch.status === 'actif' ? 'En cours' : batch.status === 'cloture' ? 'Clôturée' : 'Annulée'}
                        </span>
                        {batch.approval && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            batch.approval.status === 'approuve' ? 'bg-emerald-50 text-emerald-700' :
                            batch.approval.status === 'rejete' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {batch.approval.status === 'approuve' ? 'Validé' : batch.approval.status === 'rejete' ? 'Rejeté' : 'Validation en attente'}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          batch.batch_type === 'recouvrement' ? 'bg-purple-50 text-purple-700' :
                          batch.batch_type === 'mixte' ? 'bg-indigo-50 text-indigo-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {BATCH_TYPE_LABELS[batch.batch_type]}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {batch.driver?.full_name ?? '—'}
                        {(() => {
                          const bpts = batch.batch_pot_types ?? [];
                          if (bpts.length > 0) {
                            return ' · ' + bpts.map((bp) => {
                              const parts = [`${bp.pot_type?.name ?? '—'}×${bp.quantity}`];
                              if (bp.empty_pots > 0) parts.push(`${bp.empty_pots} vides`);
                              if (bp.empty_lids > 0) parts.push(`${bp.empty_lids} couvercles`);
                              return parts.join(' + ');
                            }).join(', ');
                          }
                          return batch.pot_type?.name ? ` · ${batch.pot_type.name}` : '';
                        })()}
                        {batchSPs.length > 0 ? ` · ${batchSPs.length} PDV` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-gray-500">Déposés / Total</p>
                      <p className="font-bold text-gray-900">{deliveredPotsFromDeposits(batch)} / {(() => {
                        const bpts = batch.batch_pot_types ?? [];
                        return bpts.length > 0 ? bpts.reduce((s, bp) => s + bp.quantity, 0) : (batch.quantity ?? '—');
                      })()}</p>
                    </div>
                  </div>
                  {(() => {
                    const bpts = batch.batch_pot_types ?? [];
                    const totalQty = bpts.length > 0 ? bpts.reduce((s, bp) => s + bp.quantity, 0) : (batch.quantity ?? 0);
                    return totalQty != null && totalQty > 0 ? (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-600 rounded-full transition-all"
                            style={{ width: `${totalQty > 0 ? (deliveredPotsFromDeposits(batch) / totalQty) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{Math.max(0, totalQty - deliveredPotsFromDeposits(batch))} restants</span>
                      </div>
                    ) : null;
                  })()}
                </div>

                {expanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                    {/* Sales points summary */}
                    {batchSPs.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Points de vente</h4>
                        <div className="flex flex-wrap gap-2">
                          {batchSPs.map((bsp) => (
                            <span key={bsp.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">
                              <Store className="w-3 h-3" />
                              {bsp.sales_point?.name ?? '—'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <h4 className="text-sm font-semibold text-gray-700">Dépôts ({deposits.length})</h4>
                      <div className="flex gap-2 flex-wrap">
                        {canApproveBatch && batch.approval?.status === 'en_attente' && (
                          <>
                            <button onClick={() => decideBatchApproval(batch, 'approuve')}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors">
                              <CheckCircle2 className="w-4 h-4" /> Valider le lot
                            </button>
                            <button onClick={() => decideBatchApproval(batch, 'rejete')}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 transition-colors">
                              <X className="w-4 h-4" /> Rejeter
                            </button>
                          </>
                        )}
                        {canDeposit && batch.status === 'actif' && needsPots(batch.batch_type) && (
                          <button onClick={() => openDeposit(batch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors">
                            <Plus className="w-4 h-4" />
                            Déposer
                          </button>
                        )}
                        {canDeposit && batch.status === 'actif' && (batch.batch_type === 'recouvrement' || batch.batch_type === 'mixte') && (
                          <button onClick={() => openCollect(batch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors">
                            <HandCoins className="w-4 h-4" />
                            Recouvrer
                          </button>
                        )}
                        {canSuperviseBatch && batch.status === 'actif' && (
                          <button onClick={() => openEdit(batch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
                            <Pencil className="w-4 h-4" />
                            Modifier PDV
                          </button>
                        )}
                        {canSuperviseBatch && batch.status === 'actif' && (
                          <button onClick={() => closeBatch(batch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors">
                            <CheckCircle2 className="w-4 h-4" />
                            Clôturer
                          </button>
                        )}
                        {canSuperviseBatch && batch.status === 'actif' && (
                          <button onClick={() => handleDelete(batch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors">
                            <Trash2 className="w-4 h-4" />
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                    {deposits.length === 0 ? (
                      <p className="text-sm text-gray-400 py-3">Aucun dépôt enregistré</p>
                    ) : (
                      <div className="space-y-2">
                        {deposits.map((dep) => (
                          <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-50 transition-colors">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-100">
                              <MapPin className="w-4 h-4 text-teal-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-gray-900">{dep.sales_point?.name ?? '—'}</p>
                                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">
                                  Validé
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">
                                {new Date(dep.deposited_at).toLocaleString('fr-FR')} · {dep.payment_type === 'comptant' ? 'Comptant' : 'Crédit'}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-gray-900">{dep.quantity} pots</p>
                              <p className="text-xs text-gray-500">{formatFCFA(dep.amount_fcfa)}</p>
                              {dep.receivable && (
                                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                                  dep.receivable.status === 'solde' ? 'bg-emerald-50 text-emerald-700' :
                                  dep.receivable.status === 'partiel' ? 'bg-amber-50 text-amber-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {dep.receivable.status === 'solde' ? 'Soldé' :
                                   dep.receivable.status === 'partiel' ? `Partiel · reste ${formatFCFA(dep.receivable.amount_fcfa - dep.receivable.amount_paid)}` :
                                   'En attente'}
                                </span>
                              )}
                              {dep.barcode && (
                                <span className="inline-flex items-center gap-1 mt-1 ml-1 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">
                                  <ScanLine className="w-3 h-3" />
                                  {dep.barcode.code}
                                </span>
                              )}
                            </div>

                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create batch modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle tournée</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de tournée</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['livraison', 'recouvrement', 'mixte'] as BatchTypeKey[]).map((bt) => (
                    <button key={bt} type="button" onClick={() => setForm({ ...form, batch_type: bt })}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-all ${
                        form.batch_type === bt ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'
                      }`}>
                      {BATCH_TYPE_LABELS[bt]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {form.batch_type === 'livraison' && 'Livraison de pots + retours invendus'}
                  {form.batch_type === 'recouvrement' && 'Collecte de créances uniquement'}
                  {form.batch_type === 'mixte' && 'Livraison + retours + recouvrement'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commercial</label>
                <select required value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}{d.zone ? ` (${d.zone})` : ''}
                    </option>
                  ))}
                </select>
                {drivers.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">Aucun commercial actif n’est disponible. Vérifiez les comptes du personnel puis actualisez la page.</p>
                )}
              </div>
              {needsPots(form.batch_type) && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">Types de pots</label>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, pot_entries: [...form.pot_entries, { pot_type_id: '', quantity: 0, empty_pots: 0, empty_lids: 0 }] })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Ajouter un type
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.pot_entries.length === 0 && (
                        <p className="text-sm text-gray-400 px-3 py-2 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                          Aucun type de pot ajouté. Cliquez sur « Ajouter un type » pour en ajouter.
                        </p>
                      )}
                      {form.pot_entries.map((pe, idx) => (
                        <div key={idx} className="rounded-xl border border-gray-200 p-2.5 space-y-2">
                          <div className="flex gap-2 items-center">
                            <select
                              value={pe.pot_type_id}
                              onChange={(e) => updatePotEntry(idx, { pot_type_id: e.target.value })}
                              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                            >
                              <option value="">— Choisir —</option>
                              {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name} (stock: {p.stock_quantity})</option>)}
                            </select>
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, pot_entries: form.pot_entries.filter((_, i) => i !== idx) })}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Pots prêts</label>
                              <input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={pe.quantity || ''}
                                onChange={(e) => updatePotEntry(idx, { quantity: Number(e.target.value) })}
                                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Pots vides</label>
                              <input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={pe.empty_pots || ''}
                                onChange={(e) => updatePotEntry(idx, { empty_pots: Number(e.target.value) })}
                                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Couvercles</label>
                              <input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={pe.empty_lids || ''}
                                onChange={(e) => updatePotEntry(idx, { empty_lids: Number(e.target.value) })}
                                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {form.pot_entries.length > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Total: {form.pot_entries.reduce((s, pe) => s + pe.quantity, 0)} pots prêts · {form.pot_entries.reduce((s, pe) => s + (pe.empty_pots ?? 0), 0)} vides · {form.pot_entries.reduce((s, pe) => s + (pe.empty_lids ?? 0), 0)} couvercles
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                    <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  </div>
                </>
              )}
              {!needsPots(form.batch_type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                  <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points de vente concernés</label>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                  {salesPoints.map((sp) => (
                    <label key={sp.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.sales_point_ids.includes(sp.id)}
                        onChange={() => toggleSalesPoint(sp.id, 'form')}
                        className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-sm text-gray-700">{sp.name}</span>
                      <span className="text-xs text-gray-400">({sp.district})</span>
                    </label>
                  ))}
                </div>
                {salesPoints.length === 0 ? (
                  <p className="text-xs text-amber-700 mt-1">Aucun point de vente actif disponible. Créez-le en ligne dans « Points de vente ».</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">{form.sales_point_ids.length} point(s) sélectionné(s)</p>
                )}
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Créer la tournée
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit sales points modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Modifier les points de vente</h3>
                <p className="text-xs text-gray-500 mt-0.5">Ajoutez ou retirez des points de vente oubliés ou en erreur</p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points de vente de la tournée</label>
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                  {salesPoints.map((sp) => (
                    <label key={sp.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.sales_point_ids.includes(sp.id)}
                        onChange={() => toggleSalesPoint(sp.id, 'edit')}
                        className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-sm text-gray-700">{sp.name}</span>
                      <span className="text-xs text-gray-400">({sp.district})</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">{editForm.sales_point_ids.length} point(s) sélectionné(s)</p>
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Enregistrer les modifications
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Collect receivables modal */}
      {showCollect && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCollect(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Recouvrer des créances</h3>
                <p className="text-xs text-gray-500 mt-0.5">Encaissez les paiements dus par les points de vente</p>
              </div>
              <button onClick={() => setShowCollect(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            {collectLoading ? (
              <div className="text-center py-8 text-gray-400">Chargement des créances…</div>
            ) : batchReceivables.length === 0 ? (
              <div className="text-center py-8 text-gray-400">Aucune créance en attente pour les points de vente de cette tournée.</div>
            ) : (
              <div className="space-y-3">
                {batchReceivables.map((recv) => {
                  const remaining = recv.amount_fcfa - recv.amount_paid;
                  const spName = (recv.sales_point as any)?.name ?? '—';
                  return (
                    <div key={recv.id} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{spName}</p>
                          <p className="text-xs text-gray-500">
                            Total: {formatFCFA(recv.amount_fcfa)} · Encaissé: {formatFCFA(recv.amount_paid)}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          recv.status === 'partiel' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          Reste {formatFCFA(remaining)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={1}
                          max={remaining}
                          placeholder={`Montant (max ${formatFCFA(remaining)})`}
                          value={collectForm[recv.id] ?? ''}
                          onChange={(e) => setCollectForm({ ...collectForm, [recv.id]: Number(e.target.value) })}
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none text-sm"
                        />
                        <button
                          onClick={() => handleCollectPayment(recv.id)}
                          disabled={!collectForm[recv.id] || collectForm[recv.id] <= 0}
                          className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
                        >
                          Encaisser
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Direct delivery modal */}
      {showDirectDelivery && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDirectDelivery(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Livraison opportune</h3>
                <p className="text-xs text-gray-500 mt-0.5">Enregistrer une livraison effectuée directement</p>
              </div>
              <button onClick={() => setShowDirectDelivery(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleDirectDelivery} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Point de vente</label>
                <select required value={directForm.sales_point_id} onChange={(e) => setDirectForm({ ...directForm, sales_point_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none">
                  <option value="">— Choisir —</option>
                  {salesPoints.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.district})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
                <select required value={directForm.pot_type_id} onChange={(e) => setDirectForm({ ...directForm, pot_type_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none">
                  <option value="">— Choisir —</option>
                  {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name} (stock: {p.stock_quantity})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité livrée</label>
                <input type="number" min={1} required value={directForm.quantity || ''} onChange={(e) => setDirectForm({ ...directForm, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de paiement</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDirectForm({ ...directForm, payment_type: 'comptant' })}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      directForm.payment_type === 'comptant' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <Wallet className="w-4 h-4" /> Comptant
                  </button>
                  <button type="button" onClick={() => setDirectForm({ ...directForm, payment_type: 'credit' })}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      directForm.payment_type === 'credit' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <Clock className="w-4 h-4" /> Crédit
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Montant (FCFA) — laisser vide pour auto</label>
                <input type="number" min={0} value={directForm.amount_fcfa || ''} onChange={(e) => setDirectForm({ ...directForm, amount_fcfa: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none" />
                {(() => {
                  const pot = potTypes.find((p) => p.id === directForm.pot_type_id);
                  const auto = pot ? pot.unit_price_fcfa * directForm.quantity : 0;
                  const shown = directForm.amount_fcfa || auto;
                  return shown > 0 ? (
                    <p className="mt-1 text-sm text-gray-500">
                      Total: <span className="font-bold text-gray-900">{formatFCFA(shown)}</span>
                      {pot && !directForm.amount_fcfa && <span className="text-gray-400"> ({directForm.quantity} × {formatFCFA(pot.unit_price_fcfa)})</span>}
                    </p>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={directForm.notes} onChange={(e) => setDirectForm({ ...directForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none" />
              </div>
              <ExpenseEntrySection expenses={directExpenses} onChange={setDirectExpenses} accent="emerald"
                driverName={drivers[0]?.full_name}
                salesPointName={salesPoints.find((sp) => sp.id === directForm.sales_point_id)?.name}
              />
              <button type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Enregistrer la livraison
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Deposit modal */}
      {showDeposit && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDeposit(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Enregistrer un dépôt</h3>
              <button onClick={() => setShowDeposit(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleDeposit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Point de vente</label>
                <select required value={depositForm.sales_point_id} onChange={(e) => setDepositForm({ ...depositForm, sales_point_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {salesPoints.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.district})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot déposé</label>
                <select required value={depositForm.pot_type_id} onChange={(e) => setDepositForm({ ...depositForm, pot_type_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Choisir —</option>
                  {(() => {
                    const batch = batches.find((b) => b.id === depositForm.batch_id);
                    const bpts = batch?.batch_pot_types ?? [];
                    if (bpts.length > 0) {
                      return bpts.map((bp) => (
                        <option key={bp.pot_type_id} value={bp.pot_type_id}>
                          {bp.pot_type?.name ?? '—'} (stock tournée: {bp.quantity})
                        </option>
                      ));
                    }
                    return potTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
                  })()}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité déposée</label>
                <input type="number" min={1} required value={depositForm.quantity || ''} onChange={(e) => setDepositForm({ ...depositForm, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Codes à barres scannés
                    {scannedBarcodes.length > 0 && (
                      <span className="ml-1 text-xs text-amber-600 font-semibold">({scannedBarcodes.length} pot(s) scanné(s))</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    {scannedBarcodes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const wasIncremental = scanTarget == null;
                          setScannedBarcodes([]);
                          if (wasIncremental) {
                            setDepositForm((prev) => ({ ...prev, quantity: Math.max(0, prev.quantity - scannedBarcodes.length) }));
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors border border-red-200"
                      >
                        <Trash2 className="w-4 h-4" />
                        Vider
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const target = depositForm.quantity > scannedBarcodes.length ? depositForm.quantity : null;
                        setScanTarget(target);
                        setShowScanner(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors border border-amber-200"
                    >
                      <ScanLine className="w-4 h-4" />
                      {scannedBarcodes.length > 0 ? 'Continuer le scan' : 'Scanner les pots'}
                    </button>
                  </div>
                </div>
                {scannedBarcodes.length === 0 ? (
                  <p className="text-sm text-gray-400 px-3 py-2 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                    Aucun code scanné. Cliquez sur « Scanner » pour activer la caméra, ou saisissez la quantité manuellement.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {scannedBarcodes.map((sb, i) => (
                      <div key={sb.code} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="text-sm font-mono text-gray-700 flex-1 truncate">{sb.code}</span>
                        <span className="text-xs text-gray-500">{sb.barcode?.pot_type?.name ?? '—'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setScannedBarcodes((prev) => prev.filter((_, idx) => idx !== i));
                            setDepositForm((prev) => ({ ...prev, quantity: Math.max(0, prev.quantity - 1) }));
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de paiement</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDepositForm({ ...depositForm, payment_type: 'comptant' })}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      depositForm.payment_type === 'comptant' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <Wallet className="w-4 h-4" /> Comptant
                  </button>
                  <button type="button" onClick={() => setDepositForm({ ...depositForm, payment_type: 'credit' })}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      depositForm.payment_type === 'credit' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <Clock className="w-4 h-4" /> Crédit
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Montant encaissé (FCFA) — laisser vide pour auto</label>
                <input type="number" min={0} value={depositForm.amount_fcfa || ''} onChange={(e) => setDepositForm({ ...depositForm, amount_fcfa: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                {(() => {
                  const pot = potTypes.find((p) => p.id === depositForm.pot_type_id);
                  const expected = pot ? pot.unit_price_fcfa * depositForm.quantity : 0;
                  const entered = depositForm.amount_fcfa || 0;
                  const shown = entered || expected;
                  return shown > 0 ? (
                    <p className="mt-1 text-sm text-gray-500">
                      {entered > 0 ? 'Saisi' : 'Attendu'}: <span className="font-bold text-gray-900">{formatFCFA(shown)}</span>
                      {pot && !entered && <span className="text-gray-400"> ({depositForm.quantity} × {formatFCFA(pot.unit_price_fcfa)})</span>}
                    </p>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={depositForm.notes} onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <ExpenseEntrySection expenses={depositExpenses} onChange={setDepositExpenses} accent="amber"
                driverName={batches.find((b) => b.id === depositForm.batch_id)?.driver?.full_name}
                salesPointName={salesPoints.find((sp) => sp.id === depositForm.sales_point_id)?.name}
                batchCode={batches.find((b) => b.id === depositForm.batch_id)?.batch_code}
              />
              <button type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Valider le dépôt
              </button>
            </form>
          </div>
        </div>
      )}

      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => { setShowScanner(false); setScanTarget(null); }}
          targetCount={scanTarget ?? undefined}
          scannedCount={scannedBarcodes.length}
        />
      )}

      {summaryBatch && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Résumé de tournée</h2>
              <button onClick={() => setSummaryBatch(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Tournée</span>
                <span className="font-mono font-medium">{summaryBatch.batch_code}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Commercial</span>
                <span className="font-medium">{summaryBatch.driver?.full_name ?? '—'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <p className="text-xs text-amber-600 font-medium">Pots déposés</p>
                  <p className="text-xl font-bold text-amber-700">
                    {(summaryBatch.deposits ?? []).reduce((s, d) => s + (d.quantity || 0), 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-teal-50 border border-teal-100 p-3">
                  <p className="text-xs text-teal-600 font-medium">Points de vente</p>
                  <p className="text-xl font-bold text-teal-700">{(summaryBatch.sales_points ?? []).length}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                  <p className="text-xs text-emerald-600 font-medium">Encaissé (comptant)</p>
                  <p className="text-xl font-bold text-emerald-700">
                    {formatFCFA((summaryBatch.deposits ?? []).filter((d) => d.payment_type === 'comptant').reduce((s, d) => s + (d.amount_fcfa || 0), 0))}
                  </p>
                </div>
                <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
                  <p className="text-xs text-orange-600 font-medium">Crédit</p>
                  <p className="text-xl font-bold text-orange-700">
                    {formatFCFA((summaryBatch.deposits ?? []).filter((d) => d.payment_type === 'credit').reduce((s, d) => s + (d.amount_fcfa || 0), 0))}
                  </p>
                </div>
              </div>

              {(summaryBatch.sales_points ?? []).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Points de vente</h3>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {(summaryBatch.sales_points ?? []).map((sp) => (
                      <div key={sp.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50">
                        <span className="text-gray-700">{(sp.sales_point as any)?.name ?? '—'}</span>
                        <span className="text-gray-400 text-xs">{(sp.sales_point as any)?.address || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(summaryBatch.deposits ?? []).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Détail des dépôts</h3>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {(summaryBatch.deposits ?? []).map((dep) => (
                      <div key={dep.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50">
                        <span className="text-gray-600">{(dep.sales_point as any)?.name ?? '—'}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-400">{dep.quantity} pots</span>
                          <span className="font-medium">{formatFCFA(dep.amount_fcfa || 0)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={exportSummaryPDF}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50">
                  <FileText className="w-4 h-4" />
                  Exporter PDF
                </button>
                <button onClick={confirmCloseBatch}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Confirmer la clôture
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {stockAlerts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[90]">
          <button
            onClick={() => setShowStockAlerts((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-red-500 text-white font-medium shadow-lg hover:bg-red-600 transition-all"
          >
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm font-semibold">{stockAlerts.length}</span>
            <span className="text-sm">alerte{stockAlerts.length > 1 ? 's' : ''} stock</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showStockAlerts ? 'rotate-180' : ''}`} />
          </button>
          {showStockAlerts && (
            <div className="absolute bottom-full right-0 mb-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden animate-[scaleIn_180ms_ease-out]">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-semibold text-red-700">Alertes de stock faible</h3>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                {stockAlerts.map((alert) => (
                  <div key={alert.pot_type.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{alert.pot_type.name}</p>
                      <p className="text-xs text-gray-500">
                        {alert.current} restants · seuil {alert.threshold}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${alert.current === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {alert.current === 0 ? 'Rupture' : 'Faible'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
