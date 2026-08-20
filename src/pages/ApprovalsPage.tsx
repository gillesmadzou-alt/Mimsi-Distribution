import { useEffect, useState, useCallback } from 'react';
import { supabase, PersonnelChangeRequest } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  CheckCircle2, XCircle, Clock, UserPlus, UserCog, UserMinus,
  Bike, ChefHat, Beaker, X, AlertCircle, ShieldCheck, CloudOff,
} from 'lucide-react';
import CategoryFilter, { PersonnelCategory } from '@/components/CategoryFilter';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

const ENTITY_LABELS: Record<string, { label: string; icon: typeof Bike }> = {
  driver: { label: 'Commercial', icon: Bike },
  kneader: { label: 'Pétrisseur', icon: Beaker },
  baker: { label: 'Fournier', icon: ChefHat },
};

const ACTION_LABELS: Record<string, { label: string; icon: typeof UserPlus; color: string; bg: string }> = {
  create: { label: 'Création', icon: UserPlus, color: 'text-emerald-700', bg: 'bg-emerald-100' },
  update: { label: 'Modification', icon: UserCog, color: 'text-amber-700', bg: 'bg-amber-100' },
  delete: { label: 'Suppression', icon: UserMinus, color: 'text-red-700', bg: 'bg-red-100' },
};

type PendingReq = PersonnelChangeRequest & { requester?: { full_name: string } };

