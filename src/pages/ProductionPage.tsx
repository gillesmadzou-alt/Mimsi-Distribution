import { useEffect, useState, useCallback } from 'react';
import { supabase, Baker, ProductionRecord, PotType, Profile, Kneader, DoughDelivery, DoughBatch, PersonnelChangeRequest, MADELEINES_PER_PATE, MADELEINE_VARIANCE_TOLERANCE_PCT, PATE_WEIGHT_KG } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { downloadPdfReport, downloadExcelReport } from '@/lib/exportUtils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { useSync } from '@/contexts/SyncContext';
import { brazzavilleToday } from '@/lib/brazzavilleTime';
import {
  Plus, X, User as UserIcon, Phone, ChefHat, Calendar,
  Edit2, Trash2, Package, PackageX, Flame, AlertTriangle, CheckCircle2,
  Beaker, Droplets, Scale, Clock, UserPlus, UserCog, UserMinus, FlaskConical,
  ArrowRight, Download, FileSpreadsheet, Cake, XCircle, CloudOff,
} from 'lucide-react';

type Tab = 'records' | 'dough' | 'bakers' | 'kneaders';

export default function ProductionPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [kneaders, setKneaders] = useState<Kneader[]>([]);
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [doughDeliveries, setDoughDeliveries] = useState<DoughDelivery[]>([]);
  const [doughBatches, setDoughBatches] = useState<DoughBatch[]>([]);
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('records');
  const [filterBaker, setFilterBaker] = useState('all');
  const [filterKneader, setFilterKneader] = useState('all');

  const [showBakerModal, setShowBakerModal] = useState(false);
  const [showKneaderModal, setShowKneaderModal] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showDoughModal, setShowDoughModal] = useState(false);
  const [editingBaker, setEditingBaker] = useState<Baker | null>(null);
  const [editingKneader, setEditingKneader] = useState<Kneader | null>(null);
  const [myBaker, setMyBaker] = useState<Baker | null>(null);
  const [myKneader, setMyKneader] = useState<Kneader | null>(null);
  const [linkableProfiles, setLinkableProfiles] = useState<Profile[]>([]);

  const [bakerForm, setBakerForm] = useState({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
  const [kneaderForm, setKneaderForm] = useState({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
  const [recordForm, setRecordForm] = useState({
    baker_id: '', pot_type_id: '', quantity: 0, pots_burned: 0, dough_delivery_id: '',
    madeleines_good: 0, madeleines_burned: 0, madeleines_broken: 0, madeleines_defective: 0,
    dough_used_kg: 0, buckets_used: 0, cakes_baked: 0, pates_count: 0,
    production_date: brazzavilleToday(), notes: '',
  });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [doughForm, setDoughForm] = useState({
    kneader_id: '', baker_id: '', bucket_count: 1, bucket_weight_kg: 0,
    delivery_date: brazzavilleToday(), notes: '', dough_batch_id: '',
  });

  const ispétrisseur = (profile?.role ?? 1) === 9;
  const isKneader = (profile?.role ?? 1) === 8;
  const canManage = (profile?.role ?? 1) >= 2;
  const canManageBakers = (profile?.role ?? 1) >= 4 && !ispétrisseur && !isKneader;
  const canCreateRecord = canManage && !isKneader;
  const isDirectrice = (profile?.role ?? 1) === 5;
  const isAdjoint = (profile?.role ?? 1) === 4;
  const isAdmin = (profile?.role ?? 1) === 6;

  const [pendingBakerReqs, setPendingBakerReqs] = useState<(PersonnelChangeRequest & { requester?: { full_name: string } })[]>([]);
  const [pendingKneaderReqs, setPendingKneaderReqs] = useState<(PersonnelChangeRequest & { requester?: { full_name: string } })[]>([]);

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
    const result = await fetchWithCache<{
      bakers: Baker[];
      kneaders: Kneader[];
      records: ProductionRecord[];
      doughDeliveries: DoughDelivery[];
      doughBatches: DoughBatch[];
      potTypes: PotType[];
      pendingBakerReqs: (PersonnelChangeRequest & { requester?: { full_name: string } })[];
      pendingKneaderReqs: (PersonnelChangeRequest & { requester?: { full_name: string } })[];
    }>('production-page:v2', async () => {
      const [bakersRes, kneadersRes, recordsRes, doughRes, potsRes, bakerPendRes, kneaderPendRes, batchRes] = await Promise.all([
        supabase.from('bakers').select('*').order('full_name'),
        supabase.from('kneaders').select('*').order('full_name'),
        supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*), dough_delivery:dough_deliveries(*, kneader:kneaders(*))').order('production_date', { ascending: false }).limit(100),
        supabase.from('dough_deliveries').select('*, kneader:kneaders(*), baker:bakers(*), dough_batch:dough_batches(*)').order('delivery_date', { ascending: false }).limit(100),
        supabase.from('pot_types').select('*').eq('is_active', true).order('name'),
        supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').eq('entity_type', 'baker').eq('status', 'en_attente').order('created_at', { ascending: false }),
        supabase.from('personnel_change_requests').select('*, requester:profiles!requested_by(full_name)').eq('entity_type', 'kneader').eq('status', 'en_attente').order('created_at', { ascending: false }),
        supabase.from('dough_batches').select('*, kneader:kneaders(*), ingredients:dough_batch_ingredients(*, ingredient:ingredients(*))').order('batch_date', { ascending: false }).limit(50),
      ]);
      const loadError = [bakersRes, kneadersRes, recordsRes, doughRes, potsRes, bakerPendRes, kneaderPendRes, batchRes]
        .map((response) => response.error)
        .find(Boolean);
      if (loadError) throw loadError;

      return {
        bakers: bakersRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        records: recordsRes.data ?? [],
        doughDeliveries: doughRes.data ?? [],
        doughBatches: batchRes.data ?? [],
        potTypes: potsRes.data ?? [],
        pendingBakerReqs: bakerPendRes.data ?? [],
        pendingKneaderReqs: kneaderPendRes.data ?? [],
      };
    });
    if (result.data) {
      const { bakers: allBakers, kneaders: allKneaders, records: allRecords, doughDeliveries: allDough, doughBatches: allBatches, potTypes: allPots, pendingBakerReqs: allBakerReqs, pendingKneaderReqs: allKneaderReqs } = result.data;
      const bakers = Array.isArray(allBakers) ? allBakers : [];
      const kneaders = Array.isArray(allKneaders) ? allKneaders : [];
      setBakers(bakers);
      setKneaders(kneaders);
      setRecords(Array.isArray(allRecords) ? allRecords : []);
      setDoughDeliveries(Array.isArray(allDough) ? allDough : []);
      setDoughBatches(Array.isArray(allBatches) ? allBatches : []);
      setPotTypes(Array.isArray(allPots) ? allPots : []);
      setPendingBakerReqs(Array.isArray(allBakerReqs) ? allBakerReqs : []);
      setPendingKneaderReqs(Array.isArray(allKneaderReqs) ? allKneaderReqs : []);
      if (profile) {
        const me = bakers.find((b) => b.profile_id === profile.id);
        setMyBaker(me ?? null);
        const myKnead = kneaders.find((k) => k.profile_id === profile.id);
        setMyKneader(myKnead ?? null);
      }
    } else if (result.error) {
      setLoadError(result.error);
    }
    } catch {
      setLoadError('Erreur lors du chargement des donnees de production.');
    }
    setLoading(false);
  }, [fetchWithCache, profile]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useRealtimeSubscription('production-page', isOffline ? [] : ['production_records', 'dough_deliveries', 'dough_batches', 'compliance_discrepancies', 'personnel_change_requests', 'pot_types'], () => { loadAll(); });

  const fetchProfiles = async (role: number) => {
    if (isOffline || !navigator.onLine) {
      const cached = await getCachedPageData<Profile[]>(`production:profiles:${role}`);
      setLinkableProfiles(cached?.data ?? []);
      return;
    }
    const { data } = await supabase.from('profiles').select('*').eq('role', role).order('full_name');
    const profiles = (data as Profile[]) ?? [];
    setLinkableProfiles(profiles);
    await cachePageData(`production:profiles:${role}`, profiles);
  };

  const handleBakerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...bakerForm, profile_id: bakerForm.profile_id || null };
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('personnel_change_requests').insert({
      entity_type: 'baker',
      action_type: editingBaker ? 'update' : 'create',
      entity_id: editingBaker?.id ?? null,
      payload,
      requested_by: userId,
    });
    setShowBakerModal(false);
    setEditingBaker(null);
    setBakerForm({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
    loadAll();
  };

  const handleKneaderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...kneaderForm, profile_id: kneaderForm.profile_id || null };
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('personnel_change_requests').insert({
      entity_type: 'kneader',
      action_type: editingKneader ? 'update' : 'create',
      entity_id: editingKneader?.id ?? null,
      payload,
      requested_by: userId,
    });
    setShowKneaderModal(false);
    setEditingKneader(null);
    setKneaderForm({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
    loadAll();
  };

  const handleDoughSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const kneaderId = isKneader && myKneader ? myKneader.id : doughForm.kneader_id;
    if (!kneaderId) { toast('Veuillez sélectionner un fournier.', 'error'); return; }
    if (!doughForm.baker_id) { toast('Veuillez sélectionner un pétrisseur.', 'error'); return; }
    if (doughForm.bucket_count <= 0) { toast('Le nombre de seaux doit être supérieur à 0.', 'error'); return; }
    if (doughForm.bucket_weight_kg <= 0) { toast('Le poids par seau doit être supérieur à 0.', 'error'); return; }

    const steps = buildSteps().insert('dough_deliveries', {
      kneader_id: kneaderId,
      baker_id: doughForm.baker_id,
      bucket_count: doughForm.bucket_count,
      bucket_weight_kg: doughForm.bucket_weight_kg,
      delivery_date: doughForm.delivery_date,
      notes: doughForm.notes,
      dough_batch_id: doughForm.dough_batch_id || null,
    }).getSteps();

    const result = await save('Livraison de pâte', 'production', steps, () => loadAll());
    if (result.offline) {
      toast('Hors-ligne : votre livraison de pâte a été enregistrée sur ce téléphone. Elle sera synchronisée automatiquement dès le retour de la connexion.', 'info');
    }
    if (!result.offline) syncNow();

    setShowDoughModal(false);
    setDoughForm({ kneader_id: '', baker_id: '', bucket_count: 1, bucket_weight_kg: 0, delivery_date: brazzavilleToday(), notes: '', dough_batch_id: '' });
    loadAll();
  };

  const { save } = useOfflineSave();
  const { syncNow } = useSync();

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bakerId = ispétrisseur && myBaker ? myBaker.id : recordForm.baker_id;
    if (!bakerId) { toast('Veuillez sélectionner un pétrisseur.', 'error'); return; }
    const totalMadeleines = recordForm.madeleines_good + recordForm.madeleines_burned + recordForm.madeleines_broken + recordForm.madeleines_defective;
    if (recordForm.quantity <= 0 && totalMadeleines <= 0) {
      toast('Saisissez au moins une quantité de pots ou de madeleines.', 'error');
      return;
    }

    // Pâte-based madeleine compliance: 1 pâte = 7.5 kg = 471 madeleines
    const patesCount = recordForm.pates_count || 0;
    const expectedMadeleines = patesCount > 0 ? patesCount * MADELEINES_PER_PATE : null;
    const actualMadeleines = recordForm.madeleines_good + recordForm.madeleines_burned + recordForm.madeleines_broken + recordForm.madeleines_defective;
    const madeleineVariance = expectedMadeleines != null && expectedMadeleines > 0
      ? Number((((actualMadeleines - expectedMadeleines) / expectedMadeleines) * 100).toFixed(2))
      : null;

    const pot = potTypes.find((p) => p.id === recordForm.pot_type_id);

    const steps = buildSteps()
      .insertSingle('production_records', {
        baker_id: bakerId,
        pot_type_id: recordForm.pot_type_id,
        quantity: recordForm.quantity,
        pots_burned: recordForm.pots_burned,
        madeleines_good: recordForm.madeleines_good,
        madeleines_burned: recordForm.madeleines_burned,
        madeleines_broken: recordForm.madeleines_broken,
        madeleines_defective: recordForm.madeleines_defective,
        dough_delivery_id: recordForm.dough_delivery_id || null,
        dough_used_kg: recordForm.dough_used_kg || null,
        buckets_used: recordForm.buckets_used || null,
        cakes_baked: recordForm.cakes_baked,
        pates_count: patesCount > 0 ? patesCount : null,
        expected_madeleines: expectedMadeleines,
        madeleine_variance: madeleineVariance,
        production_date: recordForm.production_date,
        notes: recordForm.notes,
      }, { id: 'prod' })
      .getSteps();

    if (recordForm.quantity > 0 && pot) {
      // Read current stock from DB to avoid race condition with concurrent updates
      const { data: freshPot } = await supabase
        .from('pot_types')
        .select('stock_quantity')
        .eq('id', pot.id)
        .maybeSingle();

      const currentStock = freshPot?.stock_quantity ?? pot.stock_quantity;
      steps.push({
        id: 'pot_type_update',
        table: 'pot_types',
        operation: 'update',
        body: { stock_quantity: currentStock + recordForm.quantity },
        filter: { column: 'id', value: pot.id },
      });
      steps.push({
        id: 'stock_movement',
        table: 'stock_movements',
        operation: 'insert',
        body: {
          pot_type_id: recordForm.pot_type_id,
          movement_type: 'entree',
          quantity: recordForm.quantity,
          reference_id: '__pending__',
          notes: `Production ${recordForm.production_date}`,
        },
        dependsOn: 'prod',
        injectField: 'reference_id',
      });
    }

    const result = await save('Enregistrement de production', 'production', steps, () => loadAll());
    if (result.offline) {
      toast('Hors-ligne : votre saisie de production a été enregistrée sur ce téléphone. Elle sera synchronisée automatiquement dès le retour de la connexion.', 'info');
    } else if (result.queued) {
      toast('Sauvegarde temporairement en file d\'attente. Elle sera synchronisée automatiquement.', 'info');
    }
    if (!result.offline) syncNow();

    // Notify direction (roles 4 and 5) about the production
    if (!result.offline) {
      try {
        const bakerName = ispétrisseur && myBaker ? myBaker.full_name : bakers.find((b) => b.id === bakerId)?.full_name ?? '—';
        const potName = potTypes.find((p) => p.id === recordForm.pot_type_id)?.name ?? '—';
        const alerts: string[] = [];
        if (recordForm.dough_delivery_id) {
          const dd = doughDeliveries.find((d) => d.id === recordForm.dough_delivery_id);
          if (dd && recordForm.buckets_used > 0 && recordForm.buckets_used < dd.bucket_count) {
            alerts.push(`Seaux reçus: ${dd.bucket_count}, utilisés: ${recordForm.buckets_used} — ${dd.bucket_count - recordForm.buckets_used} seau(x) non utilisé(s)`);
          }
          if (dd && recordForm.cakes_baked === 0) {
            alerts.push('Aucun gâteau enfourné malgré une livraison de pâte reçue');
          }
        }
        if (recordForm.pots_burned > 0 && recordForm.quantity > 0 && recordForm.pots_burned / recordForm.quantity > 0.15) {
          alerts.push(`Taux de pots cramés élevé: ${recordForm.pots_burned}/${recordForm.quantity} (${Math.round(recordForm.pots_burned / recordForm.quantity * 100)}%)`);
        }
        const baseMsg = `Production de ${bakerName} — ${recordForm.quantity} pots de ${potName} le ${new Date(recordForm.production_date).toLocaleDateString('fr-FR')}`;
        const fullMsg = alerts.length > 0 ? `${baseMsg}. Alertes: ${alerts.join('; ')}` : baseMsg;
        const { data: directors } = await supabase.from('profiles').select('id').gte('role', 4).eq('is_active', true);
        if (directors && directors.length > 0) {
          await supabase.from('app_notifications').insert(
            directors.map((d) => ({
              user_id: d.id,
              title: alerts.length > 0 ? 'Alerte production' : 'Nouvelle production',
              message: fullMsg,
              type: alerts.length > 0 ? 'warning' : 'info',
              priority: alerts.length > 0 ? 'haute' : 'moyenne',
              link_page: 'production',
            }))
          );
        }
      } catch {}
    }

    // Create compliance discrepancy if madeleine variance exceeds tolerance
    if (!result.offline && madeleineVariance != null && Math.abs(madeleineVariance) > MADELEINE_VARIANCE_TOLERANCE_PCT) {
      try {
        const bakerName = ispétrisseur && myBaker ? myBaker.full_name : bakers.find((b) => b.id === bakerId)?.full_name ?? '—';
        const doughKg = recordForm.dough_used_kg || 0;
        const buckets = recordForm.buckets_used || 0;
        const discMsg = `Écart de production: ${bakerName} — ${actualMadeleines} madeleines produites vs ${expectedMadeleines} attendues (${madeleineVariance > 0 ? '+' : ''}${madeleineVariance}%). ${patesCount} pâte(s) de ${PATE_WEIGHT_KG} kg utilisée(s).`;
        const discComment = `${patesCount} pâte(s) de ${PATE_WEIGHT_KG} kg · ${buckets} seau(x) · ${doughKg.toFixed(2)} kg de pâte utilisée(s)`;
        await supabase.from('compliance_discrepancies').insert({
          chain_stage: 'pate_production',
          entity_type: 'production_record',
          entity_label: `${bakerName} — ${recordForm.production_date}`,
          expected_qty: expectedMadeleines,
          actual_qty: actualMadeleines,
          variance: madeleineVariance,
          unit: 'madeleines',
          status: 'non_resolu',
          notified_roles: [2, 4, 5, 6, 16],
          comment: discComment,
        });
        const { data: complianceRecipients } = await supabase
          .from('profiles')
          .select('id')
          .in('role', [2, 4, 5, 6, 16])
          .eq('is_active', true);
        if (complianceRecipients && complianceRecipients.length > 0) {
          await supabase.from('app_notifications').insert(
            complianceRecipients.map((d) => ({
              user_id: d.id,
              title: 'Alerte conformité madeleines',
              message: discMsg,
              type: 'warning',
              priority: 'haute',
              link_page: 'compliance',
            }))
          );
        }
      } catch {}
    }

    setShowRecordModal(false);
    setRecordForm({ baker_id: '', pot_type_id: '', quantity: 0, pots_burned: 0, dough_delivery_id: '', madeleines_good: 0, madeleines_burned: 0, madeleines_broken: 0, madeleines_defective: 0, dough_used_kg: 0, buckets_used: 0, cakes_baked: 0, pates_count: 0, production_date: brazzavilleToday(), notes: '' });
    loadAll();
  };

  const handleExportPdf = () => {
    const filtered = records.filter((r) => filterBaker === 'all' || r.baker_id === filterBaker);
    downloadPdfReport({
      title: 'Rapport de production',
      subtitle: filterBaker !== 'all' ? `pétrisseur: ${bakers.find((b) => b.id === filterBaker)?.full_name ?? '—'}` : 'Tous les pétrisseurs',
      columns: [
        { header: 'Date', key: 'date' },
        { header: 'Pétrisseur', key: 'baker' },
        { header: 'Pot', key: 'pot' },
        { header: 'Qté', key: 'qty', align: 'right' },
        { header: 'Cramés', key: 'burned', align: 'right' },
        { header: 'Seaux utilisés', key: 'buckets', align: 'right' },
        { header: 'Pâte utilisée (kg)', key: 'dough', align: 'right' },
        { header: 'Gâteaux enfournés', key: 'cakes', align: 'right' },
        { header: 'Pâtes (7,5 kg)', key: 'pates', align: 'right' },
        { header: 'Madeleines attendues', key: 'expected', align: 'right' },
        { header: 'Écart (%)', key: 'variance', align: 'right' },
        { header: 'Bonnes', key: 'good', align: 'right' },
        { header: 'Cramées', key: 'madBurned', align: 'right' },
        { header: 'Cassées', key: 'madBroken', align: 'right' },
        { header: 'Défectueuses', key: 'defective', align: 'right' },
      ],
      rows: filtered.map((r) => ({
        date: new Date(r.production_date).toLocaleDateString('fr-FR'),
        baker: r.baker?.full_name ?? '—',
        pot: r.pot_type?.name ?? '—',
        qty: r.quantity,
        burned: r.pots_burned ?? 0,
        buckets: r.buckets_used ?? '—',
        dough: r.dough_used_kg ? Number(r.dough_used_kg).toFixed(2) : '—',
        cakes: r.cakes_baked ?? 0,
        pates: r.pates_count ?? '—',
        expected: r.expected_madeleines ?? '—',
        variance: r.madeleine_variance != null ? `${Number(r.madeleine_variance) > 0 ? '+' : ''}${Number(r.madeleine_variance).toFixed(1)}%` : '—',
        good: r.madeleines_good,
        madBurned: r.madeleines_burned,
        madBroken: r.madeleines_broken ?? 0,
        defective: r.madeleines_defective,
      })),
      summary: [
        { label: 'Total pots', value: String(filtered.reduce((s, r) => s + r.quantity, 0)) },
        { label: 'Total pots cramés', value: String(filtered.reduce((s, r) => s + (r.pots_burned ?? 0), 0)) },
        { label: 'Total seaux utilisés', value: String(filtered.reduce((s, r) => s + (r.buckets_used ?? 0), 0)) },
        { label: 'Total pâte utilisée (kg)', value: filtered.reduce((s, r) => s + Number(r.dough_used_kg ?? 0), 0).toFixed(2) },
        { label: 'Total gâteaux enfournés', value: String(filtered.reduce((s, r) => s + (r.cakes_baked ?? 0), 0)) },
        { label: 'Total pâtes utilisées', value: String(filtered.reduce((s, r) => s + (r.pates_count ?? 0), 0)) },
        { label: 'Écarts de conformité', value: String(filtered.filter((r) => r.madeleine_variance != null && Math.abs(Number(r.madeleine_variance)) > MADELEINE_VARIANCE_TOLERANCE_PCT).length) },
      ],
      fileName: 'rapport_production',
    });
  };

  const handleExportExcel = () => {
    const filtered = records.filter((r) => filterBaker === 'all' || r.baker_id === filterBaker);
    downloadExcelReport({
      title: 'Rapport de production',
      columns: [
        { header: 'Date', key: 'date' },
        { header: 'Pétrisseur', key: 'baker' },
        { header: 'Pot', key: 'pot' },
        { header: 'Qté', key: 'qty' },
        { header: 'Cramés', key: 'burned' },
        { header: 'Seaux utilisés', key: 'buckets' },
        { header: 'Pâte utilisée (kg)', key: 'dough' },
        { header: 'Gâteaux enfournés', key: 'cakes' },
        { header: 'Pâtes (7,5 kg)', key: 'pates' },
        { header: 'Madeleines attendues', key: 'expected' },
        { header: 'Écart (%)', key: 'variance' },
        { header: 'Bonnes', key: 'good' },
        { header: 'Cramées', key: 'madBurned' },
        { header: 'Cassées', key: 'madBroken' },
        { header: 'Défectueuses', key: 'defective' },
      ],
      rows: filtered.map((r) => ({
        date: new Date(r.production_date).toLocaleDateString('fr-FR'),
        baker: r.baker?.full_name ?? '—',
        pot: r.pot_type?.name ?? '—',
        qty: r.quantity,
        burned: r.pots_burned ?? 0,
        buckets: r.buckets_used ?? '—',
        dough: r.dough_used_kg ? Number(r.dough_used_kg).toFixed(2) : '—',
        cakes: r.cakes_baked ?? 0,
        pates: r.pates_count ?? '—',
        expected: r.expected_madeleines ?? '—',
        variance: r.madeleine_variance != null ? `${Number(r.madeleine_variance) > 0 ? '+' : ''}${Number(r.madeleine_variance).toFixed(1)}%` : '—',
        good: r.madeleines_good,
        madBurned: r.madeleines_burned,
        madBroken: r.madeleines_broken ?? 0,
        defective: r.madeleines_defective,
      })),
      summary: [
        { label: 'Total pots', value: String(filtered.reduce((s, r) => s + r.quantity, 0)) },
        { label: 'Total pots cramés', value: String(filtered.reduce((s, r) => s + (r.pots_burned ?? 0), 0)) },
        { label: 'Total seaux utilisés', value: String(filtered.reduce((s, r) => s + (r.buckets_used ?? 0), 0)) },
        { label: 'Total pâte utilisée (kg)', value: filtered.reduce((s, r) => s + Number(r.dough_used_kg ?? 0), 0).toFixed(2) },
        { label: 'Total gâteaux enfournés', value: String(filtered.reduce((s, r) => s + (r.cakes_baked ?? 0), 0)) },
        { label: 'Total pâtes utilisées', value: String(filtered.reduce((s, r) => s + (r.pates_count ?? 0), 0)) },
        { label: 'Écarts de conformité', value: String(filtered.filter((r) => r.madeleine_variance != null && Math.abs(Number(r.madeleine_variance)) > MADELEINE_VARIANCE_TOLERANCE_PCT).length) },
      ],
      fileName: 'rapport_production',
    });
  };

  const deleteBaker = async (baker: Baker) => {
    if (!(await confirmDialog({ message: `Demande de suppression du pétrisseur ${baker.full_name} ? Cette demande devra être approuvée par la Directrice générale et le Directeur général adjoint.`, confirmLabel: 'Demander la suppression', danger: true }))) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('personnel_change_requests').insert({
      entity_type: 'baker',
      action_type: 'delete',
      entity_id: baker.id,
      payload: { full_name: baker.full_name },
      requested_by: userId,
    });
    loadAll();
  };

  const deleteKneader = async (kneader: Kneader) => {
    if (!(await confirmDialog({ message: `Demande de suppression du fournier ${kneader.full_name} ? Cette demande devra être approuvée par la Directrice générale et le Directeur général adjoint.`, confirmLabel: 'Demander la suppression', danger: true }))) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('personnel_change_requests').insert({
      entity_type: 'kneader',
      action_type: 'delete',
      entity_id: kneader.id,
      payload: { full_name: kneader.full_name },
      requested_by: userId,
    });
    loadAll();
  };

  const approvePersonnelReq = async (req: PersonnelChangeRequest & { requester?: { full_name: string } }, entityType: 'baker' | 'kneader') => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (isDirectrice || isAdmin) { updates.directrice_approved_by = userId; updates.directrice_approved_at = new Date().toISOString(); }
    if (isAdjoint || isAdmin) { updates.adjoint_approved_by = userId; updates.adjoint_approved_at = new Date().toISOString(); }
    const hasD = isDirectrice || isAdmin || !!req.directrice_approved_by;
    const hasA = isAdjoint || isAdmin || !!req.adjoint_approved_by;
    if (hasD && hasA) updates.status = 'validee';
    const { error: updErr } = await supabase.from('personnel_change_requests').update(updates).eq('id', req.id);
    if (updErr) { toast('Erreur lors de l approbation.', 'error'); return; }
    if (hasD && hasA) {
      const table = entityType === 'baker' ? 'bakers' : 'kneaders';
      if (req.action_type === 'delete') {
        const { error } = await supabase.from(table).delete().eq('id', req.entity_id!);
        if (error) { toast('Erreur lors de la suppression.', 'error'); return; }
      } else {
        const payload = { ...req.payload } as Record<string, unknown>;
        delete payload['id'];
        if (req.action_type === 'create') {
          const { error } = await supabase.from(table).insert(payload);
          if (error) { toast('Erreur lors de la création.', 'error'); return; }
        } else {
          const { error } = await supabase.from(table).update(payload).eq('id', req.entity_id!);
          if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
        }
      }
      const { error: applyErr } = await supabase.from('personnel_change_requests').update({ applied: true, updated_at: new Date().toISOString() }).eq('id', req.id);
      if (applyErr) { toast('Erreur lors de la finalisation.', 'error'); return; }
    }
    loadAll();
  };

  const rejectPersonnelReq = async (req: PersonnelChangeRequest) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('personnel_change_requests').update({
      status: 'rejetee', rejected_by: userId, rejected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    if (error) { toast('Erreur lors du rejet.', 'error'); return; }
    loadAll();
  };

  const renderPendingReqs = (reqs: (PersonnelChangeRequest & { requester?: { full_name: string } })[]) => {
    if (reqs.length === 0) return null;
    const ACTION_ICONS: Record<string, typeof UserPlus> = { create: UserPlus, update: UserCog, delete: UserMinus };
    const ACTION_LABELS: Record<string, string> = { create: 'Création', update: 'Modification', delete: 'Suppression' };
    const ACTION_COLORS: Record<string, string> = { create: 'bg-emerald-100 text-emerald-700', update: 'bg-amber-100 text-amber-700', delete: 'bg-red-100 text-red-700' };
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4" /> Demandes en attente d'approbation ({reqs.length})
        </h3>
        <div className="space-y-2">
          {reqs.map((req) => {
            const ActIcon = ACTION_ICONS[req.action_type];
            const canAppD = (isDirectrice || isAdmin) && !req.directrice_approved_by;
            const canAppA = (isAdjoint || isAdmin) && !req.adjoint_approved_by;
            return (
              <div key={req.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ACTION_COLORS[req.action_type]}`}>
                  <ActIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{ACTION_LABELS[req.action_type]} — {String(req.payload.full_name ?? '—')}</p>
                  <p className="text-xs text-gray-500">Par {req.requester?.full_name ?? '—'} · {new Date(req.created_at).toLocaleString('fr-FR')}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className={req.directrice_approved_by ? 'text-emerald-600' : 'text-gray-400'}>{req.directrice_approved_by ? '✓ Directrice générale' : '○ Directrice générale'}</span>
                    <span className={req.adjoint_approved_by ? 'text-emerald-600' : 'text-gray-400'}>{req.adjoint_approved_by ? '✓ Dir. adjoint' : '○ Dir. adjoint'}</span>
                  </div>
                </div>
                {(canAppD || canAppA) && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => approvePersonnelReq(req, req.entity_type as 'baker' | 'kneader')} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                    <button onClick={() => rejectPersonnelReq(req)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"><XCircle className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const deleteRecord = async (id: string) => {
    if (!(await confirmDialog({ message: 'Supprimer cet enregistrement ?', confirmLabel: 'Supprimer', danger: true }))) return;
    await supabase.from('production_records').delete().eq('id', id);
    loadAll();
  };

  const deleteDough = async (id: string) => {
    if (!(await confirmDialog({ message: 'Supprimer cette livraison de pâte ?', confirmLabel: 'Supprimer', danger: true }))) return;
    await supabase.from('dough_deliveries').delete().eq('id', id);
    loadAll();
  };

  const todayStr = brazzavilleToday();
  const todayRecords = records.filter((r) => r.production_date === todayStr && (filterBaker === 'all' || r.baker_id === filterBaker));
  const todayPots = todayRecords.reduce((s, r) => s + r.quantity, 0);
  const todayPotsBurned = todayRecords.reduce((s, r) => s + (r.pots_burned ?? 0), 0);
  const todayGood = todayRecords.reduce((s, r) => s + r.madeleines_good, 0);
  const todayBurned = todayRecords.reduce((s, r) => s + r.madeleines_burned, 0);
  const todayBroken = todayRecords.reduce((s, r) => s + (r.madeleines_broken ?? 0), 0);
  const todayDefective = todayRecords.reduce((s, r) => s + r.madeleines_defective, 0);
  const todayPates = todayRecords.reduce((s, r) => s + (r.pates_count ?? 0), 0);
  const todayComplianceIssues = todayRecords.filter((r) => r.madeleine_variance != null && Math.abs(Number(r.madeleine_variance)) > MADELEINE_VARIANCE_TOLERANCE_PCT).length;
  const todayDough = doughDeliveries.filter((d) => d.delivery_date === todayStr && (filterKneader === 'all' || d.kneader_id === filterKneader));
  const todayBuckets = todayDough.reduce((s, d) => s + d.bucket_count, 0);
  const todayDoughWeight = todayDough.reduce((s, d) => s + Number(d.total_weight_kg), 0);

  // Dough deliveries available for the selected baker in the record form
  const availableDoughForBaker = (bakerId: string) =>
    doughDeliveries.filter((d) => d.baker_id === bakerId);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'records', label: 'Productions', show: canManage && !isKneader },
    { id: 'dough', label: 'Livraisons de pâte', show: canManage },
    { id: 'bakers', label: 'Pétrisseurs', show: canManageBakers },
    { id: 'kneaders', label: 'Fournier', show: canManageBakers },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl flex-wrap">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Per-tab filters */}
        <div className="flex gap-2 flex-wrap items-center">
          {tab === 'records' && (
            <select value={filterBaker} onChange={(e) => setFilterBaker(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterBaker !== 'all' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-gray-200 text-gray-600'}`}>
              <option value="all">Tous les pétrisseurs</option>
              {bakers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
            </select>
          )}
          {tab === 'dough' && (
            <select value={filterKneader} onChange={(e) => setFilterKneader(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterKneader !== 'all' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-gray-200 text-gray-600'}`}>
              <option value="all">Tous les fourniers</option>
              {kneaders.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
            </select>
          )}
        </div>

        <div className="mobile-action-stack flex gap-2 items-center sm:w-auto sm:flex-row">
          {tab === 'records' && records.length > 0 && (
            <div className="relative">
              <button onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-all">
                <Download className="w-4 h-4" />
                Exporter
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-20 py-1 min-w-[180px]">
                    <button onClick={() => { handleExportPdf(); setShowExportMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-amber-50 flex items-center gap-2">
                      <Download className="w-4 h-4 text-amber-600" /> PDF
                    </button>
                    <button onClick={() => { handleExportExcel(); setShowExportMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-emerald-50 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {canCreateRecord && tab === 'records' && (
            <button onClick={() => setShowRecordModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <Plus className="w-5 h-5" />
              {ispétrisseur ? 'Enregistrer ma production' : 'Nouvelle production'}
            </button>
          )}
        </div>
        {canManage && tab === 'dough' && (
          <button onClick={() => setShowDoughModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            {isKneader ? 'Enregistrer ma livraison' : 'Nouvelle livraison'}
          </button>
        )}
        {canManageBakers && tab === 'bakers' && (
          <button onClick={async () => {
            setEditingBaker(null);
            setBakerForm({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
            await fetchProfiles(9);
            setShowBakerModal(true);
          }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            Nouveau fournier
          </button>
        )}
        {canManageBakers && tab === 'kneaders' && (
          <button onClick={async () => {
            setEditingKneader(null);
            setKneaderForm({ full_name: '', phone: '', status: 'actif', notes: '', profile_id: '' });
            await fetchProfiles(8);
            setShowKneaderModal(true);
          }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            Nouveau pétrisseur
          </button>
        )}
      </div>

      {/* Cross-links */}
      <div className="mobile-action-stack flex gap-2 sm:w-auto sm:flex-row">
        <button onClick={() => onNavigate?.('stock')}
          className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4" /> Voir stock
        </button>
        <button onClick={() => onNavigate?.('ingredients')}
          className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4" /> Voir intrants
        </button>
      </div>

      {ispétrisseur && !myBaker && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Votre compte n'est pas encore lié à un profil de pétrisseur. Contactez un responsable pour qu'il vous associe afin d'enregistrer votre production personnellement.
        </div>
      )}
      {isKneader && !myKneader && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          Votre compte n'est pas encore lié à un profil de fournier. Contactez un responsable pour qu'il vous associe afin d'enregistrer vos livraisons de pâte personnellement.
        </div>
      )}

      {/* Stats for records tab */}
      {tab === 'records' && (
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-7 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pots du jour</p>
              <p className="text-xl font-bold text-gray-900">{todayPots}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center">
              <Flame className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pots cramés</p>
              <p className="text-xl font-bold text-red-700">{todayPotsBurned}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Madeleines bonnes</p>
              <p className="text-xl font-bold text-emerald-700">{todayGood}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center">
              <Flame className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Madeleines cramées</p>
              <p className="text-xl font-bold text-red-700">{todayBurned}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center">
              <PackageX className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Madeleines cassées</p>
              <p className="text-xl font-bold text-amber-700">{todayBroken}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Mauvais état</p>
              <p className="text-xl font-bold text-orange-700">{todayDefective}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pâtes du jour</p>
              <p className="text-xl font-bold text-gray-900">{todayPates}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Écarts conformité</p>
              <p className="text-xl font-bold text-red-700">{todayComplianceIssues}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats for dough tab */}
      {tab === 'dough' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
              <Beaker className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Seaux du jour</p>
              <p className="text-xl font-bold text-gray-900">{todayBuckets}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
              <Scale className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pâte du jour (kg)</p>
              <p className="text-xl font-bold text-gray-900">{todayDoughWeight.toFixed(2)}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Livraisons du jour</p>
              <p className="text-xl font-bold text-gray-900">{todayDough.length}</p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les données de production.</p>
        </div>
      ) : tab === 'records' ? (
        records.length === 0 ? (
          <div className="text-center py-20 text-gray-400">Aucune production enregistrée</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {records.filter((r) => filterBaker === 'all' || r.baker_id === filterBaker).map((rec) => (
              <div key={rec.id} className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <ChefHat className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">{rec.baker?.full_name ?? '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-0.5">
                    <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {rec.pot_type?.name ?? '—'} · {rec.quantity} pots</span>
                    {(rec.pots_burned ?? 0) > 0 && <span className="flex items-center gap-1 text-red-600"><Flame className="w-3.5 h-3.5" /> {rec.pots_burned} pots cramés</span>}
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {new Date(rec.production_date).toLocaleDateString('fr-FR')}</span>
                    {rec.dough_delivery && (
                      <span className="flex items-center gap-1 text-blue-600"><Beaker className="w-3.5 h-3.5" /> Reçu: {rec.dough_delivery.bucket_count} seaux · {Number(rec.dough_delivery.total_weight_kg).toFixed(2)} kg</span>
                    )}
                    {rec.buckets_used != null && rec.buckets_used > 0 && (
                      <span className="flex items-center gap-1 text-blue-700"><Droplets className="w-3.5 h-3.5" /> Utilisé: {rec.buckets_used} seaux · {Number(rec.dough_used_kg ?? 0).toFixed(2)} kg</span>
                    )}
                    {rec.cakes_baked > 0 && (
                      <span className="flex items-center gap-1 text-amber-700"><Cake className="w-3.5 h-3.5" /> {rec.cakes_baked} gâteaux enfournés</span>
                    )}
                    {rec.pates_count != null && rec.pates_count > 0 && (
                      <span className="flex items-center gap-1 text-purple-600"><FlaskConical className="w-3.5 h-3.5" /> {rec.pates_count} pâte(s) · {rec.expected_madeleines ?? '—'} madeleines attendues</span>
                    )}
                    {rec.madeleine_variance != null && (
                      <span className={`flex items-center gap-1 font-medium ${Math.abs(Number(rec.madeleine_variance)) > MADELEINE_VARIANCE_TOLERANCE_PCT ? 'text-red-600' : 'text-emerald-600'}`}>
                        <AlertTriangle className="w-3.5 h-3.5" /> Écart: {Number(rec.madeleine_variance) > 0 ? '+' : ''}{Number(rec.madeleine_variance).toFixed(1)}%
                      </span>
                    )}
                    {rec.madeleines_good > 0 && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {rec.madeleines_good} bonnes</span>}
                    {rec.madeleines_burned > 0 && <span className="flex items-center gap-1 text-red-600"><Flame className="w-3.5 h-3.5" /> {rec.madeleines_burned} cramées</span>}
                    {(rec.madeleines_broken ?? 0) > 0 && <span className="flex items-center gap-1 text-amber-700"><PackageX className="w-3.5 h-3.5" /> {rec.madeleines_broken} cassées</span>}
                    {rec.madeleines_defective > 0 && <span className="flex items-center gap-1 text-orange-600"><AlertTriangle className="w-3.5 h-3.5" /> {rec.madeleines_defective} mauvais état</span>}
                    {rec.notes && <span className="text-gray-400">· {rec.notes}</span>}
                  </div>
                </div>
                {canManageBakers && (
                  <button onClick={() => deleteRecord(rec.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === 'dough' ? (
          doughDeliveries.length === 0 ? (
            <div className="text-center py-20 text-gray-400">Aucune livraison de pâte enregistrée</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
              {doughDeliveries.filter((d) => filterKneader === 'all' || d.kneader_id === filterKneader).map((d) => (
                <div key={d.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                    <Beaker className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{d.kneader?.full_name ?? '—'} → {d.baker?.full_name ?? '—'}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-0.5">
                      <span className="flex items-center gap-1"><Beaker className="w-3.5 h-3.5" /> {d.bucket_count} seaux</span>
                      <span className="flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> {Number(d.bucket_weight_kg).toFixed(2)} kg/seau</span>
                      <span className="flex items-center gap-1 font-medium text-blue-700"><Droplets className="w-3.5 h-3.5" /> Total : {Number(d.total_weight_kg).toFixed(2)} kg</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {new Date(d.delivery_date).toLocaleDateString('fr-FR')}</span>
                      {d.notes && <span className="text-gray-400">· {d.notes}</span>}
                      {d.dough_batch_id && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                          <FlaskConical className="w-3 h-3" /> Fabrication liée
                        </span>
                      )}
                    </div>
                  </div>
                  {canManageBakers && (
                    <button onClick={() => deleteDough(d.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
      ) : tab === 'bakers' ? (
        <>
        {renderPendingReqs(pendingBakerReqs)}
        {bakers.length === 0 ? (
          <div className="text-center py-20 text-gray-400">Aucun pétrisseur enregistré</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bakers.map((baker) => (
              <div key={baker.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold">
                      {baker.full_name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{baker.full_name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${baker.status === 'actif' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {baker.status === 'actif' ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                  </div>
                  {canManageBakers && (
                    <div className="flex gap-1">
                      <button onClick={async () => {
                        setEditingBaker(baker);
                        setBakerForm({ full_name: baker.full_name, phone: baker.phone ?? '', status: baker.status, notes: baker.notes ?? '', profile_id: baker.profile_id ?? '' });
                        await fetchProfiles(9);
                        setShowBakerModal(true);
                      }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteBaker(baker)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 text-sm text-gray-600">
                  {baker.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {baker.phone}</div>}
                  {baker.profile_id && <div className="flex items-center gap-2 text-emerald-600"><UserIcon className="w-4 h-4" /> Compte lié</div>}
                  {baker.notes && <p className="text-xs text-gray-400 italic">{baker.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      ) : tab === 'kneaders' ? (
        <>
        {renderPendingReqs(pendingKneaderReqs)}
        {kneaders.length === 0 ? (
          <div className="text-center py-20 text-gray-400">Aucun fournier enregistré</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {kneaders.map((kneader) => (
              <div key={kneader.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
                      {kneader.full_name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{kneader.full_name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${kneader.status === 'actif' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {kneader.status === 'actif' ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                  </div>
                  {canManageBakers && (
                    <div className="flex gap-1">
                      <button onClick={async () => {
                        setEditingKneader(kneader);
                        setKneaderForm({ full_name: kneader.full_name, phone: kneader.phone ?? '', status: kneader.status, notes: kneader.notes ?? '', profile_id: kneader.profile_id ?? '' });
                        await fetchProfiles(8);
                        setShowKneaderModal(true);
                      }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteKneader(kneader)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 text-sm text-gray-600">
                  {kneader.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {kneader.phone}</div>}
                  {kneader.profile_id && <div className="flex items-center gap-2 text-emerald-600"><UserIcon className="w-4 h-4" /> Compte lié</div>}
                  {kneader.notes && <p className="text-xs text-gray-400 italic">{kneader.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      ) : null}

      {/* Baker modal */}
      {showBakerModal && (
        <Modal title={editingBaker ? 'Modifier le pétrisseur' : 'Nouveau pétrisseur'} onClose={() => setShowBakerModal(false)}>
          <form onSubmit={handleBakerSubmit} className="space-y-3">
            <FormField label="Nom complet" required>
              <input required value={bakerForm.full_name} onChange={(e) => setBakerForm({ ...bakerForm, full_name: e.target.value })}
                className={inputCls} />
            </FormField>
            <FormField label="Téléphone">
              <input value={bakerForm.phone} onChange={(e) => setBakerForm({ ...bakerForm, phone: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Statut">
              <select value={bakerForm.status} onChange={(e) => setBakerForm({ ...bakerForm, status: e.target.value })} className={inputCls}>
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
              </select>
            </FormField>
            <FormField label="Notes">
              <input value={bakerForm.notes} onChange={(e) => setBakerForm({ ...bakerForm, notes: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Compte pétrisseur (optionnel)">
              <select value={bakerForm.profile_id} onChange={(e) => setBakerForm({ ...bakerForm, profile_id: e.target.value })} className={inputCls}>
                <option value="">— Aucun —</option>
                {linkableProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">Permet au pétrisseur d'enregistrer sa production lui-même.</p>
            </FormField>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              Cette demande sera soumise pour approbation à la Directrice générale et au Directeur général adjoint.
            </div>
            <SubmitBtn label={editingBaker ? 'Soumettre la demande' : 'Soumettre la demande'} />
          </form>
        </Modal>
      )}

      {/* Kneader modal */}
      {showKneaderModal && (
        <Modal title={editingKneader ? 'Modifier le fournier' : 'Nouveau fournier'} onClose={() => setShowKneaderModal(false)}>
          <form onSubmit={handleKneaderSubmit} className="space-y-3">
            <FormField label="Nom complet" required>
              <input required value={kneaderForm.full_name} onChange={(e) => setKneaderForm({ ...kneaderForm, full_name: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Téléphone">
              <input value={kneaderForm.phone} onChange={(e) => setKneaderForm({ ...kneaderForm, phone: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Statut">
              <select value={kneaderForm.status} onChange={(e) => setKneaderForm({ ...kneaderForm, status: e.target.value })} className={inputCls}>
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
              </select>
            </FormField>
            <FormField label="Notes">
              <input value={kneaderForm.notes} onChange={(e) => setKneaderForm({ ...kneaderForm, notes: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Compte fournier (optionnel)">
              <select value={kneaderForm.profile_id} onChange={(e) => setKneaderForm({ ...kneaderForm, profile_id: e.target.value })} className={inputCls}>
                <option value="">— Aucun —</option>
                {linkableProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">Permet au fournier d'enregistrer ses livraisons de pâte lui-même.</p>
            </FormField>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              Cette demande sera soumise pour approbation à la Directrice générale et au Directeur général adjoint.
            </div>
            <SubmitBtn label={editingKneader ? 'Soumettre la demande' : 'Soumettre la demande'} />
          </form>
        </Modal>
      )}

      {/* Dough delivery modal */}
      {showDoughModal && (
        <Modal title={isKneader ? 'Enregistrer ma livraison de pâte' : 'Nouvelle livraison de pâte'} onClose={() => setShowDoughModal(false)}>
          <form onSubmit={handleDoughSubmit} className="space-y-3">
            {isKneader && myKneader ? (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-sm text-blue-800">
                Livraison enregistrée pour : <strong>{myKneader.full_name}</strong>
              </div>
            ) : (
              <FormField label="Fournier" required>
                <select required value={doughForm.kneader_id} onChange={(e) => setDoughForm({ ...doughForm, kneader_id: e.target.value })} className={inputCls}>
                  <option value="">— Choisir —</option>
                  {kneaders.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
                </select>
              </FormField>
            )}
            <FormField label="Pétrisseur" required>
              <select required value={doughForm.baker_id} onChange={(e) => setDoughForm({ ...doughForm, baker_id: e.target.value })} className={inputCls}>
                <option value="">— Choisir —</option>
                {bakers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Nombre de seaux" required>
                <input type="number" min={1} required value={doughForm.bucket_count || ''} onChange={(e) => setDoughForm({ ...doughForm, bucket_count: Number(e.target.value) })}
                  className={inputCls} />
              </FormField>
              <FormField label="Poids par seau (kg)" required>
                <input type="number" min={0.01} step={0.01} required value={doughForm.bucket_weight_kg || ''} onChange={(e) => setDoughForm({ ...doughForm, bucket_weight_kg: Number(e.target.value) })}
                  className={inputCls} />
              </FormField>
            </div>
            <FormField label="Date de livraison" required>
              <input type="date" required value={doughForm.delivery_date} onChange={(e) => setDoughForm({ ...doughForm, delivery_date: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Fabrication de pâte liée">
              <select value={doughForm.dough_batch_id} onChange={(e) => {
                const batchId = e.target.value;
                const batch = doughBatches.find((b) => b.id === batchId);
                setDoughForm({
                  ...doughForm,
                  dough_batch_id: batchId,
                  kneader_id: batch?.kneader_id ?? doughForm.kneader_id,
                  bucket_weight_kg: batch?.total_weight_kg ? Number(batch.total_weight_kg) : doughForm.bucket_weight_kg,
                });
              }} className={inputCls}>
                <option value="">— Aucune —</option>
                {doughBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Date(b.batch_date).toLocaleDateString('fr-FR')} · {b.total_weight_kg ?? '?'} kg · {b.kneader?.full_name ?? '—'} ({(b.ingredients ?? []).length} intrants)
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Liez cette livraison à une fabrication de pâte pour tracer les coûts.</p>
            </FormField>
            <FormField label="Notes">
              <input value={doughForm.notes} onChange={(e) => setDoughForm({ ...doughForm, notes: e.target.value })} className={inputCls} />
            </FormField>
            {doughForm.bucket_count > 0 && doughForm.bucket_weight_kg > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-sm text-blue-800 flex items-center gap-2">
                <Droplets className="w-4 h-4" />
                Poids total : <strong>{(doughForm.bucket_count * doughForm.bucket_weight_kg).toFixed(2)} kg</strong>
              </div>
            )}
            <SubmitBtn label="Enregistrer la livraison" />
          </form>
        </Modal>
      )}

      {/* Record modal */}
      {showRecordModal && (
        <Modal title={ispétrisseur ? 'Enregistrer ma production' : 'Nouvelle production'} onClose={() => setShowRecordModal(false)} wide>
          <form onSubmit={handleRecordSubmit} className="space-y-4">
            {!ispétrisseur && (
              <FormField label="Pétrisseur" required>
                <select required value={recordForm.baker_id}
                  onChange={(e) => setRecordForm({ ...recordForm, baker_id: e.target.value, dough_delivery_id: '' })}
                  className={inputCls}>
                  <option value="">— Choisir —</option>
                  {bakers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
                </select>
              </FormField>
            )}
            {ispétrisseur && myBaker && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm text-amber-800">
                Production enregistrée pour : <strong>{myBaker.full_name}</strong>
              </div>
            )}

            {/* Dough delivery selector */}
            {(() => {
              const bakerId = ispétrisseur && myBaker ? myBaker.id : recordForm.baker_id;
              const options = bakerId ? availableDoughForBaker(bakerId) : [];
              if (!bakerId) return null;
              return (
                <FormField label="Livraison de pâte reçue">
                  <select value={recordForm.dough_delivery_id} onChange={(e) => setRecordForm({ ...recordForm, dough_delivery_id: e.target.value })} className={inputCls}>
                    <option value="">— Aucune —</option>
                    {options.map((d) => (
                      <option key={d.id} value={d.id}>
                        {new Date(d.delivery_date).toLocaleDateString('fr-FR')} · {d.bucket_count} seaux · {Number(d.total_weight_kg).toFixed(2)} kg ({d.kneader?.full_name ?? '—'})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">Sélectionnez la livraison de pâte reçue par ce pétrisseur.</p>
                </FormField>
              );
            })()}

            <FormField label="Type de pot" required>
              <select required value={recordForm.pot_type_id} onChange={(e) => setRecordForm({ ...recordForm, pot_type_id: e.target.value })} className={inputCls}>
                <option value="">— Choisir —</option>
                {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Quantité (pots)">
                <input type="number" min={0} value={recordForm.quantity || ''} onChange={(e) => setRecordForm({ ...recordForm, quantity: Number(e.target.value) })}
                  placeholder="0" className={inputCls} />
              </FormField>
              <FormField label="Pots cramés">
                <input type="number" min={0} value={recordForm.pots_burned || ''} onChange={(e) => setRecordForm({ ...recordForm, pots_burned: Number(e.target.value) })}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-xl border border-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none" />
              </FormField>
              <FormField label="Date" required>
                <input type="date" required value={recordForm.production_date} onChange={(e) => setRecordForm({ ...recordForm, production_date: e.target.value })} className={inputCls} />
              </FormField>
            </div>

            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-semibold text-gray-700 mb-2">Détail des madeleines</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-emerald-700 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Bonnes</label>
                  <input type="number" min={0} value={recordForm.madeleines_good || ''} onChange={(e) => setRecordForm({ ...recordForm, madeleines_good: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-emerald-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-red-700 mb-1 flex items-center gap-1"><Flame className="w-3.5 h-3.5" /> Cramées</label>
                  <input type="number" min={0} value={recordForm.madeleines_burned || ''} onChange={(e) => setRecordForm({ ...recordForm, madeleines_burned: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1 flex items-center gap-1"><PackageX className="w-3.5 h-3.5" /> Cassées</label>
                  <input type="number" min={0} value={recordForm.madeleines_broken || ''} onChange={(e) => setRecordForm({ ...recordForm, madeleines_broken: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-amber-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-orange-700 mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Mauvais état</label>
                  <input type="number" min={0} value={recordForm.madeleines_defective || ''} onChange={(e) => setRecordForm({ ...recordForm, madeleines_defective: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-orange-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
              </div>
            </div>

            {/* Dough usage tracking */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Droplets className="w-4 h-4 text-blue-600" /> Utilisation de la pâte</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1 flex items-center gap-1"><Beaker className="w-3.5 h-3.5" /> Seaux utilisés</label>
                  <input type="number" min={0} value={recordForm.buckets_used || ''}
                    onChange={(e) => {
                      const buckets = Number(e.target.value);
                      setRecordForm({ ...recordForm, buckets_used: buckets, dough_used_kg: Number((buckets * 12.4).toFixed(2)) });
                    }}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> Pâte utilisée (kg)</label>
                  <input type="number" min={0} step={0.01} value={recordForm.dough_used_kg || ''}
                    onChange={(e) => setRecordForm({ ...recordForm, dough_used_kg: Number(e.target.value) })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1 flex items-center gap-1"><Cake className="w-3.5 h-3.5" /> Gâteaux enfournés</label>
                  <input type="number" min={0} value={recordForm.cakes_baked || ''}
                    onChange={(e) => setRecordForm({ ...recordForm, cakes_baked: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-amber-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-400">Un seau plein = 12,8 kg, seau vide = 0,4 kg → pâte nette = 12,4 kg/seau. Le poids de pâte se calcule automatiquement.</p>
            </div>

            {/* Pâte count and madeleine compliance */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-purple-600" /> Pâtes et conformité madeleines</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-purple-700 mb-1 flex items-center gap-1"><FlaskConical className="w-3.5 h-3.5" /> Nombre de pâtes (7,5 kg chacune)</label>
                  <input type="number" min={0} value={recordForm.pates_count || ''}
                    onChange={(e) => setRecordForm({ ...recordForm, pates_count: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-purple-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none" />
                </div>
              </div>
              {recordForm.pates_count > 0 && (() => {
                const expected = recordForm.pates_count * MADELEINES_PER_PATE;
                const actual = recordForm.madeleines_good + recordForm.madeleines_burned + recordForm.madeleines_broken + recordForm.madeleines_defective;
                const variancePct = expected > 0 ? ((actual - expected) / expected) * 100 : 0;
                const isOutOfNorm = Math.abs(variancePct) > MADELEINE_VARIANCE_TOLERANCE_PCT;
                return (
                  <div className={`mt-2 border rounded-xl px-3 py-2 text-sm flex items-center justify-between ${isOutOfNorm ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                    <span>Norme: <strong>{expected}</strong> madeleines attendues ({recordForm.pates_count} pâte(s) × {MADELEINES_PER_PATE})</span>
                    {actual > 0 && (
                      <span className="font-medium">
                        Réel: {actual} ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%) {isOutOfNorm ? '⚠ Hors norme' : '✓ Conforme'}
                      </span>
                    )}
                  </div>
                );
              })()}
              <p className="mt-1.5 text-xs text-gray-400">1 pâte = 7,5 kg = 471 madeleines. Tolérance ±5%. Un écart génère une alerte de conformité au DGA et à la Directrice générale.</p>
            </div>

            <FormField label="Notes">
              <input value={recordForm.notes} onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })} className={inputCls} />
            </FormField>
            <SubmitBtn label="Enregistrer la production" />
          </form>
        </Modal>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl p-6 ${wide ? 'max-w-lg' : 'max-w-md'} w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}

function SubmitBtn({ label }: { label: string }) {
  return (
    <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
      {label}
    </button>
  );
}
