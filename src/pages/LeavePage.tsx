import { useEffect, useState, useCallback } from 'react';
import { supabase, LeavePeriod, LeaveStatus, LEAVE_STATUS_META, Driver, Profile, UserRole, ROLE_LABELS, getRoleAccessLevel } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Plus, X, Calendar, AlertCircle, Check, XCircle, Bell, Filter, UserCheck, CalendarDays, CloudOff
} from 'lucide-react';

type StaffMember = (Driver | Profile) & { kind: 'driver' | 'profile' };

const isProfile = (x: Driver | Profile): x is Profile => 'role' in x;

export default function LeavePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [leaves, setLeaves] = useState<(LeavePeriod & { driver?: Driver; profile?: Profile; notified_profile?: Profile })[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [managers, setManagers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<LeaveStatus | 'all'>('all');

  const [form, setForm] = useState({
    staff_type: '' as 'driver' | 'profile' | '',
    staff_id: '',
    status: 'absent' as LeaveStatus,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: '',
    notified_to: '',
  });

  const { fetchWithCache, isOffline } = useOfflineFetch();

  const canManage = (profile?.role ?? 1) >= 4;
  const isDirector = (profile?.role ?? 1) >= 4 && (profile?.role ?? 1) <= 6;
  const isTopDirector = (profile?.role ?? 1) === 5 || (profile?.role ?? 1) === 6;

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('leave-page', async () => {
      const [leaveRes, driverRes, profileRes] = await Promise.all([
        supabase.from('leave_periods')
          .select('*, driver:drivers!leave_periods_driver_id_fkey(*), profile:profiles!leave_periods_profile_id_fkey(*), notified_profile:profiles!leave_periods_notified_to_fkey(*)')
          .order('start_date', { ascending: false }),
        supabase.from('drivers').select('*').order('full_name'),
        supabase.from('profiles').select('*').order('full_name'),
      ]);
      return { leaves: leaveRes.data ?? [], drivers: driverRes.data ?? [], profiles: profileRes.data ?? [] };
    });
    if (result.data) {
      const cachedLeaves = Array.isArray(result.data.leaves) ? result.data.leaves : [];
      const cachedDrivers = Array.isArray(result.data.drivers) ? result.data.drivers : [];
      const cachedProfiles = Array.isArray(result.data.profiles) ? result.data.profiles : [];
      setLeaves(cachedLeaves);
      setDrivers(cachedDrivers);
      setProfiles(cachedProfiles);
      setManagers(cachedProfiles.filter((p) => getRoleAccessLevel(p.role) >= 4));
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useRealtimeSubscription('leave-page', isOffline ? [] : ['leave_periods', 'drivers', 'profiles'], loadAll);

  const allStaff: StaffMember[] = [
    ...drivers.map((d) => ({ ...d, kind: 'driver' as const })),
    ...profiles.map((p) => ({ ...p, kind: 'profile' as const })),
  ];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const isDriver = form.staff_type === 'driver';
    const isMaladie = form.status === 'maladie';
    const needsNote = isMaladie && !form.reason.trim();
    if (needsNote && !isTopDirector) {
      toast('Une note est requise pour une déclaration de maladie. Seul le directeur ou la directrice peut valider sans note.', 'error');
      return;
    }
    await supabase.from('leave_periods').insert({
      driver_id: isDriver ? form.staff_id : null,
      profile_id: !isDriver ? form.staff_id : null,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
      status: form.status,
      notified_to: form.notified_to || null,
      notification_status: form.notified_to ? 'notified' : 'pending',
    });
    setShowModal(false);
    setForm({ staff_type: '', staff_id: '', status: 'absent', start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: '', notified_to: '' });
    loadAll();
  };

  const handleApprove = async (id: string, approved: boolean) => {
    const { error } = await supabase.from('leave_periods').update({ notification_status: approved ? 'approved' : 'rejected' }).eq('id', id);
    if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
    loadAll();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ message: 'Supprimer cette déclaration ?', confirmLabel: 'Supprimer', danger: true }))) return;
    const { error } = await supabase.from('leave_periods').delete().eq('id', id);
    if (error) { toast('Erreur lors de la suppression.', 'error'); return; }
    loadAll();
  };

  const today = new Date().toISOString().slice(0, 10);
  const filtered = filterStatus === 'all' ? leaves : leaves.filter((l) => l.status === filterStatus);
  const activeLeaves = filtered.filter((l) => l.start_date <= today && l.end_date >= today);
  const upcomingLeaves = filtered.filter((l) => l.start_date > today);
  const pastLeaves = filtered.filter((l) => l.end_date < today);

  const getStaffName = (leave: LeavePeriod & { driver?: Driver; profile?: Profile }) =>
    leave.driver?.full_name ?? leave.profile?.full_name ?? '—';
  const getStaffRole = (leave: LeavePeriod & { driver?: Driver; profile?: Profile }) => {
    if (leave.driver) return 'Commercial';
    if (leave.profile) return ROLE_LABELS[leave.profile.role as UserRole];
    return '';
  };

  const renderGroup = (title: string, items: LeavePeriod[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-2 mt-4">{title}</h3>
        <div className="space-y-2">
          {items.map((leave) => {
            const isActive = leave.start_date <= today && leave.end_date >= today;
            const meta = LEAVE_STATUS_META[leave.status];
            const notifIcon = { pending: Bell, notified: Bell, approved: Check, rejected: XCircle }[leave.notification_status];
            const NotifIcon = notifIcon;
            const notifColor = { pending: 'text-gray-400', notified: 'text-blue-500', approved: 'text-emerald-500', rejected: 'text-red-500' }[leave.notification_status];
            return (
              <div key={leave.id} className={`bg-white rounded-2xl p-4 shadow-sm border ${meta.borderColor} flex items-center gap-4`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bgColor}`}>
                  <span className={`w-3 h-3 rounded-full ${meta.dot}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{getStaffName(leave)}</p>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{getStaffRole(leave)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span>{new Date(leave.start_date).toLocaleDateString('fr-FR')} → {new Date(leave.end_date).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.bgColor} ${meta.color}`}>
                      {meta.label}
                    </span>
                    {leave.notified_profile && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500`}>
                        <NotifIcon className={`w-3 h-3 ${notifColor}`} />
                        Notifié à {leave.notified_profile.full_name}
                      </span>
                    )}
                    {leave.reason && <span className="text-sm text-gray-500 italic">« {leave.reason} »</span>}
                  </div>
                </div>
                {isDirector && leave.notification_status === 'notified' && (
                  <div className="flex gap-1">
                    <button onClick={() => handleApprove(leave.id, true)}
                      className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 transition-colors" title="Approuver">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleApprove(leave.id, false)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors" title="Rejeter">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {canManage && (
                  <button onClick={() => handleDelete(leave.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const statusCounts = (['present', 'absent', 'conge_annuel', 'permission', 'day_off', 'maladie'] as LeaveStatus[]).map((s) => ({
    status: s,
    count: leaves.filter((l) => l.status === s && l.start_date <= today && l.end_date >= today).length,
  }));

  return (
    <div className="space-y-4">
      {/* Legend / status summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(['present', 'absent', 'conge_annuel', 'permission', 'day_off', 'maladie'] as LeaveStatus[]).map((s) => {
          const meta = LEAVE_STATUS_META[s];
          const count = statusCounts.find((c) => c.status === s)?.count ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
              className={`flex items-center gap-2.5 p-3 rounded-2xl border-2 transition-all ${filterStatus === s ? `${meta.bgColor} ${meta.borderColor} ring-2 ring-offset-1 ring-gray-200` : 'bg-white border-gray-100 hover:border-gray-200'}`}
            >
              <span className={`w-3 h-3 rounded-full ${meta.dot}`} />
              <div className="text-left">
                <p className={`text-xs font-medium ${meta.color}`}>{meta.label}</p>
                <p className="text-lg font-bold text-gray-900">{count}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        {activeLeaves.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">{activeLeaves.length} personne(s) absente(s) aujourd'hui</p>
              <p className="text-xs text-amber-700">{activeLeaves.map((l) => getStaffName(l)).join(', ')}</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {filterStatus !== 'all' && (
            <button onClick={() => setFilterStatus('all')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
              <Filter className="w-4 h-4" />
              Réinitialiser le filtre
            </button>
          )}
          {canManage && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
              <Plus className="w-5 h-5" />
              Nouvelle déclaration
            </button>
          )}
          <button onClick={() => onNavigate?.('scheduling')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors">
            <CalendarDays className="w-5 h-5" />
            Voir planning
          </button>
          <button onClick={() => onNavigate?.('attendance')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors">
            <UserCheck className="w-5 h-5" />
            Liste de présence
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && leaves.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les congés.</p>
        </div>
      ) : leaves.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Aucune déclaration enregistrée</div>
      ) : (
        <div>
          {renderGroup('En cours', activeLeaves)}
          {renderGroup('À venir', upcomingLeaves)}
          {renderGroup('Passés', pastLeaves)}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle déclaration</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employé</label>
                <select
                  required
                  value={form.staff_type ? `${form.staff_type}:${form.staff_id}` : ''}
                  onChange={(e) => {
                    const [type, id] = e.target.value.split(':');
                    setForm({ ...form, staff_type: type as 'driver' | 'profile', staff_id: id });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                >
                  <option value="">— Choisir —</option>
                  <optgroup label="Commerciaux">
                    {drivers.map((d) => <option key={d.id} value={`driver:${d.id}`}>{d.full_name}</option>)}
                  </optgroup>
                  <optgroup label="Personnel">
                    {profiles.map((p) => <option key={p.id} value={`profile:${p.id}`}>{p.full_name} ({ROLE_LABELS[p.role as UserRole]})</option>)}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <div className="grid grid-cols-1 gap-2">
                  {(['present', 'absent', 'conge_annuel', 'permission', 'day_off', 'maladie'] as LeaveStatus[]).map((s) => {
                    const meta = LEAVE_STATUS_META[s];
                    const needsNote = s === 'maladie' && !form.reason.trim();
                    const blocked = needsNote && !isTopDirector;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm({ ...form, status: s })}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 transition-all text-left ${form.status === s ? `${meta.bgColor} ${meta.borderColor}` : 'border-gray-100 hover:border-gray-200'}`}
                      >
                        <span className={`w-3 h-3 rounded-full ${meta.dot}`} />
                        <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
                        {blocked && <span className="ml-auto text-xs text-rose-500">note requise</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
                  <input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
                  <input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notifier à (Direction)</label>
                <select value={form.notified_to} onChange={(e) => setForm({ ...form, notified_to: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
                  <option value="">— Aucun —</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({ROLE_LABELS[m.role as UserRole]})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Raison {form.status === 'maladie' && !isTopDirector ? <span className="text-rose-500">(obligatoire pour maladie)</span> : '(optionnel)'}
                </label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Motif de l'absence…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
                {form.status === 'maladie' && !isTopDirector && !form.reason.trim() && (
                  <p className="mt-1 text-xs text-rose-500">Une note est requise pour la maladie. Seul le directeur ou la directrice peut valider sans note.</p>
                )}
              </div>

              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all">
                Créer la déclaration
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