export default function ApprovalsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PendingReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'en_attente' | 'validee' | 'rejetee' | 'all'>('en_attente');
  const [categoryFilter, setCategoryFilter] = useState<PersonnelCategory>('all');
  const [showReject, setShowReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const isDirectrice = (profile?.role ?? 1) === 5;
  const isAdjoint = (profile?.role ?? 1) === 4;
  const isAdmin = (profile?.role ?? 1) === 6;
  const canApprove = isDirectrice || isAdjoint || isAdmin;

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchWithCache<PendingReq[]>('approvals_page', async () => {
        let q = supabase
          .from('personnel_change_requests')
          .select('*, requester:profiles!requested_by(full_name)')
          .order('created_at', { ascending: false });
        if (filter !== 'all') q = q.eq('status', filter);
        if (categoryFilter === 'commercial') q = q.eq('entity_type', 'driver');
        else if (categoryFilter === 'fournier') q = q.eq('entity_type', 'baker');
        else if (categoryFilter === 'petrisseur') q = q.eq('entity_type', 'kneader');
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as PendingReq[];
      });
      if (result.data) setRequests(result.data);
    } catch {
      setLoadError('Erreur lors du chargement des demandes.');
    }
    setLoading(false);
  }, [filter, categoryFilter, fetchWithCache]);

  useEffect(() => { loadRequests(); }, [loadRequests, categoryFilter]);

  useRealtimeSubscription('approvals-page', isOffline ? [] : ['personnel_change_requests'], loadRequests);

  const applyChange = async (req: PersonnelChangeRequest): Promise<boolean> => {
    const table = req.entity_type === 'driver' ? 'drivers' : req.entity_type === 'kneader' ? 'kneaders' : 'bakers';
    if (req.action_type === 'delete') {
      const { error } = await supabase.from(table).delete().eq('id', req.entity_id!);
      return !error;
    }
    const payload = { ...req.payload } as Record<string, unknown>;
    delete payload['id'];
    if (req.action_type === 'create') {
      const { error } = await supabase.from(table).insert(payload);
      return !error;
    } else {
      const { error } = await supabase.from(table).update(payload).eq('id', req.entity_id!);
      return !error;
    }
  };

  const handleApprove = async (req: PendingReq) => {
    const { data: allApproved, error } = await supabase.rpc('approve_personnel_request', {
      p_request_id: req.id,
    });

    if (error) {
      toast('Erreur lors de l approbation.', 'error');
      loadRequests();
      return;
    }

    if (allApproved) {
      const success = await applyChange(req);
      if (success) {
        const { error: applyErr } = await supabase.from('personnel_change_requests').update({ applied: true, updated_at: new Date().toISOString() }).eq('id', req.id);
        if (applyErr) { toast('Erreur lors de la finalisation.', 'error'); }
      } else {
        toast('Erreur lors de l application de la modification.', 'error');
      }
    }
    loadRequests();
  };

  const handleReject = async (req: PendingReq) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('personnel_change_requests').update({
      status: 'rejetee', rejected_by: userId, rejected_at: new Date().toISOString(),
      rejection_reason: rejectReason || null, updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    if (error) { toast('Erreur lors du rejet.', 'error'); return; }
    setShowReject(null); setRejectReason(''); loadRequests();
  };

  const renderPayload = (req: PersonnelChangeRequest) => {
    const p = req.payload;
    const fields: { label: string; value: string }[] = [];
    if (p.full_name) fields.push({ label: 'Nom', value: String(p.full_name) });
    if (p.phone_primary) fields.push({ label: 'Téléphone', value: String(p.phone_primary) });
    if (p.phone) fields.push({ label: 'Téléphone', value: String(p.phone) });
    if (p.phone_secondary) fields.push({ label: 'Tél. secondaire', value: String(p.phone_secondary) });
    if (p.address) fields.push({ label: 'Adresse', value: String(p.address) });
    if (p.zone) fields.push({ label: 'Zone', value: String(p.zone) });
    if (p.vehicle_type) fields.push({ label: 'Véhicule', value: String(p.vehicle_type) });
    if (p.status) fields.push({ label: 'Statut', value: String(p.status) });
    if (p.hire_date) fields.push({ label: 'Embauche', value: String(p.hire_date) });
    if (p.notes) fields.push({ label: 'Notes', value: String(p.notes) });
    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {fields.map((f) => (
          <div key={f.label} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">{f.label}</p>
            <p className="text-sm text-gray-800 truncate">{f.value}</p>
          </div>
        ))}
      </div>
    );
  };

  const FILTERS = [
    { id: 'en_attente' as const, label: 'En attente' },
    { id: 'validee' as const, label: 'Validées' },
    { id: 'rejetee' as const, label: 'Rejetées' },
    { id: 'all' as const, label: 'Toutes' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === f.id ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{f.label}</button>
          ))}
        </div>
      </div>

      {!canApprove && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Seuls l'administrateur, la Directrice et le Directeur général adjoint peuvent approuver ou rejeter les demandes.
        </div>
      )}

      {loading ? (
        loadError ? (
          <div className="text-center py-20 text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mx-auto max-w-md">{loadError}</div>
        ) : (
          <div className="text-center py-20 text-gray-400">Chargement…</div>
        )
      ) : isOffline && requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les demandes d'approbation.</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune demande</div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const entCfg = ENTITY_LABELS[req.entity_type] ?? { label: req.entity_type, icon: AlertCircle };
            const actCfg = ACTION_LABELS[req.action_type] ?? { label: req.action_type, icon: UserCog, color: 'text-gray-700', bg: 'bg-gray-100' };
            const EntIcon = entCfg.icon;
            const ActIcon = actCfg.icon;
            const directriceDone = !!req.directrice_approved_by;
            const adjointDone = !!req.adjoint_approved_by;
            const adminDone = !!req.admin_approved_by;
            const canActDirectrice = isDirectrice && !directriceDone && req.status === 'en_attente';
            const canActAdjoint = isAdjoint && !adjointDone && req.status === 'en_attente';
            const canActAdmin = isAdmin && !adminDone && req.status === 'en_attente';
            const canReject = canApprove && req.status === 'en_attente';
            return (
              <div key={req.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-start gap-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${actCfg.bg}`}>
                    <ActIcon className={`w-5 h-5 ${actCfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actCfg.bg} ${actCfg.color}`}>{actCfg.label}</span>
                      <span className="text-xs text-gray-500 flex items-center gap-1"><EntIcon className="w-3.5 h-3.5" /> {entCfg.label}</span>
                      {req.status === 'validee' && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Validée</span>}
                      {req.status === 'rejetee' && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700 flex items-center gap-1"><XCircle className="w-3 h-3" /> Rejetée</span>}
                      {req.applied && <span className="text-xs text-emerald-600 font-medium">Appliquée</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-900 mt-1">{String(req.payload.full_name ?? '—')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Demandé par {req.requester?.full_name ?? '—'} · {new Date(req.created_at).toLocaleString('fr-FR')}</p>
                    {renderPayload(req)}
                    <div className="flex items-center gap-4 mt-3 text-xs">
                      <div className={`flex items-center gap-1.5 ${directriceDone ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {directriceDone ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />} Directrice {directriceDone ? 'approuvé' : 'en attente'}
                      </div>
                      <div className={`flex items-center gap-1.5 ${adjointDone ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {adjointDone ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />} Dir. adjoint {adjointDone ? 'approuvé' : 'en attente'}
                      </div>
                      <div className={`flex items-center gap-1.5 ${adminDone ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {adminDone ? <ShieldCheck className="w-4 h-4" /> : <Clock className="w-4 h-4" />} Admin. {adminDone ? 'approuvé' : 'en attente'}
                      </div>
                    </div>
                    {req.status === 'rejetee' && req.rejection_reason && <p className="text-xs text-red-600 mt-2 italic">Motif : {req.rejection_reason}</p>}
                    {canReject && (
                      <div className="flex gap-2 mt-3">
                        {canActDirectrice && (
                          <button onClick={() => handleApprove(req)} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Approuver (Directrice)
                          </button>
                        )}
                        {canActAdjoint && (
                          <button onClick={() => handleApprove(req)} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Approuver (Dir. adjoint)
                          </button>
                        )}
                        {canActAdmin && (
                          <button onClick={() => handleApprove(req)} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                            <ShieldCheck className="w-4 h-4" /> Approuver (Admin.)
                          </button>
                        )}
                        <button onClick={() => setShowReject(req.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1">
                          <XCircle className="w-4 h-4" /> Rejeter
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showReject && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowReject(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Motif du rejet</h3>
              <button onClick={() => setShowReject(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Expliquez le motif du rejet…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowReject(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors">Annuler</button>
              <button onClick={() => { const req = requests.find((r) => r.id === showReject); if (req) handleReject(req); }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors">Confirmer le rejet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
