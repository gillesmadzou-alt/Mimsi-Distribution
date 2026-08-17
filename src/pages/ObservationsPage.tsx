import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, FieldObservation, FieldObservationComment, ObservationCategory, ObservationPriority, ObservationStatus, OBSERVATION_CATEGORY_LABELS, OBSERVATION_PRIORITY_LABELS, OBSERVATION_PRIORITY_META, OBSERVATION_STATUS_LABELS, OBSERVATION_STATUS_META, ROLE_LABELS, type Profile, type DeliveryBatch, type SalesPoint } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Plus, Eye, MessageSquare, Send, X, Filter, ClipboardList,
  Truck, FlaskConical, ChefHat, Package, MoreHorizontal,
  ArrowLeft, Clock, User, AlertCircle, CheckCircle2, CircleDot, Archive, CloudOff,
} from 'lucide-react';

const CATEGORY_ICONS: Record<ObservationCategory, typeof Truck> = {
  livraison: Truck,
  fabrication_pate: FlaskConical,
  cuisson: ChefHat,
  stock: Package,
  autre: MoreHorizontal,
};

export default function ObservationsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [observations, setObservations] = useState<FieldObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<FieldObservation | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterPerson, setFilterPerson] = useState<string>('all');
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadObservations = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('field_observations', async () => {
      const { data, error } = await supabase
        .from('field_observations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as FieldObservation[];
    });

    if (result.error) {
      console.error('loadObservations error:', result.error);
    } else {
      setObservations(result.data ?? []);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadObservations(); }, [loadObservations]);
  useRealtimeSubscription('observations-page', isOffline ? [] : ['field_observations', 'field_observation_comments'], loadObservations);

  // ── Create form state ──
  const [form, setForm] = useState({
    authorName: '',
    authorRole: '' as string,
    category: 'livraison' as ObservationCategory,
    priority: 'normale' as ObservationPriority,
    title: '',
    body: '',
    related_batch_id: '' as string,
    related_sales_point_id: '' as string,
    related_production_id: '' as string,
  });
  const [submitting, setSubmitting] = useState(false);
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [salesPoints, setSalesPoints] = useState<SalesPoint[]>([]);
  const [productions, setProductions] = useState<{ id: string; production_date: string; notes: string | null }[]>([]);

  useEffect(() => {
    if (!showCreate) return;
    const loadFormRefs = async () => {
      if (isOffline || !navigator.onLine) {
        const cached = await getCachedPageData<{ batches: DeliveryBatch[]; salesPoints: SalesPoint[]; productions: { id: string; production_date: string; notes: string | null }[] }>('observations:form-refs');
        if (cached) {
          setBatches(cached.data.batches);
          setSalesPoints(cached.data.salesPoints);
          setProductions(cached.data.productions);
        }
        return;
      }
      const [batchesRes, pointsRes, prodRes] = await Promise.all([
        supabase.from('delivery_batches').select('id, batch_code').order('batch_date', { ascending: false }).limit(50),
        supabase.from('sales_points').select('id, name').order('name').limit(100),
        supabase.from('production_records').select('id, production_date, notes').order('production_date', { ascending: false }).limit(50),
      ]);
      const batchesData = (batchesRes.data ?? []) as DeliveryBatch[];
      const salesPointsData = (pointsRes.data ?? []) as SalesPoint[];
      const productionsData = (prodRes.data ?? []) as { id: string; production_date: string; notes: string | null }[];
      setBatches(batchesData);
      setSalesPoints(salesPointsData);
      setProductions(productionsData);
      await cachePageData('observations:form-refs', { batches: batchesData, salesPoints: salesPointsData, productions: productionsData });
    };
    loadFormRefs();
  }, [showCreate, isOffline]);

  useEffect(() => {
    if (profile && showCreate) {
      setForm((prev) => ({
        ...prev,
        authorName: prev.authorName || profile.full_name,
        authorRole: prev.authorRole || String(profile.role),
      }));
    }
  }, [profile, showCreate]);

  const handleCreate = async () => {
    if (!profile || !form.title.trim() || !form.body.trim() || !form.authorName.trim() || !form.authorRole) return;
    setSubmitting(true);
    const { error } = await supabase.from('field_observations').insert({
      author_id: profile.id,
      author_name: form.authorName.trim(),
      author_role: Number(form.authorRole),
      category: form.category,
      priority: form.priority,
      title: form.title.trim(),
      body: form.body.trim(),
      related_batch_id: form.related_batch_id || null,
      related_sales_point_id: form.related_sales_point_id || null,
      related_production_id: form.related_production_id || null,
    });
    setSubmitting(false);
    if (error) {
      toast("Erreur lors de l'enregistrement de l'observation.", 'error');
      return;
    }
    setForm({ authorName: '', authorRole: '', category: 'livraison', priority: 'normale', title: '', body: '', related_batch_id: '', related_sales_point_id: '', related_production_id: '' });
    setShowCreate(false);
    loadObservations();
  };

  // ── Detail view ──
  const openDetail = async (obs: FieldObservation) => {
    const { data } = await supabase
      .from('field_observation_comments')
      .select('*')
      .eq('observation_id', obs.id)
      .order('created_at', { ascending: true });
    setSelected({ ...obs, comments: (data as unknown as FieldObservationComment[]) ?? [] });
  };

  const [newComment, setNewComment] = useState('');
  const [commenting, setCommenting] = useState(false);

  const handleAddComment = async () => {
    if (!profile || !selected || !newComment.trim()) return;
    setCommenting(true);
    const { data, error } = await supabase
      .from('field_observation_comments')
      .insert({
        observation_id: selected.id,
        author_id: profile.id,
        author_name: profile.full_name,
        author_role: profile.role,
        comment: newComment.trim(),
      })
      .select('*')
      .single();

    setCommenting(false);
    if (error || !data) {
      toast("Erreur lors de l'envoi du commentaire.", 'error');
      return;
    }
    const comment = data as unknown as FieldObservationComment;
    setSelected({ ...selected, comments: [...(selected.comments ?? []), comment] });
    setNewComment('');
  };

  const handleStatusChange = async (obs: FieldObservation, status: ObservationStatus) => {
    const { error } = await supabase
      .from('field_observations')
      .update({ status })
      .eq('id', obs.id);
    if (error) {
      toast("Erreur lors du changement de statut.", 'error');
      return;
    }
    const updated = { ...obs, status };
    if (selected && selected.id === obs.id) setSelected(updated);
    setObservations((prev) => prev.map((o) => (o.id === obs.id ? updated : o)));
  };

  const handleDelete = async (obs: FieldObservation) => {
    if (!(await confirmDialog({ message: "Supprimer cette observation ? Cette action est irréversible.", confirmLabel: 'Supprimer', danger: true }))) return;
    const { error } = await supabase.from('field_observations').delete().eq('id', obs.id);
    if (error) {
      toast("Erreur lors de la suppression.", 'error');
      return;
    }
    setSelected(null);
    loadObservations();
  };

  // ── Unique authors & roles for filters ──
  const uniqueAuthors = useMemo(() => {
    const map = new Map<string, { name: string; role: number }>();
    observations.forEach((o) => {
      if (!map.has(o.author_name)) map.set(o.author_name, { name: o.author_name, role: o.author_role });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [observations]);

  const uniqueRoles = useMemo(() => {
    const set = new Set<number>();
    observations.forEach((o) => set.add(o.author_role));
    return Array.from(set).sort((a, b) => a - b);
  }, [observations]);

  // ── Filters ──
  const filtered = observations.filter((o) => {
    if (filterCategory !== 'all' && o.category !== filterCategory) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (filterPriority !== 'all' && o.priority !== filterPriority) return false;
    if (filterRole !== 'all' && String(o.author_role) !== filterRole) return false;
    if (filterPerson !== 'all' && o.author_name !== filterPerson) return false;
    return true;
  });

  const stats = {
    total: observations.length,
    ouvert: observations.filter((o) => o.status === 'ouvert').length,
    enCours: observations.filter((o) => o.status === 'en_cours').length,
    resolu: observations.filter((o) => o.status === 'resolu').length,
    importante: observations.filter((o) => o.priority === 'importante' && o.status !== 'ferme').length,
  };

  // ── Detail view render ──
  if (selected) {
    const obs = selected;
    const CatIcon = CATEGORY_ICONS[obs.category];
    const prioMeta = OBSERVATION_PRIORITY_META[obs.priority];
    const statusMeta = OBSERVATION_STATUS_META[obs.status];
    const canEdit = profile?.id === obs.author_id;

    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Retour à la liste
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <CatIcon className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{obs.title}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prioMeta.bgColor} ${prioMeta.color} border ${prioMeta.borderColor}`}>
                    {OBSERVATION_PRIORITY_LABELS[obs.priority]}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.bgColor} ${statusMeta.color} flex items-center gap-1`}>
                    <span className={`w-2 h-2 rounded-full ${statusMeta.dot}`} />
                    {OBSERVATION_STATUS_LABELS[obs.status]}
                  </span>
                  <span className="text-xs text-gray-500">{OBSERVATION_CATEGORY_LABELS[obs.category]}</span>
                </div>
              </div>
            </div>
            {canEdit && (
              <button onClick={() => handleDelete(obs)} className="text-xs text-gray-400 hover:text-rose-600">Supprimer</button>
            )}
          </div>

          <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{obs.body}</p>

          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
            <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> {obs.author_name} · {ROLE_LABELS[obs.author_role as keyof typeof ROLE_LABELS] ?? `Rôle ${obs.author_role}`}</span>
            <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {new Date(obs.created_at).toLocaleString('fr-FR')}</span>
          </div>

          {/* Status changer */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Changer le statut :</span>
            {(['ouvert', 'en_cours', 'resolu', 'ferme'] as ObservationStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(obs, s)}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${
                  obs.status === s
                    ? `${OBSERVATION_STATUS_META[s].bgColor} ${OBSERVATION_STATUS_META[s].color} border-current font-semibold`
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {OBSERVATION_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Comments */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-400" />
            Commentaires ({obs.comments?.length ?? 0})
          </h3>

          {obs.comments && obs.comments.length > 0 && (
            <div className="space-y-3 mb-4">
              {obs.comments.map((c) => (
                <div key={c.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{c.author_name} · {ROLE_LABELS[c.author_role as keyof typeof ROLE_LABELS] ?? `Rôle ${c.author_role}`}</span>
                    <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString('fr-FR')}</span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))}
            </div>
          )}

          {obs.comments?.length === 0 && (
            <p className="text-sm text-gray-400 mb-4">Aucun commentaire pour le moment.</p>
          )}

          <div className="flex gap-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Ajouter un commentaire…"
              rows={2}
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none"
            />
            <button
              onClick={handleAddComment}
              disabled={!newComment.trim() || commenting}
              className="self-end px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" /> Envoyer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view render ──
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Observations de terrain</h2>
          <p className="text-sm text-gray-500">Notez ce que vous constatez durant vos tâches quotidiennes</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4" /> Nouvelle observation
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: ClipboardList, color: 'text-gray-700', bg: 'bg-gray-50' },
          { label: 'Ouverts', value: stats.ouvert, icon: AlertCircle, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'En cours', value: stats.enCours, icon: CircleDot, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'Résolus', value: stats.resolu, icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'Importantes', value: stats.importante, icon: AlertCircle, color: 'text-rose-700', bg: 'bg-rose-50' },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`${c.bg} rounded-2xl p-4`}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600">{c.label}</p>
                <Icon className={`w-4 h-4 ${c.color}`} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="all">Toutes catégories</option>
            {Object.entries(OBSERVATION_CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="all">Tous statuts</option>
            {Object.entries(OBSERVATION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="all">Toutes priorités</option>
            {Object.entries(OBSERVATION_PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setFilterPerson('all'); }}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="all">Tous types de personnel</option>
            {uniqueRoles.map((r) => (
              <option key={r} value={String(r)}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? `Rôle ${r}`}</option>
            ))}
          </select>
          <select value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
            <option value="all">Toutes les personnes</option>
            {uniqueAuthors
              .filter((a) => filterRole === 'all' || String(a.role) === filterRole)
              .map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
          </select>
          {(filterRole !== 'all' || filterPerson !== 'all') && (
            <button
              onClick={() => { setFilterRole('all'); setFilterPerson('all'); }}
              className="px-3 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-red-500 transition-colors"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Clock className="w-6 h-6 animate-pulse" /> <span className="ml-2">Chargement…</span>
        </div>
      ) : isOffline && observations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les observations.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <ClipboardList className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Aucune observation</p>
          <p className="text-sm text-gray-400 mt-1">Cliquez sur « Nouvelle observation » pour en créer une.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((obs) => {
            const CatIcon = CATEGORY_ICONS[obs.category];
            const prioMeta = OBSERVATION_PRIORITY_META[obs.priority];
            const statusMeta = OBSERVATION_STATUS_META[obs.status];
            return (
              <button
                key={obs.id}
                onClick={() => openDetail(obs)}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-amber-200 hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${prioMeta.bgColor}`}>
                    <CatIcon className={`w-5 h-5 ${prioMeta.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 truncate group-hover:text-amber-700 transition-colors">{obs.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusMeta.bgColor} ${statusMeta.color} flex items-center gap-1`}>
                        <span className={`w-2 h-2 rounded-full ${statusMeta.dot}`} />
                        {OBSERVATION_STATUS_LABELS[obs.status]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">{obs.body}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {obs.author_name}</span>
                      <span>·</span>
                      <span>{OBSERVATION_CATEGORY_LABELS[obs.category]}</span>
                      <span>·</span>
                      <span>{new Date(obs.created_at).toLocaleDateString('fr-FR')}</span>
                      {obs.priority === 'importante' && (
                        <span className={`px-1.5 py-0.5 rounded ${prioMeta.bgColor} ${prioMeta.color} font-medium`}>Importante</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-bold text-gray-900">Nouvelle observation</h3>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Author identity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Votre nom</label>
                  <input
                    type="text"
                    value={form.authorName}
                    readOnly
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Votre poste</label>
                  <select
                    value={form.authorRole}
                    onChange={(e) => setForm({ ...form, authorRole: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                  >
                    <option value="">Sélectionnez votre poste…</option>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(OBSERVATION_CATEGORY_LABELS).map(([k, v]) => {
                    const Icon = CATEGORY_ICONS[k as ObservationCategory];
                    return (
                      <button
                        key={k}
                        onClick={() => setForm({ ...form, category: k as ObservationCategory })}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                          form.category === k
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" /> {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Priorité</label>
                <div className="flex gap-2">
                  {Object.entries(OBSERVATION_PRIORITY_LABELS).map(([k, v]) => {
                    const meta = OBSERVATION_PRIORITY_META[k as ObservationPriority];
                    return (
                      <button
                        key={k}
                        onClick={() => setForm({ ...form, priority: k as ObservationPriority })}
                        className={`flex-1 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                          form.priority === k
                            ? `${meta.bgColor} ${meta.color} border-current`
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Titre</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Résumé court de ce que vous avez constaté"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description détaillée</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="Décrivez en détail ce que vous avez remarqué ou constaté…"
                  rows={5}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none"
                />
              </div>

              {/* Optional links */}
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500">Liens optionnels</p>
                {(form.category === 'livraison') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tournée de livraison</label>
                    <select value={form.related_batch_id} onChange={(e) => setForm({ ...form, related_batch_id: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                      <option value="">— Aucune —</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_code}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Point de vente</label>
                  <select value={form.related_sales_point_id} onChange={(e) => setForm({ ...form, related_sales_point_id: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="">— Aucun —</option>
                    {salesPoints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                  </select>
                </div>
                {(form.category === 'cuisson' || form.category === 'fabrication_pate') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Production</label>
                    <select value={form.related_production_id} onChange={(e) => setForm({ ...form, related_production_id: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                      <option value="">— Aucune —</option>
                      {productions.map((p) => <option key={p.id} value={p.id}>{p.production_date}{p.notes ? ` — ${p.notes}` : ''}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-gray-600 text-sm font-medium hover:bg-gray-100">
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.title.trim() || !form.body.trim() || !form.authorName.trim() || !form.authorRole || submitting}
                className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Enregistrement…' : 'Publier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
