import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, PersonnelChangeRequest } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Plus, Search, Phone, MapPin, Bike, Calendar, X, Edit2, Trash2,
  Clock, CheckCircle2, XCircle, UserPlus, UserCog, UserMinus, ArrowRight,
  CloudOff,
} from 'lucide-react';

const VEHICLE_LABELS: Record<string, string> = {
  moto: 'Moto', velo: 'Vélo', voiture: 'Voiture', pied: 'À pied',
};

const STATUS_STYLES: Record<string, string> = {
  actif: 'bg-emerald-50 text-emerald-700',
  inactif: 'bg-gray-100 text-gray-500',
  conge: 'bg-amber-50 text-amber-700',
};

type PendingReq = PersonnelChangeRequest & { requester?: { full_name: string } };

export default function DriversPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pending, setPending] = useState<PendingReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState({
    full_name: '', phone_primary: '', phone_secondary: '', address: '',
    zone: '', vehicle_type: 'moto', status: 'actif', hire_date: new Date().toISOString().slice(0, 10),
  });
  const { fetchWithCache, isOffline } = useOfflineFetch();

  // Roles: chefs de départements (>=4) can submit requests; directrice (5) & adjoint (4) approve
  const canRequest = (profile?.role ?? 1) >= 4;
  // Directrice (5) and Directeur général adjoint (4) can approve — but they also can submit
  const isDirectrice = (profile?.role ?? 1) === 5;
  const isAdjoint = (profile?.role ?? 1) === 4;
  const isAdmin = (profile?.role ?? 1) === 6;

  const loadDrivers = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('drivers-page', async () => {
      const [driversRes, pendingRes] = await Promise.all([
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('personnel_change_requests')
          .select('*, requester:profiles!requested_by(full_name)')
          .eq('entity_type', 'driver')
          .eq('status', 'en_attente')
          .order('created_at', { ascending: false }),
      ]);
      return {
        drivers: driversRes.data ?? [],
        pending: pendingRes.data ?? [],
      };
    });
    setDrivers(result.data?.drivers ?? []);
    setPending(result.data?.pending ?? []);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);
  useRealtimeSubscription('drivers-page', isOffline ? [] : ['drivers', 'personnel_change_requests'], loadDrivers);

  const filtered = drivers.filter((d) =>
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    d.zone.toLowerCase().includes(search.toLowerCase()) ||
    d.phone_primary.includes(search)
  );

  const openCreate = () => {
    setEditing(null);
    setForm({
      full_name: '', phone_primary: '', phone_secondary: '', address: '',
      zone: '', vehicle_type: 'moto', status: 'actif', hire_date: new Date().toISOString().slice(0, 10),
    });
    setShowModal(true);
  };

  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({
      full_name: driver.full_name,
      phone_primary: driver.phone_primary,
      phone_secondary: driver.phone_secondary ?? '',
      address: driver.address ?? '',
      zone: driver.zone,
      vehicle_type: driver.vehicle_type,
      status: driver.status,
      hire_date: driver.hire_date,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = (await supabase.auth.getUser()).data.user?.id;

    if (editing) {
      // Submit update request for approval
      await supabase.from('personnel_change_requests').insert({
        entity_type: 'driver',
        action_type: 'update',
        entity_id: editing.id,
        payload: form,
        requested_by: userId,
      });
    } else {
      // Submit create request for approval
      await supabase.from('personnel_change_requests').insert({
        entity_type: 'driver',
        action_type: 'create',
        entity_id: null,
        payload: form,
        requested_by: userId,
      });
    }
    setShowModal(false);
    loadDrivers();
  };

  const handleDelete = async (driver: Driver) => {
    if (!(await confirmDialog({ message: `Demande de suppression du commercial ${driver.full_name} ? Cette demande devra être approuvée par la Directrice et le Directeur général adjoint.`, confirmLabel: 'Demander la suppression', danger: true }))) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('personnel_change_requests').insert({
      entity_type: 'driver',
      action_type: 'delete',
      entity_id: driver.id,
      payload: { full_name: driver.full_name },
      requested_by: userId,
    });
    loadDrivers();
  };

  const approveRequest = async (req: PendingReq) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (isDirectrice || isAdmin) {
      updates.directrice_approved_by = userId;
      updates.directrice_approved_at = new Date().toISOString();
    }
    if (isAdjoint || isAdmin) {
      updates.adjoint_approved_by = userId;
      updates.adjoint_approved_at = new Date().toISOString();
    }

    const hasDirectrice = isDirectrice || isAdmin || !!req.directrice_approved_by;
    const hasAdjoint = isAdjoint || isAdmin || !!req.adjoint_approved_by;

    if (hasDirectrice && hasAdjoint) {
      updates.status = 'validee';
    }

    const { error: updErr } = await supabase.from('personnel_change_requests').update(updates).eq('id', req.id);
    if (updErr) { toast('Erreur lors de l approbation.', 'error'); return; }

    if (hasDirectrice && hasAdjoint) {
      // Apply the change
      if (req.action_type === 'delete') {
        const { error } = await supabase.from('drivers').delete().eq('id', req.entity_id!);
        if (error) { toast('Erreur lors de la suppression.', 'error'); return; }
      } else if (req.action_type === 'create') {
        const payload = { ...req.payload } as Record<string, unknown>;
        delete payload['id'];
        const { error } = await supabase.from('drivers').insert(payload);
        if (error) { toast('Erreur lors de la création.', 'error'); return; }
      } else {
        const payload = { ...req.payload } as Record<string, unknown>;
        delete payload['id'];
        const { error } = await supabase.from('drivers').update(payload).eq('id', req.entity_id!);
        if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
      }
      const { error: applyErr } = await supabase.from('personnel_change_requests')
        .update({ applied: true, updated_at: new Date().toISOString() })
        .eq('id', req.id);
      if (applyErr) { toast('Erreur lors de la finalisation.', 'error'); return; }
    }

    loadDrivers();
  };

  const rejectRequest = async (req: PendingReq) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('personnel_change_requests').update({
      status: 'rejetee',
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    if (error) { toast('Erreur lors du rejet.', 'error'); return; }
    loadDrivers();
  };

  const canApproveDirectrice = (req: PendingReq) => (isDirectrice || isAdmin) && !req.directrice_approved_by;
  const canApproveAdjoint = (req: PendingReq) => (isAdjoint || isAdmin) && !req.adjoint_approved_by;

  const ACTION_ICONS = {
    create: UserPlus, update: UserCog, delete: UserMinus,
  };
  const ACTION_LABELS = { create: 'Création', update: 'Modification', delete: 'Suppression' };
  const ACTION_COLORS = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-amber-100 text-amber-700',
    delete: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-4">
      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Demandes en attente d'approbation ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((req) => {
              const ActIcon = ACTION_ICONS[req.action_type];
              return (
                <div key={req.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ACTION_COLORS[req.action_type]}`}>
                    <ActIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {ACTION_LABELS[req.action_type]} — {String(req.payload.full_name ?? '—')}
                    </p>
                    <p className="text-xs text-gray-500">
                      Par {req.requester?.full_name ?? '—'} · {new Date(req.created_at).toLocaleString('fr-FR')}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs">
                      <span className={req.directrice_approved_by ? 'text-emerald-600' : 'text-gray-400'}>
                        {req.directrice_approved_by ? '✓ Directrice' : '○ Directrice'}
                      </span>
                      <span className={req.adjoint_approved_by ? 'text-emerald-600' : 'text-gray-400'}>
                        {req.adjoint_approved_by ? '✓ Dir. adjoint' : '○ Dir. adjoint'}
                      </span>
                    </div>
                  </div>
                  {(canApproveDirectrice(req) || canApproveAdjoint(req)) && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => approveRequest(req)}
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => rejectRequest(req)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un commercial…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
          />
        </div>
        {canRequest && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all"
          >
            <Plus className="w-5 h-5" />
            Nouveau commercial
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && drivers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les commerciaux.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucun commercial trouvé</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((driver) => (
            <div key={driver.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-lg">
                    {driver.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{driver.full_name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[driver.status]}`}>
                      {driver.status === 'actif' ? 'Actif' : driver.status === 'conge' ? 'En congé' : 'Inactif'}
                    </span>
                  </div>
                </div>
                {canRequest && (
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(driver)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(driver)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-gray-600">
                <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {driver.phone_primary}</div>
                {driver.phone_secondary && (
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /> {driver.phone_secondary}</div>
                )}
                <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" /> Zone: {driver.zone || '—'}</div>
                <div className="flex items-center gap-2"><Bike className="w-4 h-4 text-gray-400" /> {VEHICLE_LABELS[driver.vehicle_type]}</div>
                <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> Embauché le {new Date(driver.hire_date).toLocaleDateString('fr-FR')}</div>
              </div>
              <button onClick={() => onNavigate?.('batches')}
                className="mt-3 w-full px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5">
                <ArrowRight className="w-4 h-4" /> Voir tournées
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editing ? 'Modifier le commercial' : 'Nouveau commercial'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-xs text-amber-800">
              Cette demande sera soumise pour approbation à la Directrice et au Directeur général adjoint avant d'être appliquée.
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet</label>
                <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone principal</label>
                  <input required value={form.phone_primary} onChange={(e) => setForm({ ...form, phone_primary: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone secondaire</label>
                  <input value={form.phone_secondary} onChange={(e) => setForm({ ...form, phone_secondary: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                  <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Véhicule</label>
                  <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    {Object.entries(VEHICLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                    <option value="actif">Actif</option>
                    <option value="inactif">Inactif</option>
                    <option value="conge">En congé</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d'embauche</label>
                  <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Soumettre la demande
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
