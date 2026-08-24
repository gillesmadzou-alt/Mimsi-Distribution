import { useEffect, useState, useCallback } from 'react';
import { supabase, WorkSchedule, SchedulePersonType, ScheduleStatus, SCHEDULE_PERSON_LABELS, SCHEDULE_STATUS_META, LeavePeriod, LeaveStatus, LEAVE_STATUS_META } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  CalendarDays, Plus, X, Clock, MapPin, ChevronLeft, ChevronRight,
  Truck, ChefHat, User, Loader2, Edit2, Trash2, Filter, Check, AlertTriangle, UserCheck, CloudOff,
} from 'lucide-react';

interface PersonOption {
  id: string;
  full_name: string;
  type: SchedulePersonType;
  profile_id: string | null;
}

const PERSON_ICONS: Record<SchedulePersonType, typeof Truck> = {
  driver: Truck,
  baker: ChefHat,
  kneader: User,
};

const PERSON_COLORS: Record<SchedulePersonType, string> = {
  driver: 'from-amber-400 to-orange-500',
  baker: 'from-rose-400 to-red-500',
  kneader: 'from-violet-400 to-purple-500',
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function weekStart(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = (day === 0 ? 6 : day - 1);
  r.setDate(r.getDate() - diff);
  return r;
}

export default function SchedulingPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { confirmDialog } = useConfirm();
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [leaves, setLeaves] = useState<LeavePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekRef, setWeekRef] = useState(weekStart(new Date()));
  const [filterType, setFilterType] = useState<SchedulePersonType | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<WorkSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const [form, setForm] = useState({
    person_type: 'driver' as SchedulePersonType,
    person_ids: [] as string[],
    work_date: formatDate(new Date()),
    start_time: '',
    end_time: '',
    zone: '',
    task: '',
    status: 'planifie' as ScheduleStatus,
    notes: '',
  });

  const canEdit = (profile?.role ?? 1) >= 2;

  // Check if a person is on leave on a given date
  const getLeaveFor = useCallback((personId: string, personType: SchedulePersonType, date: string): LeavePeriod | null => {
    const person = people.find((p) => p.id === personId);
    if (!person) return null;
    return leaves.find((l) => {
      if (l.start_date > date || l.end_date < date) return false;
      if (personType === 'driver') return l.driver_id === personId;
      // bakers and kneaders matched via profile_id
      return person.profile_id && l.profile_id === person.profile_id;
    }) ?? null;
  }, [people, leaves]);

  const loadPeople = useCallback(async () => {
    const result = await fetchWithCache<PersonOption[]>('scheduling_page_people', async () => {
      const [driversRes, bakersRes, kneadersRes] = await Promise.all([
        supabase.from('drivers').select('id, full_name').order('full_name'),
        supabase.from('bakers').select('id, full_name, profile_id').order('full_name'),
        supabase.from('kneaders').select('id, full_name, profile_id').order('full_name'),
      ]);
      const list: PersonOption[] = [
        ...(driversRes.data ?? []).map((d) => ({ id: d.id, full_name: d.full_name, type: 'driver' as const, profile_id: null })),
        ...(bakersRes.data ?? []).map((b) => ({ id: b.id, full_name: b.full_name, type: 'baker' as const, profile_id: b.profile_id })),
        ...(kneadersRes.data ?? []).map((k) => ({ id: k.id, full_name: k.full_name, type: 'kneader' as const, profile_id: k.profile_id })),
      ];
      return list;
    });
    if (result.data) setPeople(result.data);
  }, [fetchWithCache]);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    const start = formatDate(weekRef);
    const end = formatDate(addDays(weekRef, 6));
    const result = await fetchWithCache<{ schedules: WorkSchedule[]; leaves: LeavePeriod[] }>('scheduling_page', async () => {
      const [schedRes, leaveRes] = await Promise.all([
        supabase
          .from('work_schedules')
          .select('*')
          .gte('work_date', start)
          .lte('work_date', end)
          .order('work_date, start_time'),
        supabase
          .from('leave_periods')
          .select('*')
          .lte('start_date', end)
          .gte('end_date', start),
      ]);
      return { schedules: (schedRes.data as WorkSchedule[]) ?? [], leaves: (leaveRes.data as LeavePeriod[]) ?? [] };
    });
    if (result.data) {
      setSchedules(result.data.schedules);
      setLeaves(result.data.leaves);
    }
    setLoading(false);
  }, [weekRef, fetchWithCache]);

  useEffect(() => { loadPeople(); }, [loadPeople]);
  useEffect(() => { loadSchedules(); }, [loadSchedules]);
  useRealtimeSubscription('scheduling-page', isOffline ? [] : ['work_schedules', 'leave_periods', 'drivers', 'bakers', 'kneaders'], loadSchedules);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekRef, i));
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  const schedulesByDay = (date: string) =>
    schedules
      .filter((s) => s.work_date === date)
      .filter((s) => filterType === 'all' || s.person_type === filterType)
      .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

  const openCreate = (date?: string) => {
    setEditing(null);
    setForm({
      person_type: 'driver', person_ids: [], work_date: date ?? formatDate(new Date()),
      start_time: '', end_time: '', zone: '', task: '', status: 'planifie', notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (s: WorkSchedule) => {
    setEditing(s);
    setForm({
      person_type: s.person_type,
      person_ids: [s.person_id],
      work_date: s.work_date,
      start_time: s.start_time ?? '',
      end_time: s.end_time ?? '',
      zone: s.zone ?? '',
      task: s.task ?? '',
      status: s.status,
      notes: s.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.person_ids.length === 0) return;

    // Warn if any selected person is on leave on the chosen date
    const onLeave = form.person_ids
      .map((pid) => ({ pid, leave: getLeaveFor(pid, form.person_type, form.work_date) }))
      .filter((x) => x.leave);
    if (onLeave.length > 0) {
      const names = onLeave.map((x) => {
        const p = people.find((pp) => pp.id === x.pid);
        return p?.full_name ?? '?';
      }).join(', ');
      const leaveLabels = onLeave.map((x) => LEAVE_STATUS_META[x.leave!.status].label);
      if (!(await confirmDialog({
        message: `${names} est/sont en ${leaveLabels.join(', ')} le ${new Date(form.work_date).toLocaleDateString('fr-FR')}. Voulez-vous quand même programmer cette personne ?`,
        confirmLabel: 'Programmer quand même',
        danger: false,
      }))) {
        return;
      }
    }

    setSaving(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const basePayload = {
      person_type: form.person_type,
      work_date: form.work_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      zone: form.zone || null,
      task: form.task || null,
      status: form.status,
      notes: form.notes || null,
      created_by: userId,
    };

    if (editing) {
      const person = people.find((p) => p.id === form.person_ids[0]);
      await supabase.from('work_schedules').update({
        ...basePayload,
        person_id: form.person_ids[0],
        person_name: person?.full_name ?? editing.person_name,
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id);
    } else {
      const rows = form.person_ids.map((pid) => {
        const person = people.find((p) => p.id === pid);
        return { ...basePayload, person_id: pid, person_name: person?.full_name ?? '' };
      });
      await supabase.from('work_schedules').insert(rows);
    }
    setSaving(false);
    setShowModal(false);
    loadSchedules();
  };

  const handleDelete = async (s: WorkSchedule) => {
    if (!(await confirmDialog({ message: `Supprimer la programmation de ${s.person_name} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    await supabase.from('work_schedules').delete().eq('id', s.id);
    loadSchedules();
  };

  const statusOptions: ScheduleStatus[] = ['planifie', 'en_cours', 'termine', 'annule'];

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <button
            onClick={() => setWeekRef(addDays(weekRef, -7))}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-700 min-w-[140px] text-center">
            {weekDays[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            {' — '}
            {weekDays[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
          <button
            onClick={() => setWeekRef(addDays(weekRef, 7))}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={() => setWeekRef(weekStart(new Date()))}
            className="ml-1 px-3 py-2 rounded-lg text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            Aujourd'hui
          </button>
        </div>

        <div className="mobile-action-stack flex items-center gap-2 sm:w-auto sm:flex-row">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as SchedulePersonType | 'all')}
              className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none appearance-none"
            >
              <option value="all">Tous</option>
              {Object.entries(SCHEDULE_PERSON_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {canEdit && (
            <button
              onClick={() => openCreate()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all"
            >
              <Plus className="w-5 h-5" />
              Programmer
            </button>
          )}
          <button
            onClick={() => onNavigate?.('leave')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors"
          >
            <CalendarDays className="w-5 h-5" />
            Voir congés
          </button>
          <button
            onClick={() => onNavigate?.('attendance')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors"
          >
            <UserCheck className="w-5 h-5" />
            Présence
          </button>
        </div>
      </div>

      {/* Week grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : isOffline && schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les programmations.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
          {weekDays.map((day, i) => {
            const dateStr = formatDate(day);
            const daySchedules = schedulesByDay(dateStr);
            const isToday = dateStr === formatDate(new Date());
            // People on leave this day
            const dayLeaves = people
              .map((p) => ({ person: p, leave: getLeaveFor(p.id, p.type, dateStr) }))
              .filter((x) => x.leave && (filterType === 'all' || x.person.type === filterType));
            return (
              <div
                key={dateStr}
                className={`rounded-2xl border ${isToday ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100 bg-white'} flex flex-col min-h-[200px]`}
              >
                <div className={`px-3 py-2 rounded-t-2xl flex items-center justify-between ${isToday ? 'bg-amber-100/60' : 'bg-gray-50'}`}>
                  <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase">{dayNames[i]}</span>
                    <span className={`ml-1.5 text-sm font-bold ${isToday ? 'text-amber-700' : 'text-gray-800'}`}>
                      {day.getDate()}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => openCreate(dateStr)}
                      className="p-1 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="p-2 space-y-2 flex-1">
                  {daySchedules.length === 0 && dayLeaves.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-4">Aucune programmation</p>
                  )}
                  {dayLeaves.length > 0 && (
                    <div className="space-y-1 mb-1">
                      {dayLeaves.map(({ person, leave }) => {
                        const lMeta = LEAVE_STATUS_META[leave!.status];
                        return (
                          <div key={`leave-${person.id}`} className={`rounded-lg px-2 py-1 flex items-center gap-1.5 ${lMeta.bgColor}`}>
                            <AlertTriangle className="w-3 h-3 shrink-0 text-gray-500" />
                            <span className="text-[10px] font-medium text-gray-700 truncate flex-1">{person.full_name}</span>
                            <span className={`text-[9px] font-medium ${lMeta.color}`}>{lMeta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {daySchedules.map((s) => {
                    const Icon = PERSON_ICONS[s.person_type];
                    const meta = SCHEDULE_STATUS_META[s.status];
                    const personLeave = getLeaveFor(s.person_id, s.person_type, s.work_date);
                    return (
                      <div
                        key={s.id}
                        className={`rounded-xl p-2.5 border ${meta.bgColor} border-transparent group relative`}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${PERSON_COLORS[s.person_type]} flex items-center justify-center shrink-0`}>
                            <Icon className="w-3.5 h-3.5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">{s.person_name}</p>
                            <p className="text-[10px] text-gray-500">{SCHEDULE_PERSON_LABELS[s.person_type]}</p>
                          </div>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.bgColor} ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        {personLeave && (
                          <div className={`flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md ${LEAVE_STATUS_META[personLeave.status].bgColor}`}>
                            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                            <span className={`text-[9px] font-medium ${LEAVE_STATUS_META[personLeave.status].color}`}>
                              {LEAVE_STATUS_META[personLeave.status].label}
                            </span>
                          </div>
                        )}
                        {(s.start_time || s.end_time) && (
                          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-gray-600">
                            <Clock className="w-3 h-3" />
                            {s.start_time ? s.start_time.slice(0, 5) : '--:--'} → {s.end_time ? s.end_time.slice(0, 5) : '--:--'}
                          </div>
                        )}
                        {s.zone && (
                          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-600">
                            <MapPin className="w-3 h-3" /> {s.zone}
                          </div>
                        )}
                        {s.task && (
                          <p className="text-[10px] text-gray-600 mt-0.5 line-clamp-2">{s.task}</p>
                        )}
                        {canEdit && (
                          <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                            <button onClick={() => openEdit(s)} className="p-1 rounded text-gray-400 hover:text-amber-600 hover:bg-white/80 transition-colors">
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleDelete(s)} className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-white/80 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3 pt-2">
          {(['driver', 'baker', 'kneader'] as SchedulePersonType[]).map((type) => {
            const Icon = PERSON_ICONS[type];
            const count = schedules.filter((s) => s.person_type === type && (filterType === 'all' || filterType === type)).length;
            return (
              <div key={type} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${PERSON_COLORS[type]} flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{count}</p>
                  <p className="text-xs text-gray-500">{SCHEDULE_PERSON_LABELS[type]}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-amber-500" />
                {editing ? 'Modifier la programmation' : 'Nouvelle programmation'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de personnel</label>
                <select
                  value={form.person_type}
                  onChange={(e) => { setForm({ ...form, person_type: e.target.value as SchedulePersonType, person_ids: [] }); }}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                >
                  {Object.entries(SCHEDULE_PERSON_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    {editing ? 'Personne' : 'Personne(s)'}
                  </label>
                  {!editing && people.filter((p) => p.type === form.person_type).length > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, person_ids: people.filter((p) => p.type === form.person_type).map((p) => p.id) })}
                        className="text-xs font-medium text-amber-600 hover:text-amber-700"
                      >
                        Tout sélectionner
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, person_ids: [] })}
                        className="text-xs font-medium text-gray-400 hover:text-gray-600"
                      >
                        Effacer
                      </button>
                    </div>
                  )}
                </div>
                {!editing && (
                  <p className="text-xs text-gray-400 mb-2">Cochez une ou plusieurs personnes à programmer</p>
                )}
                <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {people.filter((p) => p.type === form.person_type).map((p) => {
                    const checked = form.person_ids.includes(p.id);
                    const personLeave = getLeaveFor(p.id, form.person_type, form.work_date);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${checked ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-amber-500 border-amber-500' : 'border-gray-300 bg-white'}`}>
                          {checked && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(e) => {
                            if (editing) {
                              setForm({ ...form, person_ids: e.target.checked ? [p.id] : [] });
                            } else {
                              setForm({
                                ...form,
                                person_ids: e.target.checked
                                  ? [...form.person_ids, p.id]
                                  : form.person_ids.filter((id) => id !== p.id),
                              });
                            }
                          }}
                        />
                        <span className="text-sm text-gray-700 flex-1">{p.full_name}</span>
                        {personLeave && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${LEAVE_STATUS_META[personLeave.status].bgColor} ${LEAVE_STATUS_META[personLeave.status].color} flex items-center gap-1`}>
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {LEAVE_STATUS_META[personLeave.status].label}
                          </span>
                        )}
                      </label>
                    );
                  })}
                  {people.filter((p) => p.type === form.person_type).length === 0 && (
                    <p className="px-3 py-4 text-xs text-gray-300 text-center">Aucune personne disponible</p>
                  )}
                </div>
                {form.person_ids.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">Sélectionnez au moins une personne</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={form.work_date}
                  onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure de début</label>
                  <input
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure de fin</label>
                  <input
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone (optionnel)</label>
                <input
                  value={form.zone}
                  onChange={(e) => setForm({ ...form, zone: e.target.value })}
                  placeholder="Centre-ville, Plateau…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tâche (optionnel)</label>
                <input
                  value={form.task}
                  onChange={(e) => setForm({ ...form, task: e.target.value })}
                  placeholder="Livraison Plateau, Pétrissage 500 madeleines…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ScheduleStatus })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{SCHEDULE_STATUS_META[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-5 h-5 animate-spin" />}
                {editing ? 'Enregistrer' : `Programmer${form.person_ids.length > 1 ? ` (${form.person_ids.length})` : ''}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
