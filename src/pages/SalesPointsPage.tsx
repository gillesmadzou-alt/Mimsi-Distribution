import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, SalesPoint, QuotaPayment, formatFCFA, Driver } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { cachePageData, clearPageCache } from '@/lib/readCache';
import { useOfflineSave, buildSteps } from '@/lib/useOfflineSave';
import { mergePendingSalesPoints } from '@/lib/offlineSalesPoints';
import { getBrazzavilleArrondissementOptions, sameArrondissement } from '@/lib/locationReferences';
import {
  Plus, Search, MapPin, Phone, User as UserIcon, X, Edit2, Trash2, Store,
  Mail, Wallet, CheckCircle2, Clock, AlertCircle, PlusCircle, History, Crosshair,
  ArrowRight, CloudOff,
} from 'lucide-react';
import GeoPickerModal from '@/components/GeoPickerModal';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const UNASSIGNED_DRIVER_FILTER = '__unassigned__';

const QUOTA_STATUS_CONFIG: Record<string, { label: string; style: string; Icon: typeof Clock }> = {
  non_paye: { label: 'Non payé',   style: 'bg-red-50 text-red-700',       Icon: AlertCircle },
  partiel:  { label: 'Partiel',    style: 'bg-amber-50 text-amber-700',   Icon: Clock },
  paye:     { label: 'Payé',       style: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement',
  autre: 'Autre',
};

const CLIENT_TYPE_LABELS: Record<SalesPoint['client_type'], string> = {
  detail: 'Détaillant',
  grossiste: 'Grossiste',
  boutique: 'Boutique',
  kiosque: 'Kiosque',
  mobile_money: 'Point Mobile Money',
  supermarche: 'Supermarché',
  restaurant_hotel: 'Restaurant / hôtel',
  entreprise: 'Entreprise',
  autre: 'Autre',
};

export default function SalesPointsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [points, setPoints] = useState<SalesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterNew, setFilterNew] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterArrond, setFilterArrond] = useState('');
  const [filterDriver, setFilterDriver] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showGeoPicker, setShowGeoPicker] = useState(false);
  const [editing, setEditing] = useState<SalesPoint | null>(null);
  const [form, setForm] = useState({
    name: '', address: '', district: '', zone: '',
    arrondissements: [] as string[], arrondissementInput: '',
    owner_full_name: '', client_type: 'detail' as SalesPoint['client_type'], client_type_other: '', owner_phone: '', owner_phone_secondary: '', owner_email: '',
    delivery_days: [] as string[], gps_lat: '', gps_lng: '',
    is_active: true, is_new: true, quota_amount: '4000',
    driver_id: '' as string,
  });

  const [geoTargetPoint, setGeoTargetPoint] = useState<SalesPoint | null>(null);
  const [zoneTargetPoint, setZoneTargetPoint] = useState<SalesPoint | null>(null);
  const [zoneInput, setZoneInput] = useState('');
  const [quotaPoint, setQuotaPoint] = useState<SalesPoint | null>(null);
  const [quotaPayments, setQuotaPayments] = useState<QuotaPayment[]>([]);
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'especes', receipt_number: '', notes: '' });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deletingPointId, setDeletingPointId] = useState<string | null>(null);

  // La gestion du réseau de points de vente fait partie du périmètre de la
  // gestion de stock. Le rôle 16 est l'assistant et bénéficie du même accès
  // opérationnel que le rôle 2, sans obtenir les droits de suppression.
  const canEdit = [1, 2, 4, 5, 6, 7, 16].includes(profile?.role ?? 1);
  const canDelete = [1, 4, 5, 6, 7].includes(profile?.role ?? 1);
  const canAddPayment = (profile?.role ?? 1) >= 1;

  const { fetchWithCache, isOffline } = useOfflineFetch();
  const { save } = useOfflineSave();

  // A point of sale is used in several operational forms.  Clear only the
  // dependent snapshots after a successful mutation so the next online visit
  // always obtains the current list, without deleting unrelated offline data.
  const refreshPointOfSaleSnapshots = async () => {
    await Promise.all([
      'sales_points_page', 'sales_points_drivers', 'batches_page', 'consignments-page:v2', 'consignments-page:v3',
      'expenses_page', 'restock-page', 'returns-page-all', 'returns-page-all:v2', 'field_observations',
      'receivables', 'receivables:filters', 'reports-page', 'analytics-page',
    ].map((key) => clearPageCache(key)));
    window.dispatchEvent(new Event('mimsi:sales-points-updated'));
  };

  const loadDrivers = useCallback(async () => {
    const result = await fetchWithCache('sales_points_drivers', async () => {
      const { data, error } = await supabase.from('drivers').select('*').order('full_name');
      if (error) throw error;
      return data ?? [];
    });
    if (result.data) setDrivers(Array.isArray(result.data) ? result.data : []);
    else if (result.error) setLoadError('Erreur lors du chargement des commerciaux.');
  }, [fetchWithCache]);

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await fetchWithCache('sales_points_page', async () => {
      const { data, error } = await supabase.from('sales_points').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    });
    if (result.data) setPoints(await mergePendingSalesPoints(Array.isArray(result.data) ? result.data : []));
    else setLoadError(result.error ?? 'Erreur lors du chargement des points de vente.');
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadPoints(); loadDrivers(); }, [loadPoints, loadDrivers]);
  useRealtimeSubscription('sales-points-page', isOffline ? [] : ['sales_points', 'quota_payments'], loadPoints);

  const filtered = points.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      p.name.toLowerCase().includes(q) ||
      p.district.toLowerCase().includes(q) ||
      (p.owner_full_name ?? '').toLowerCase().includes(q) ||
      (p.owner_name ?? '').toLowerCase().includes(q) ||
      p.arrondissements.some((a) => a.toLowerCase().includes(q));
    const matchStatus = !filterStatus || p.quota_status === filterStatus;
    const matchNew = !filterNew || (filterNew === 'new' ? p.is_new : !p.is_new);
    const matchZone = !filterZone || p.zone === filterZone;
    const matchDriver = !filterDriver
      || (filterDriver === UNASSIGNED_DRIVER_FILTER ? !p.driver_id : p.driver_id === filterDriver);
    const pointArrondissements = [p.arrondissement, ...(p.arrondissements ?? [])];
    const matchArrond = !filterArrond || pointArrondissements.some((arrondissement) => sameArrondissement(arrondissement, filterArrond));
    return matchSearch && matchStatus && matchNew && matchZone && matchArrond && matchDriver;
  });

  const zones = useMemo(() => Array.from(new Set(points.map((p) => p.zone).filter(Boolean))).sort(), [points]);
  const driverNameById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver.full_name])), [drivers]);
  const arrondissements = useMemo(
    () => getBrazzavilleArrondissementOptions(points.flatMap((p) => [p.arrondissement, ...(p.arrondissements ?? [])])),
    [points],
  );

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '', address: '', district: '', zone: '',
      arrondissements: [], arrondissementInput: '',
      owner_full_name: '', client_type: 'detail', client_type_other: '', owner_phone: '', owner_phone_secondary: '', owner_email: '',
      delivery_days: [], gps_lat: '', gps_lng: '',
      is_active: true, is_new: true, quota_amount: '4000',
      driver_id: '',
    });
    setShowModal(true);
  };

  const openEdit = (point: SalesPoint) => {
    setEditing(point);
    setForm({
      name: point.name, address: point.address ?? '', district: point.district, zone: point.zone ?? '',
      arrondissements: point.arrondissements ?? [], arrondissementInput: '',
      owner_full_name: point.owner_full_name ?? point.owner_name ?? '',
      client_type: point.client_type ?? 'detail',
      client_type_other: point.client_type_other ?? '',
      owner_phone: point.owner_phone ?? '', owner_phone_secondary: point.owner_phone_secondary ?? '',
      owner_email: point.owner_email ?? '',
      delivery_days: point.delivery_days ?? [],
      gps_lat: point.gps_lat?.toString() ?? '', gps_lng: point.gps_lng?.toString() ?? '',
      is_active: point.is_active, is_new: point.is_new,
      quota_amount: point.quota_amount?.toString() ?? '4000',
      driver_id: point.driver_id ?? '',
    });
    setShowModal(true);
  };

  const toggleDay = (day: string) => {
    setForm((f) => ({
      ...f,
      delivery_days: f.delivery_days.includes(day)
        ? f.delivery_days.filter((d) => d !== day)
        : [...f.delivery_days, day],
    }));
  };

  const addArrondissement = () => {
    const val = form.arrondissementInput.trim();
    if (val && !form.arrondissements.includes(val)) {
      setForm((f) => ({ ...f, arrondissements: [...f.arrondissements, val], arrondissementInput: '' }));
    }
  };

  const removeArrondissement = (val: string) => {
    setForm((f) => ({ ...f, arrondissements: f.arrondissements.filter((a) => a !== val) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = profile?.id;
    const pointId = editing?.id ?? crypto.randomUUID();
    const payload = {
      ...(editing ? {} : { id: pointId }),
      name: form.name,
      address: form.address || null,
      district: form.district,
      zone: form.zone,
      arrondissements: form.arrondissements,
      owner_full_name: form.owner_full_name || null,
      client_type: form.client_type,
      client_type_other: form.client_type === 'autre' ? form.client_type_other.trim() : null,
      owner_phone: form.owner_phone || null,
      owner_phone_secondary: form.owner_phone_secondary || null,
      owner_email: form.owner_email || null,
      delivery_days: form.delivery_days,
      gps_lat: form.gps_lat ? Number(form.gps_lat) : null,
      gps_lng: form.gps_lng ? Number(form.gps_lng) : null,
      is_active: form.is_active,
      is_new: form.is_new,
      quota_amount: Number(form.quota_amount) || 4000,
      driver_id: form.driver_id || null,
      ...(userId ? { created_by: userId } : {}),
    };

    const steps = editing
      ? buildSteps().update('sales_points', payload, { column: 'id', value: editing.id }).getSteps()
      : buildSteps().insert('sales_points', payload, { id: `sales-point-${pointId}` }).getSteps();
    const result = await save(editing ? 'Mise à jour du point de vente' : 'Création du point de vente', 'sales-points', steps);
    if (!result.queued && result.error) { toast('Erreur lors de l’enregistrement du point de vente.', 'error'); return; }

    const localPoint: SalesPoint = {
      id: pointId,
      name: form.name,
      address: form.address || null,
      district: form.district,
      arrondissement: form.arrondissements[0] ?? null,
      arrondissements: form.arrondissements,
      zone: form.zone,
      owner_name: null,
      owner_full_name: form.owner_full_name || null,
      client_type: form.client_type,
      client_type_other: form.client_type === 'autre' ? form.client_type_other.trim() : null,
      owner_phone: form.owner_phone || null,
      owner_phone_secondary: form.owner_phone_secondary || null,
      owner_email: form.owner_email || null,
      delivery_days: form.delivery_days,
      photo_url: null,
      is_active: form.is_active,
      is_new: form.is_new,
      quota_amount: Number(form.quota_amount) || 4000,
      quota_paid: editing?.quota_paid ?? 0,
      quota_status: editing?.quota_status ?? 'non_paye',
      gps_lat: form.gps_lat ? Number(form.gps_lat) : null,
      gps_lng: form.gps_lng ? Number(form.gps_lng) : null,
      created_by: userId ?? null,
      driver_id: form.driver_id || null,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (result.queued) {
      const updatedPoints = editing
        ? points.map((point) => point.id === editing.id ? { ...point, ...localPoint } : point)
        : [...points, localPoint].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      setPoints(updatedPoints);
      await cachePageData('sales_points_page', updatedPoints);
      window.dispatchEvent(new Event('mimsi:sales-points-updated'));
      setShowModal(false);
      toast(editing
        ? 'Mise à jour enregistrée hors ligne. Elle sera synchronisée automatiquement.'
        : 'Point de vente créé hors ligne. Il sera synchronisé automatiquement dès le retour du réseau.', 'info');
      return;
    }
    await refreshPointOfSaleSnapshots();
    setShowModal(false);
    await loadPoints();
    toast(editing ? 'Point de vente mis à jour dans les formulaires.' : 'Point de vente créé et disponible dans les formulaires.', 'success');
  };

  const saveGeo = async (lat: number, lng: number) => {
    if (!geoTargetPoint) return;
    const { error } = await supabase.from('sales_points').update({ gps_lat: lat, gps_lng: lng }).eq('id', geoTargetPoint.id);
    if (error) { toast('Erreur lors de l enregistrement de la position.', 'error'); return; }
    await refreshPointOfSaleSnapshots();
    setGeoTargetPoint(null);
    loadPoints();
  };

  const openZoneEditor = (point: SalesPoint) => {
    setZoneTargetPoint(point);
    setZoneInput(point.zone ?? '');
  };

  const saveZone = async () => {
    if (!zoneTargetPoint) return;
    const { error } = await supabase.from('sales_points').update({ zone: zoneInput.trim() || null }).eq('id', zoneTargetPoint.id);
    if (error) { toast('Erreur lors de l enregistrement de la zone.', 'error'); return; }
    await refreshPointOfSaleSnapshots();
    setZoneTargetPoint(null);
    setZoneInput('');
    loadPoints();
  };

  const handleDelete = async (point: SalesPoint) => {
    if (isOffline || !navigator.onLine) {
      toast('La suppression d’un point de vente nécessite une connexion Internet.', 'error');
      return;
    }
    if (!(await confirmDialog({
      message: `Supprimer définitivement le point de vente « ${point.name} » ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer définitivement',
      danger: true,
    }))) return;

    setDeletingPointId(point.id);
    const { error } = await supabase.from('sales_points').delete().eq('id', point.id);
    if (error) {
      setDeletingPointId(null);
      if (error.code === '23503') {
        toast('Ce point possède déjà un historique de livraisons ou de retours. Désactivez-le au lieu de le supprimer.', 'error');
      } else {
        toast('Impossible de supprimer ce point de vente.', 'error');
      }
      return;
    }

    const updatedPoints = points.filter((item) => item.id !== point.id);
    setPoints(updatedPoints);
    await cachePageData('sales_points_page', updatedPoints);
    await refreshPointOfSaleSnapshots();
    setDeletingPointId(null);
    toast('Point de vente supprimé.', 'success');
  };

  const openQuota = async (point: SalesPoint) => {
    setQuotaPoint(point);
    setShowPaymentModal(true);
    setPaymentForm({ amount: '', payment_method: 'especes', receipt_number: '', notes: '' });
    const { data } = await supabase
      .from('quota_payments')
      .select('*')
      .eq('sales_point_id', point.id)
      .order('payment_date', { ascending: false });
    setQuotaPayments(data ?? []);
  };

  const submitPayment = async () => {
    if (!quotaPoint || !paymentForm.amount) return;
    await supabase.from('quota_payments').insert({
      sales_point_id: quotaPoint.id,
      amount_fcfa: Number(paymentForm.amount),
      payment_method: paymentForm.payment_method,
      receipt_number: paymentForm.receipt_number || null,
      notes: paymentForm.notes || null,
      collected_by: profile?.id,
    });
    setPaymentForm({ amount: '', payment_method: 'especes', receipt_number: '', notes: '' });
    const { data } = await supabase
      .from('quota_payments')
      .select('*')
      .eq('sales_point_id', quotaPoint.id)
      .order('payment_date', { ascending: false });
    setQuotaPayments(data ?? []);
    loadPoints();
  };

  const quotaStats = {
    total: points.length,
    newCount: points.filter((p) => p.is_new).length,
    oldCount: points.filter((p) => !p.is_new).length,
    paid: points.filter((p) => p.quota_status === 'paye').length,
    partial: points.filter((p) => p.quota_status === 'partiel').length,
    unpaid: points.filter((p) => p.quota_status === 'non_paye').length,
    totalCollected: points.reduce((s, p) => s + (p.quota_paid ?? 0), 0),
    totalDue: points.reduce((s, p) => s + (p.quota_amount ?? 4000), 0),
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Store className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total points</p>
              <p className="text-xl font-bold text-gray-900">{quotaStats.total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Cotisations payées</p>
              <p className="text-xl font-bold text-gray-900">{quotaStats.paid}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Partielles</p>
              <p className="text-xl font-bold text-gray-900">{quotaStats.partial}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Non payées</p>
              <p className="text-xl font-bold text-gray-900">{quotaStats.unpaid}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, quartier, propriétaire)…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
          />
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={filterZone} onChange={(e) => setFilterZone(e.target.value)} disabled={zones.length === 0}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterZone ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white border-gray-200 text-gray-600'}`}>
            <option value="">Toutes les zones</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={filterArrond} onChange={(e) => setFilterArrond(e.target.value)} disabled={arrondissements.length === 0}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterArrond ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white border-gray-200 text-gray-600'}`}>
            <option value="">Tous arrond.</option>
            {arrondissements.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterDriver} onChange={(e) => setFilterDriver(e.target.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border outline-none transition-all ${filterDriver ? 'bg-violet-500 text-white border-violet-500' : 'bg-white border-gray-200 text-gray-600'}`}>
            <option value="">Tous les commerciaux</option>
            <option value={UNASSIGNED_DRIVER_FILTER}>Sans commercial</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
          </select>
          <div className="w-px bg-gray-200 mx-1" />
          <button onClick={() => setFilterNew('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterNew ? 'bg-gray-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Tous
          </button>
          <button onClick={() => setFilterNew('new')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterNew === 'new' ? 'bg-blue-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Nouveaux ({quotaStats.newCount})
          </button>
          <button onClick={() => setFilterNew('old')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterNew === 'old' ? 'bg-gray-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Anciens ({quotaStats.oldCount})
          </button>
          <div className="w-px bg-gray-200 mx-1" />
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterStatus ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Cotisation: toutes
          </button>
          <button onClick={() => setFilterStatus('non_paye')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === 'non_paye' ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Non payées
          </button>
          <button onClick={() => setFilterStatus('partiel')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === 'partiel' ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Partielles
          </button>
          <button onClick={() => setFilterStatus('paye')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === 'paye' ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Payées
          </button>
        </div>
        {canEdit && (
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all shrink-0">
            <Plus className="w-5 h-5" />
            Nouveau point
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && points.length === 0 ? (
        <div className="text-center py-20 text-gray-400 flex flex-col items-center gap-2">
          <CloudOff className="w-12 h-12 text-gray-300" />
          <p>Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les points de vente.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucun point de vente trouvé</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((point) => {
            const quotaCfg = QUOTA_STATUS_CONFIG[point.quota_status] ?? QUOTA_STATUS_CONFIG.non_paye;
            const QuotaIcon = quotaCfg.Icon;
            const remaining = (point.quota_amount ?? 4000) - (point.quota_paid ?? 0);
            const safeQuotaAmount = point.quota_amount ?? 4000;
            const pct = safeQuotaAmount > 0 ? Math.min(100, Math.round(((point.quota_paid ?? 0) / safeQuotaAmount) * 100)) : 0;
            return (
              <div key={point.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
                      <Store className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{point.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${point.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {point.is_active ? 'Actif' : 'Inactif'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${point.is_new ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>
                          {point.is_new ? 'Nouveau' : 'Ancien'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(point)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(point)}
                          disabled={deletingPointId === point.id}
                          aria-label={`Supprimer le point de vente ${point.name}`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-wait transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          {deletingPointId === point.id ? 'Suppression…' : 'Supprimer'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {point.zone ? (
                      <span className="text-sm text-gray-600">Zone: <span className="font-medium text-gray-800">{point.zone}</span></span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Zone non attribuée</span>
                    )}
                    {canEdit && (
                      <button onClick={() => openZoneEditor(point)} className="text-xs text-amber-600 hover:text-amber-700 font-medium ml-1">
                        {point.zone ? 'Modifier' : 'Attribuer'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" /> {point.district}</div>
                  {point.arrondissements.length > 0 && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div className="flex flex-wrap gap-1">
                        {point.arrondissements.map((a) => (
                          <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {point.address && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" /> {point.address}</div>}
                  {(point.owner_full_name ?? point.owner_name) && (
                    <div className="flex items-center gap-2"><UserIcon className="w-4 h-4 text-gray-400" /> {point.owner_full_name ?? point.owner_name}</div>
                  )}
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                    <span className={point.driver_id ? '' : 'text-amber-600 italic'}>
                      Commercial : {point.driver_id ? (driverNameById.get(point.driver_id) ?? 'Commercial inconnu') : 'Sans commercial'}
                    </span>
                  </div>
                  {point.owner_phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {point.owner_phone}</div>}
                  {point.owner_phone_secondary && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {point.owner_phone_secondary}</div>}
                  {point.owner_email && <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-400" /> {point.owner_email}</div>}
                  {point.delivery_days.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {point.delivery_days.map((d) => (
                        <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{d}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quota section */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {point.is_new ? (
                    <>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                          <Wallet className="w-4 h-4 text-gray-400" /> Cotisation
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${quotaCfg.style}`}>
                          <QuotaIcon className="w-3 h-3" /> {quotaCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{formatFCFA(point.quota_paid ?? 0)} / {formatFCFA(point.quota_amount ?? 4000)}</span>
                        {remaining > 0 && <span className="text-red-500">Reste {formatFCFA(remaining)}</span>}
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-200'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <button onClick={() => openQuota(point)}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors">
                        <History className="w-3.5 h-3.5" /> Voir les versements
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                        <Wallet className="w-4 h-4 text-gray-300" /> Cotisation
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                        Exempté (ancien point)
                      </span>
                    </div>
                  )}
                </div>

                {/* GPS quick-action */}
                <div className="mt-3 flex items-center gap-2">
                  {point.gps_lat != null && point.gps_lng != null ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                      <Crosshair className="w-3.5 h-3.5" /> GPS captée
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Crosshair className="w-3.5 h-3.5" /> GPS non captée
                    </span>
                  )}
                  {canEdit && (
                    <button onClick={() => setGeoTargetPoint(point)}
                      className={`ml-auto px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${point.gps_lat != null ? 'text-gray-500 hover:bg-gray-100' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'}`}>
                      <Crosshair className="w-3.5 h-3.5" /> {point.gps_lat != null ? 'Recapturer' : 'Géolocaliser'}
                    </button>
                  )}
                </div>

                <button onClick={() => onNavigate?.('consignments')}
                  className="mt-2 w-full px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5">
                  <ArrowRight className="w-4 h-4" /> Voir consignes
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editing ? 'Modifier le point de vente' : 'Nouveau point de vente'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du point de vente *</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet du propriétaire *</label>
                <input required value={form.owner_full_name} onChange={(e) => setForm({ ...form, owner_full_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de client *</label>
                <select
                  required
                  value={form.client_type}
                  onChange={(e) => setForm({ ...form, client_type: e.target.value as SalesPoint['client_type'] })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                >
                  {Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              {form.client_type === 'autre' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Précisez le type de client *</label>
                  <input
                    required
                    value={form.client_type_other}
                    onChange={(e) => setForm({ ...form, client_type_other: e.target.value })}
                    placeholder="Ex. école, association, administration"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone principal *</label>
                  <input required value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
                    placeholder="+243 …"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone secondaire</label>
                  <input value={form.owner_phone_secondary} onChange={(e) => setForm({ ...form, owner_phone_secondary: e.target.value })}
                    placeholder="+243 …"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse mail (optionnel)</label>
                <input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                  placeholder="exemple@mail.com"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse du point de vente</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quartier *</label>
                  <input required value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                  <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Arrondissement(s) — un point peut être entre deux</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={form.arrondissementInput}
                    onChange={(e) => setForm({ ...form, arrondissementInput: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArrondissement(); } }}
                    placeholder="Ex: Lukunga, ajouter + Entrée"
                    className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                  <button type="button" onClick={addArrondissement}
                    className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1">
                    <PlusCircle className="w-4 h-4" />
                  </button>
                </div>
                {form.arrondissements.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.arrondissements.map((a) => (
                      <span key={a} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                        {a}
                        <button type="button" onClick={() => removeArrondissement(a)} className="hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position GPS</label>
                <button
                  type="button"
                  onClick={() => setShowGeoPicker(true)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50/50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm text-gray-600">
                    <Crosshair className="w-5 h-5 text-teal-500" />
                    {form.gps_lat && form.gps_lng
                      ? `${form.gps_lat}, ${form.gps_lng}`
                      : 'Géolocaliser automatiquement'}
                  </span>
                  {form.gps_lat && form.gps_lng && (
                    <span className="text-xs font-medium text-emerald-600">Captée</span>
                  )}
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Jours de livraison</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <button key={day} type="button" onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        form.delivery_days.includes(day)
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de point</label>
                  <select value={form.is_new ? 'new' : 'old'} onChange={(e) => {
                    const isNew = e.target.value === 'new';
                    setForm({ ...form, is_new: isNew, quota_amount: isNew ? (form.quota_amount === '0' ? '4000' : form.quota_amount) : '0' });
                  }}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="new">Nouveau</option>
                    <option value="old">Ancien</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montant cotisation (FCFA)</label>
                  <input type="number" value={form.quota_amount} 
                    disabled={!form.is_new}
                    onChange={(e) => setForm({ ...form, quota_amount: e.target.value })}
                    placeholder={form.is_new ? '4000' : 'Exempté (ancien point)'}
                    className={`w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none ${!form.is_new ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`} />
                  {!form.is_new && <p className="text-xs text-gray-400 mt-1">Les anciens points sont exemptés de cotisation</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commercial responsable</label>
                <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">Aucun</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} — {d.zone}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-200" />
                <span className="text-sm text-gray-700">Point actif</span>
              </label>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                {editing ? 'Enregistrer' : 'Créer'}
              </button>
            </form>
          </div>
        </div>
      )}

      <GeoPickerModal
        open={showGeoPicker}
        initialLat={form.gps_lat}
        initialLng={form.gps_lng}
        onConfirm={(la, ln) => {
          setForm((f) => ({ ...f, gps_lat: la, gps_lng: ln }));
          setShowGeoPicker(false);
        }}
        onClose={() => setShowGeoPicker(false)}
      />

      {/* Geo picker for inline GPS capture from card */}
      <GeoPickerModal
        open={!!geoTargetPoint}
        initialLat={geoTargetPoint?.gps_lat?.toString() ?? ''}
        initialLng={geoTargetPoint?.gps_lng?.toString() ?? ''}
        onConfirm={(la, ln) => saveGeo(la, ln)}
        onClose={() => setGeoTargetPoint(null)}
      />

      {/* Inline zone assignment modal */}
      {zoneTargetPoint && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setZoneTargetPoint(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Attribuer une zone</h3>
              <button onClick={() => setZoneTargetPoint(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">Point de vente: <span className="font-medium text-gray-800">{zoneTargetPoint.name}</span></p>
            <input
              value={zoneInput}
              onChange={(e) => setZoneInput(e.target.value)}
              placeholder="Ex: Zone Est, Centre, Nord…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
            />
            {zones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {zones.map((z) => (
                  <button key={z} type="button" onClick={() => setZoneInput(z)}
                    className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors">
                    {z}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setZoneTargetPoint(null)}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors">
                Annuler
              </button>
              <button onClick={saveZone}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-medium shadow-md hover:shadow-lg transition-all">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quota payments modal */}
      {showPaymentModal && quotaPoint && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPaymentModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Cotisation — {quotaPoint.name}</h3>
                <p className="text-sm text-gray-500">{quotaPoint.owner_full_name ?? quotaPoint.owner_name ?? '—'}</p>
              </div>
              <button onClick={() => setShowPaymentModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quota summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Montant de la cotisation</span>
                <span className="font-semibold text-gray-900">{formatFCFA(quotaPoint.quota_amount ?? 4000)}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Total versé</span>
                <span className="font-semibold text-emerald-600">{formatFCFA(quotaPoint.quota_paid ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Reste à payer</span>
                <span className="font-semibold text-red-600">{formatFCFA((quotaPoint.quota_amount ?? 4000) - (quotaPoint.quota_paid ?? 0))}</span>
              </div>
              <div className="mt-2 w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${quotaPoint.quota_status === 'paye' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${quotaPoint.quota_amount > 0 ? Math.min(100, (quotaPoint.quota_paid / quotaPoint.quota_amount) * 100) : 0}%` }} />
              </div>
            </div>

            {/* Add payment */}
            {canAddPayment && quotaPoint.is_new && quotaPoint.quota_status !== 'paye' && (
              <div className="border border-gray-100 rounded-xl p-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <PlusCircle className="w-4 h-4 text-amber-500" /> Ajouter un versement
                </h4>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="Montant (FCFA)"
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                    <select value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                      <option value="especes">Espèces</option>
                      <option value="mobile_money">Mobile Money</option>
                      <option value="virement">Virement</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <input value={paymentForm.receipt_number} onChange={(e) => setPaymentForm({ ...paymentForm, receipt_number: e.target.value })}
                    placeholder="N° reçu (optionnel)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  <input value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    placeholder="Notes (optionnel)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                  <button onClick={submitPayment} disabled={!paymentForm.amount}
                    className="w-full py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40 transition-colors">
                    Enregistrer le versement
                  </button>
                </div>
              </div>
            )}

            {/* Payment history */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <History className="w-4 h-4 text-gray-400" /> Historique des versements
              </h4>
              {quotaPayments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Aucun versement enregistré</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {quotaPayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatFCFA(p.amount_fcfa)}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(p.payment_date).toLocaleDateString('fr-FR')} · {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}
                          {p.receipt_number && ` · ${p.receipt_number}`}
                        </p>
                        {p.notes && <p className="text-xs text-gray-400 italic mt-0.5">{p.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
