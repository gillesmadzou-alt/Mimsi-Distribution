import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  supabase, formatFCFA, ROLE_LABELS,
  type AttendanceRecord, type Profile, type Driver, type Baker, type Kneader, type UserRole,
  ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_META,
} from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import {
  LogIn, LogOut, Calendar, Users, Search, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Plane, CalendarOff, Trash2, Plus,
  TrendingUp, UserCheck, Link2, FileText, Camera, CloudOff, Image as ImageIcon, Clock, X, List,
} from 'lucide-react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import PhotoCaptureModal from '@/components/PhotoCaptureModal';

const EXEMPT_ROLES: UserRole[] = [];

interface Person {
  id: string;
  full_name: string;
  role: UserRole;
  type: 'profile' | 'driver' | 'baker' | 'kneader';
  status?: string;
}

export default function AttendancePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'photos'>('list');
  const [captureTarget, setCaptureTarget] = useState<{ personId: string; personName: string; type: 'arrival' | 'departure' } | null>(null);
  const [editingTime, setEditingTime] = useState<{ recordId: string; field: 'arrival_time' | 'departure_time'; value: string } | null>(null);
  const [photoModal, setPhotoModal] = useState<{ url: string; name: string; type: string } | null>(null);
  const [newPerson, setNewPerson] = useState<{ personId: string; arrival: string; departure: string; status: AttendanceRecord['status']; notes: string }>({
    personId: '', arrival: '', departure: '', status: 'present', notes: '',
  });

  const canDelete = profile && profile.role >= 4;
  const canManualEntry = profile && (profile.role === 4 || profile.role === 5 || profile.role === 6);
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadPeople = useCallback(async () => {
    const result = await fetchWithCache('attendance_people', async () => {
    const [profilesRes, driversRes, bakersRes, kneadersRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true),
      supabase.from('drivers').select('id, full_name, status'),
      supabase.from('bakers').select('id, full_name, status'),
      supabase.from('kneaders').select('id, full_name, status'),
    ]);

    const profilesList: Person[] = ((profilesRes.data as Profile[]) ?? [])
      .filter((p) => !EXEMPT_ROLES.includes(p.role))
      .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, type: 'profile' as const, status: p.is_active ? 'actif' : 'inactif' }));

    const driversList: Person[] = ((driversRes.data as Driver[]) ?? [])
      .filter((d) => d.status === 'actif')
      .map((d) => ({ id: d.id, full_name: d.full_name, role: 1 as UserRole, type: 'driver' as const, status: d.status }));

    const bakersList: Person[] = ((bakersRes.data as Baker[]) ?? [])
      .filter((b) => b.status === 'actif')
      .map((b) => ({ id: b.id, full_name: b.full_name, role: 9 as UserRole, type: 'baker' as const, status: b.status }));

    const kneadersList: Person[] = ((kneadersRes.data as Kneader[]) ?? [])
      .filter((k) => k.status === 'actif')
      .map((k) => ({ id: k.id, full_name: k.full_name, role: 8 as UserRole, type: 'kneader' as const, status: k.status }));

    const all = [...profilesList, ...driversList, ...bakersList, ...kneadersList];
    all.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return all;
    });
    if (result.data) setPeople(Array.isArray(result.data) ? result.data : []);
    else if (result.error) setLoadError('Erreur lors du chargement du personnel.');
  }, [fetchWithCache]);

  const loadRecords = useCallback(async () => {
    const result = await fetchWithCache(`attendance_records_${selectedDate}`, async () => {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('attendance_date', selectedDate)
        .order('arrival_time', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data as AttendanceRecord[]) ?? [];
    });
    if (result.data) setRecords(Array.isArray(result.data) ? result.data : []);
    else if (result.error) setLoadError('Erreur lors du chargement des pointages.');
  }, [fetchWithCache, selectedDate]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadPeople(), loadRecords()]);
      setLoading(false);
    })();
  }, [loadPeople, loadRecords]);

  useRealtimeSubscription('attendance-page', isOffline ? [] : ['attendance_records', 'profiles'], () => {
    loadPeople();
    loadRecords();
  });

  const recordsByPerson = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) map.set(r.person_id, r);
    return map;
  }, [records]);

  const filteredPeople = useMemo(() => {
    let list = people;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.full_name.toLowerCase().includes(q) || ROLE_LABELS[p.role].toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') {
      list = list.filter((p) => {
        const rec = recordsByPerson.get(p.id);
        const status = rec?.status ?? 'absent';
        return status === filterStatus;
      });
    }
    return list;
  }, [people, search, filterStatus, recordsByPerson]);

  const stats = useMemo(() => {
    const present = records.filter((r) => r.status === 'present').length;
    const retard = records.filter((r) => r.status === 'retard').length;
    const absent = people.length - records.filter((r) => r.status !== 'absent').length;
    const conge = records.filter((r) => r.status === 'conge').length;
    const mission = records.filter((r) => r.status === 'mission').length;
    return { present, retard, absent: Math.max(0, absent), conge, mission, total: people.length };
  }, [records, people.length]);

  const recordAttendance = async (person: Person, status: AttendanceRecord['status']) => {
    const existing = recordsByPerson.get(person.id);

    if (existing) {
      const update: Record<string, unknown> = { status };
      if (status === 'absent') {
        update.arrival_time = null;
        update.departure_time = null;
      }
      const { error } = await supabase.from('attendance_records').update(update).eq('id', existing.id);
      if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
    } else {
      const { error } = await supabase.from('attendance_records').insert({
        person_id: person.id,
        person_name: person.full_name,
        person_role: person.role,
        person_type: person.type,
        attendance_date: selectedDate,
        arrival_time: null,
        departure_time: null,
        status,
        notes: null,
        recorded_by: profile?.id ?? null,
      });
      if (error) { toast('Erreur lors de l enregistrement.', 'error'); return; }
    }
    loadRecords();
  };

  const uploadAttendancePhoto = async (photoDataUrl: string, type: 'arrival' | 'departure'): Promise<string | null> => {
    const fileName = `attendance/${selectedDate}/${type}-${Date.now()}.jpg`;
    const base64 = photoDataUrl.split(',')[1];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { error: uploadError } = await supabase.storage
      .from('attendance-photos')
      .upload(fileName, bytes, { contentType: 'image/jpeg' });
    return uploadError ? null : fileName;
  };

  const recordArrival = async (personId: string, photoDataUrl?: string) => {
    const existing = recordsByPerson.get(personId);
    if (!existing) return;
    const timeStr = new Date().toTimeString().slice(0, 5);
    const update: Record<string, unknown> = { arrival_time: timeStr };
    if (photoDataUrl) {
      const photoPath = await uploadAttendancePhoto(photoDataUrl, 'arrival');
      if (photoPath) update.photo_url = photoPath;
    }
    const { error } = await supabase.from('attendance_records')
      .update(update)
      .eq('id', existing.id);
    if (error) { toast('Erreur lors de l enregistrement.', 'error'); return; }
    loadRecords();
  };

  const recordDeparture = async (personId: string, photoDataUrl?: string) => {
    const existing = recordsByPerson.get(personId);
    if (!existing) return;
    const timeStr = new Date().toTimeString().slice(0, 5);
    const update: Record<string, unknown> = { departure_time: timeStr };
    if (photoDataUrl) {
      const photoPath = await uploadAttendancePhoto(photoDataUrl, 'departure');
      if (photoPath) update.departure_photo_url = photoPath;
    }
    const { error: depErr } = await supabase.from('attendance_records')
      .update(update)
      .eq('id', existing.id);
    if (depErr) { toast('Erreur lors de l enregistrement.', 'error'); return; }
    loadRecords();
  };

  const handlePhotoCapture = async (photoDataUrl: string) => {
    if (!captureTarget) return;
    const { personId, type } = captureTarget;
    setCaptureTarget(null);
    if (type === 'arrival') {
      await recordArrival(personId, photoDataUrl);
    } else {
      await recordDeparture(personId, photoDataUrl);
    }
    toast(`Pointage ${type === 'arrival' ? 'd\'arrivée' : 'de départ'} enregistré avec photo.`, 'success');
  };

  const updateTime = async (recordId: string, field: 'arrival_time' | 'departure_time', value: string) => {
    const { error } = await supabase.from('attendance_records')
      .update({ [field]: value || null })
      .eq('id', recordId);
    if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
    loadRecords();
  };

  const deleteRecord = async (id: string) => {
    const { error } = await supabase.from('attendance_records').delete().eq('id', id);
    if (error) { toast('Erreur lors de la suppression.', 'error'); return; }
    loadRecords();
  };

  const addManualRecord = async () => {
    if (!newPerson.personId) return;
    const person = people.find((p) => p.id === newPerson.personId);
    if (!person) return;
    const existing = recordsByPerson.get(person.id);
    if (existing) {
      const { error } = await supabase.from('attendance_records').update({
        arrival_time: newPerson.arrival || null,
        departure_time: newPerson.departure || null,
        status: newPerson.status,
        notes: newPerson.notes || null,
      }).eq('id', existing.id);
      if (error) { toast('Erreur lors de la mise à jour.', 'error'); return; }
    } else {
      const { error } = await supabase.from('attendance_records').insert({
        person_id: person.id,
        person_name: person.full_name,
        person_role: person.role,
        person_type: person.type,
        attendance_date: selectedDate,
        arrival_time: newPerson.arrival || null,
        departure_time: newPerson.departure || null,
        status: newPerson.status,
        notes: newPerson.notes || null,
        recorded_by: profile?.id ?? null,
      });
    }
    setShowAddModal(false);
    setNewPerson({ personId: '', arrival: '', departure: '', status: 'present', notes: '' });
    loadRecords();
  };

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = selectedDate === todayStr;

  const photoUrl = (path: string) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/attendance-photos/${path}`;
  const calcWorkedDuration = (arrival: string | null, departure: string | null) => {
    if (!arrival || !departure) return null;
    const [ah, am] = arrival.slice(0, 5).split(':').map(Number);
    const [dh, dm] = departure.slice(0, 5).split(':').map(Number);
    const totalMin = (dh * 60 + dm) - (ah * 60 + am);
    if (totalMin <= 0) return null;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        {loadError ? (
          <div className="text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3">{loadError}</div>
        ) : (
          <span className="text-gray-400">Chargement…</span>
        )}
      </div>
    );
  }

  if (isOffline && people.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 flex flex-col items-center gap-2">
        <CloudOff className="w-12 h-12 text-gray-300" />
        <p>Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le personnel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-blue-500" />
          Liste de présence
        </h2>
        <div className="flex items-center gap-2">
          {onNavigate && (
            <>
              <button
                onClick={() => onNavigate('leave')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors"
              >
                <CalendarOff className="w-3.5 h-3.5" />
                Congés
              </button>
              <button
                onClick={() => onNavigate('scheduling')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                Planning
              </button>
              <button
                onClick={() => onNavigate('reports')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                Rapports
              </button>
            </>
          )}
        </div>
      </div>

      {/* Date selector */}
      <div className="flex items-center justify-center gap-3 bg-white rounded-xl border border-gray-200 p-3">
        <button onClick={() => changeDay(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="flex items-center gap-2 min-w-[200px] justify-center">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none cursor-pointer"
          />
        </div>
        <button onClick={() => changeDay(1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
        {!isToday && (
          <button
            onClick={() => setSelectedDate(todayStr)}
            className="ml-2 px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            Aujourd'hui
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        <StatCard label="Total" value={stats.total} icon={<Users className="w-4 h-4" />} color="text-gray-700" bg="bg-gray-100" />
        <StatCard label="Présents" value={stats.present} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="En retard" value={stats.retard} icon={<AlertCircle className="w-4 h-4" />} color="text-amber-700" bg="bg-amber-50" />
        <StatCard label="Absents" value={stats.absent} icon={<XCircle className="w-4 h-4" />} color="text-red-700" bg="bg-red-50" />
        <StatCard label="Congés" value={stats.conge} icon={<CalendarOff className="w-4 h-4" />} color="text-blue-700" bg="bg-blue-50" />
        <StatCard label="Mission" value={stats.mission} icon={<Plane className="w-4 h-4" />} color="text-purple-700" bg="bg-purple-50" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px] bg-white rounded-xl border border-gray-200 px-3 py-2">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Rechercher une personne…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white outline-none cursor-pointer"
        >
          <option value="all">Tous les statuts</option>
          <option value="present">Présents</option>
          <option value="retard">En retard</option>
          <option value="absent">Absents</option>
          <option value="conge">En congé</option>
          <option value="mission">En mission</option>
        </select>
        {canManualEntry && (
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Saisie manuelle
        </button>
        )}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
        <button
          onClick={() => setViewMode('list')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <List className="w-3.5 h-3.5" />
          Liste
        </button>
        <button
          onClick={() => setViewMode('photos')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === 'photos' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Camera className="w-3.5 h-3.5" />
          Photos
        </button>
      </div>

      {/* Attendance list */}
      <div className="space-y-2">
        {filteredPeople.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Aucune personne trouvée</div>
        )}
        {viewMode === 'photos' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPeople.filter(p => recordsByPerson.get(p.id)?.photo_url || recordsByPerson.get(p.id)?.departure_photo_url).length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-400 text-sm">Aucune photo de pointage pour cette date</div>
            )}
            {filteredPeople.map((person) => {
              const rec = recordsByPerson.get(person.id);
              if (!rec || (!rec.photo_url && !rec.departure_photo_url)) return null;
              const status = rec.status;
              const meta = ATTENDANCE_STATUS_META[status];
              return (
                <div key={`photo-${person.type}-${person.id}`} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-50">
                    <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <p className="text-sm font-medium text-gray-900 truncate flex-1">{person.full_name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.bgColor} ${meta.color}`}>{meta.label}</span>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-gray-50">
                    <button
                      onClick={() => rec.photo_url && setPhotoModal({ url: photoUrl(rec.photo_url!), name: person.full_name, type: 'arrivée' })}
                      className="relative aspect-square bg-gray-50 hover:bg-gray-100 transition-colors group"
                      disabled={!rec.photo_url}
                    >
                      {rec.photo_url ? (
                        <>
                          <img src={photoUrl(rec.photo_url)} alt={`Arrivée ${person.full_name}`} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 flex items-center gap-1">
                            <LogIn className="w-3 h-3 text-white" />
                            <span className="text-xs text-white font-medium">{rec.arrival_time?.slice(0,5) ?? '—'}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-gray-300">
                          <LogIn className="w-6 h-6" />
                          <span className="text-xs">Pas d'arrivée</span>
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => rec.departure_photo_url && setPhotoModal({ url: photoUrl(rec.departure_photo_url!), name: person.full_name, type: 'départ' })}
                      className="relative aspect-square bg-gray-50 hover:bg-gray-100 transition-colors group"
                      disabled={!rec.departure_photo_url}
                    >
                      {rec.departure_photo_url ? (
                        <>
                          <img src={photoUrl(rec.departure_photo_url)} alt={`Départ ${person.full_name}`} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 flex items-center gap-1">
                            <LogOut className="w-3 h-3 text-white" />
                            <span className="text-xs text-white font-medium">{rec.departure_time?.slice(0,5) ?? '—'}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-gray-300">
                          <LogOut className="w-6 h-6" />
                          <span className="text-xs">Pas de départ</span>
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="space-y-2">
        {filteredPeople.map((person) => {
          const rec = recordsByPerson.get(person.id);
          const status = rec?.status ?? 'absent';
          const meta = ATTENDANCE_STATUS_META[status];

          return (
            <div key={`${person.type}-${person.id}`} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
              {/* Avatar / status dot */}
              <div className="relative shrink-0">
                {rec?.photo_url ? (
                  <button onClick={() => setPhotoModal({ url: photoUrl(rec.photo_url!), name: person.full_name, type: 'arrivée' })} className="block">
                    <img
                      src={photoUrl(rec.photo_url!)}
                      alt={person.full_name}
                      className="w-10 h-10 rounded-full object-cover border border-gray-200 hover:opacity-80 transition-opacity cursor-pointer"
                    />
                  </button>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center text-sm font-bold text-blue-700">
                    {person.full_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${meta.dot}`} />
              </div>

              {/* Name & role */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{person.full_name}</p>
                <p className="text-xs text-gray-500">{ROLE_LABELS[person.role]}</p>
              </div>

              {/* Times */}
              <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 shrink-0">
                {rec?.arrival_time ? (
                  <button
                    onClick={() => setEditingTime({ recordId: rec.id, field: 'arrival_time', value: rec.arrival_time!.slice(0, 5) })}
                    className="flex items-center gap-1 hover:text-blue-600 hover:underline transition-colors"
                    title="Modifier l'heure d'arrivée"
                  >
                    <LogIn className="w-3.5 h-3.5 text-emerald-500" />
                    {rec.arrival_time.slice(0, 5)}
                  </button>
                ) : (
                  (rec && (rec.status === 'present' || rec.status === 'retard')) && (
                    <span className="flex items-center gap-1 text-gray-300">
                      <LogIn className="w-3.5 h-3.5" />
                      —
                    </span>
                  )
                )}
                {rec?.departure_time ? (
                  <button
                    onClick={() => setEditingTime({ recordId: rec.id, field: 'departure_time', value: rec.departure_time!.slice(0, 5) })}
                    className="flex items-center gap-1 hover:text-blue-600 hover:underline transition-colors"
                    title="Modifier l'heure de départ"
                  >
                    <LogOut className="w-3.5 h-3.5 text-red-500" />
                    {rec.departure_time.slice(0, 5)}
                  </button>
                ) : (
                  (rec && (rec.status === 'present' || rec.status === 'retard') && rec.arrival_time) && (
                    <span className="flex items-center gap-1 text-gray-300">
                      <LogOut className="w-3.5 h-3.5" />
                      —
                    </span>
                  )
                )}
                {rec && calcWorkedDuration(rec.arrival_time, rec.departure_time) && (
                  <span className="flex items-center gap-1 text-gray-400">
                    <Clock className="w-3 h-3" />
                    {calcWorkedDuration(rec.arrival_time, rec.departure_time)}
                  </span>
                )}
                {rec?.departure_photo_url && (
                  <button
                    onClick={() => setPhotoModal({ url: photoUrl(rec.departure_photo_url!), name: person.full_name, type: 'départ' })}
                    className="shrink-0"
                    title="Photo de départ"
                  >
                    <img
                      src={photoUrl(rec.departure_photo_url!)}
                      alt={`Départ de ${person.full_name}`}
                      className="w-8 h-8 rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity cursor-pointer"
                    />
                  </button>
                )}
              </div>

              {/* Status badge */}
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${meta.bgColor} ${meta.color} shrink-0`}>
                {meta.label}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {isToday && !rec && (
                  <>
                    <button
                      onClick={() => recordAttendance(person, 'present')}
                      className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title="Marquer présent"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => recordAttendance(person, 'retard')}
                      className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                      title="Marquer en retard"
                    >
                      <AlertCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => recordAttendance(person, 'absent')}
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                      title="Marquer absent"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => recordAttendance(person, 'conge')}
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                      title="En congé"
                    >
                      <CalendarOff className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => recordAttendance(person, 'mission')}
                      className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 transition-colors"
                      title="En mission"
                    >
                      <Plane className="w-4 h-4" />
                    </button>
                  </>
                )}
                {isToday && canManualEntry && rec && (rec.status === 'present' || rec.status === 'retard') && !rec.arrival_time && (
                  <button
                    onClick={() => setCaptureTarget({ personId: person.id, personName: person.full_name, type: 'arrival' })}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Arrivée
                  </button>
                )}
                {isToday && canManualEntry && rec && (rec.status === 'present' || rec.status === 'retard') && rec.arrival_time && !rec.departure_time && (
                  <button
                    onClick={() => setCaptureTarget({ personId: person.id, personName: person.full_name, type: 'departure' })}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Départ
                  </button>
                )}
                {canDelete && rec && (
                  <button
                    onClick={() => deleteRecord(rec.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        </div>
        )}

      </div>

      {/* Photo modal */}
      {photoModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setPhotoModal(null)}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-bold text-gray-900">{photoModal.name}</p>
                <p className="text-xs text-gray-500">Photo de {photoModal.type}</p>
              </div>
              <button
                onClick={() => setPhotoModal(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <img
                src={photoModal.url}
                alt={`${photoModal.type} de ${photoModal.name}`}
                className="w-full rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* Time edit modal */}
      {editingTime && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingTime(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-xs w-full p-5 space-y-4 animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              {editingTime.field === 'arrival_time' ? (
                <LogIn className="w-5 h-5 text-emerald-500" />
              ) : (
                <LogOut className="w-5 h-5 text-red-500" />
              )}
              {editingTime.field === 'arrival_time' ? 'Heure d\'arrivée' : 'Heure de départ'}
            </h3>
            <input
              type="time"
              value={editingTime.value}
              onChange={(e) => setEditingTime({ ...editingTime, value: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setEditingTime(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  updateTime(editingTime.recordId, editingTime.field, editingTime.value);
                  setEditingTime(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual entry modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4 animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-500" />
              Saisie manuelle
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Personne</label>
                <select
                  value={newPerson.personId}
                  onChange={(e) => setNewPerson({ ...newPerson, personId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Sélectionner…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name} — {ROLE_LABELS[p.role]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Heure d'arrivée</label>
                  <input
                    type="time"
                    value={newPerson.arrival}
                    onChange={(e) => setNewPerson({ ...newPerson, arrival: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Heure de départ</label>
                  <input
                    type="time"
                    value={newPerson.departure}
                    onChange={(e) => setNewPerson({ ...newPerson, departure: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Statut</label>
                <select
                  value={newPerson.status}
                  onChange={(e) => setNewPerson({ ...newPerson, status: e.target.value as AttendanceRecord['status'] })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                >
                  {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceRecord['status'][]).map((s) => (
                    <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Note (optionnel)</label>
                <input
                  type="text"
                  value={newPerson.notes}
                  onChange={(e) => setNewPerson({ ...newPerson, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={addManualRecord}
                disabled={!newPerson.personId}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      <PhotoCaptureModal
        open={captureTarget !== null}
        title={captureTarget?.personName ?? ''}
        subtitle={captureTarget?.type === 'arrival' ? 'Photo d\'arrivée' : 'Photo de départ'}
        accentColor={captureTarget?.type === 'arrival' ? 'emerald' : 'red'}
        onClose={() => setCaptureTarget(null)}
        onCapture={handlePhotoCapture}
      />
    </div>
  );
}

function StatCard({ label, value, icon, color, bg }: { label: string; value: number; icon: React.ReactNode; color: string; bg: string }) {
  return (
    <div className={`rounded-xl ${bg} p-3 flex items-center gap-2`}>
      <div className={`${color}`}>{icon}</div>
      <div>
        <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
