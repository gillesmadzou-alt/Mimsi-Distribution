import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, UserRole } from '@/lib/supabase';
import { cachePageData, getCachedPageData } from '@/lib/readCache';
import { enqueueJob } from '@/lib/offlineQueue';
import { brazzavilleToday } from '@/lib/brazzavilleTime';
import { Truck, Camera, RefreshCw, Check, LogOut, User, Loader2, SwitchCamera, LogIn, LogOut as LogOutIcon, Shield, Mail, Lock, Eye, EyeOff, Clock, ChevronDown } from 'lucide-react';

type Step = 'mode' | 'form' | 'photo' | 'success' | 'manual-arrival';
type CheckType = 'arrival' | 'departure';

interface KioskPerson {
  id: string;
  full_name: string;
  role: UserRole;
  type: 'profile' | 'driver' | 'baker' | 'kneader';
}

const kioskPersonPriority: Record<KioskPerson['type'], number> = {
  profile: 1,
  driver: 2,
  baker: 3,
  kneader: 4,
};

const normalisePersonName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');

function uniqueKioskPeople(items: KioskPerson[]): KioskPerson[] {
  const unique = new Map<string, KioskPerson>();
  [...items]
    .sort((a, b) => kioskPersonPriority[a.type] - kioskPersonPriority[b.type])
    .forEach((person) => {
      const key = normalisePersonName(person.full_name);
      if (key && !unique.has(key)) unique.set(key, person);
    });
  return [...unique.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'));
}

export default function KioskCheckIn() {
  const { signOut } = useAuth();
  const [step, setStep] = useState<Step>('mode');
  const [checkType, setCheckType] = useState<CheckType>('arrival');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [people, setPeople] = useState<KioskPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual arrival (DG/DGA)
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [manualShowPassword, setManualShowPassword] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [pointedAt, setPointedAt] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const today = brazzavilleToday();

  const loadPeople = useCallback(async () => {
    setPeopleLoading(true);
    try {
      if (!navigator.onLine) {
        const cached = await getCachedPageData<KioskPerson[]>('kiosk_people');
        setPeople(cached?.data ?? []);
        if (!cached?.data?.length) setError('La liste du personnel doit être chargée une première fois avec Internet.');
        return;
      }

      const { data, error: peopleError } = await supabase
        .from('kiosk_people')
        .select('id, full_name, role, person_type');
      if (peopleError) throw peopleError;
      const all: KioskPerson[] = (data ?? []).map((person: { id: string; full_name: string; role: UserRole; person_type: KioskPerson['type'] }) => ({
        id: person.id, full_name: person.full_name, role: person.role, type: person.person_type,
      }));
      const uniquePeople = uniqueKioskPeople(all);
      setPeople(uniquePeople);
      await cachePageData('kiosk_people', uniquePeople);
    } catch {
      setPeople([]);
      setError('Impossible de charger la liste du personnel. Vérifiez la connexion.');
    } finally {
      setPeopleLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null;

  const startCamera = async (mode: 'user' | 'environment') => {
    setCameraError(null);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(s);
      setFacingMode(mode);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {
      setCameraError("Impossible d'accéder à la caméra. Vérifiez les autorisations du navigateur.");
    }
  };

  useEffect(() => {
    if (step === 'photo' && !photoDataUrl) {
      startCamera(facingMode);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotoDataUrl(dataUrl);
    setPointedAt(new Date().toISOString());
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  const retakePhoto = () => {
    setPhotoDataUrl(null);
    setPointedAt(null);
    startCamera(facingMode);
  };

  const switchCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setPhotoDataUrl(null);
    setPointedAt(null);
    startCamera(next);
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) {
      setError('Veuillez sélectionner votre nom dans la liste.');
      return;
    }
    setError(null);

    setStep('photo');
  };

  const handleCheckIn = async () => {
    if (!photoDataUrl) return;
    setSaving(true);
    setError(null);

    try {
      const body = {
        action: checkType,
        personId: selectedPerson!.id,
        personType: selectedPerson!.type,
        photo: photoDataUrl,
        recordedAt: pointedAt ?? new Date().toISOString(),
      };
      if (!navigator.onLine) {
        await enqueueJob(
          `Pointage ${checkType === 'arrival' ? 'arrivée' : 'départ'} — ${selectedPerson!.full_name}`,
          'attendance',
          [{ id: crypto.randomUUID(), table: 'kiosk-checkin', operation: 'function', body }],
        );
        setStep('success');
        return;
      }
      const { data, error: checkinError } = await supabase.functions.invoke('kiosk-checkin', {
        body,
      });
      if (checkinError || !data?.success) throw new Error(data?.error ?? 'Pointage refusé.');

      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setSaving(false);
    }
  };

  // Manual arrival recording by DG/DGA
  const handleManualArrival = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualEmail || !manualPassword || !manualTime) {
      setError('Veuillez remplir tous les champs.');
      return;
    }

    setManualSaving(true);
    setError(null);

    try {
      if (!navigator.onLine) {
        setError('La borne nécessite une connexion Internet pour cette action.');
        setManualSaving(false);
        return;
      }
      // Authenticate as DG/DGA
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: manualEmail,
        password: manualPassword,
      });

      if (authError || !authData.user) {
        setError('Identifiants incorrects.');
        setManualSaving(false);
        return;
      }

      // Verify role is DG (5) or DGA (4)
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (!userProfile || (userProfile.role !== 4 && userProfile.role !== 5 && userProfile.role !== 6)) {
        setError("Seuls le DG et le DGA peuvent enregistrer une arrivée manuellement.");
        await supabase.auth.signOut();
        setManualSaving(false);
        return;
      }

      // Create the arrival record with manual time
      const { error: insertError } = await supabase.from('attendance_records').insert({
        person_id: selectedPerson!.id,
        person_name: selectedPerson!.full_name,
        person_role: selectedPerson!.role,
        person_type: selectedPerson!.type,
        attendance_date: today,
        arrival_time: manualTime + ':00',
        departure_time: null,
        status: 'present',
        notes: `Arrivée enregistrée manuellement par ${userProfile.full_name}`,
        recorded_by: authData.user.id,
        photo_url: null,
        departure_photo_url: null,
      });

      if (insertError) throw insertError;

      // Sign out the DG/DGA (kiosk stays anonymous)
      await supabase.auth.signOut();

      // Clear manual form
      setManualEmail('');
      setManualPassword('');
      setManualTime('');

      // Proceed to departure photo
      setCheckType('departure');
      setStep('photo');
    } catch {
      setError("Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setManualSaving(false);
    }
  };

  const resetKiosk = () => {
    stopCamera();
    setStep('mode');
    setCheckType('arrival');
    setSelectedPersonId('');
    setPhotoDataUrl(null);
    setPointedAt(null);
    setError(null);
    setManualEmail('');
    setManualPassword('');
    setManualTime('');
  };

  const goToForm = (type: CheckType) => {
    setCheckType(type);
    setStep('form');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shrink-0">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Pointage présence</h2>
            <p className="text-xs text-gray-500">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          title="Quitter"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full">

          {/* Step 0: Choose arrival or departure */}
          {step === 'mode' && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 mb-3">
                  <User className="w-7 h-7 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Pointage</h3>
                <p className="text-sm text-gray-500 mt-1">Que souhaitez-vous faire ?</p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => goToForm('arrival')}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3"
                >
                  <LogIn className="w-6 h-6" />
                  <div className="text-left">
                    <div className="font-bold">Arrivée</div>
                    <div className="text-xs opacity-90">Enregistrer mon arrivée du matin</div>
                  </div>
                </button>
                <button
                  onClick={() => goToForm('departure')}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3"
                >
                  <LogOutIcon className="w-6 h-6" />
                  <div className="text-left">
                    <div className="font-bold">Départ</div>
                    <div className="text-xs opacity-90">Enregistrer mon départ de la journée</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Identity form */}
          {step === 'form' && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
              <div className="text-center">
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 ${checkType === 'arrival' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  {checkType === 'arrival' ? (
                    <LogIn className="w-7 h-7 text-emerald-600" />
                  ) : (
                    <LogOutIcon className="w-7 h-7 text-amber-600" />
                  )}
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  {checkType === 'arrival' ? 'Arrivée — Identification' : 'Départ — Identification'}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {checkType === 'arrival'
                    ? 'Veuillez vous identifier avant de pointer votre arrivée.'
                    : 'Veuillez vous identifier avant de pointer votre départ.'}
                </p>
              </div>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sélectionnez votre nom</label>
                  {peopleLoading ? (
                    <div className="flex items-center justify-center py-3 text-gray-400">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  ) : (
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-600" />
                      <select
                        value={selectedPersonId}
                        onChange={(e) => setSelectedPersonId(e.target.value)}
                        disabled={people.length === 0}
                        className="kiosk-person-select w-full py-3 pl-11 pr-11 text-sm font-medium text-gray-800 disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">
                          {people.length === 0 ? 'Aucune personne disponible' : 'Choisissez vos nom et prénom'}
                        </option>
                        {people.map((p) => (
                          <option key={`${p.type}-${p.id}`} value={p.id}>
                            {p.full_name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-600" />
                    </div>
                  )}
                </div>
                {error && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className={`w-full py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${checkType === 'arrival' ? 'bg-gradient-to-r from-emerald-500 to-green-600' : 'bg-gradient-to-r from-amber-500 to-orange-600'}`}
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                  Prendre la photo
                </button>
              </form>

              {/* Manual arrival option when departure is refused */}
              {checkType === 'departure' && error && error.includes("Aucune arrivée") && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-100 mb-2">
                      <Shield className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">Enregistrer l'arrivée manuellement</p>
                    <p className="text-xs text-gray-500 mt-0.5">Réservé au DG et au DGA</p>
                  </div>
                  <button
                    onClick={() => { setError(null); setStep('manual-arrival'); }}
                    className="w-full py-2.5 rounded-xl bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <Clock className="w-4 h-4" />
                    Saisir l'heure d'arrivée (DG/DGA)
                  </button>
                </div>
              )}

              <button
                onClick={resetKiosk}
                className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Retour
              </button>
            </div>
          )}

          {/* Step: Manual arrival by DG/DGA */}
          {step === 'manual-arrival' && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-100 mb-3">
                  <Shield className="w-7 h-7 text-blue-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Arrivée manuelle</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Pour : <span className="font-medium text-gray-700">{selectedPerson?.full_name ?? ''}</span>
                </p>
              </div>

              <form onSubmit={handleManualArrival} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email DG/DGA</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                      placeholder="email@exemple.ci"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={manualShowPassword ? 'text' : 'password'}
                      value={manualPassword}
                      onChange={(e) => setManualPassword(e.target.value)}
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setManualShowPassword(!manualShowPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {manualShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure d'arrivée</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="time"
                      value={manualTime}
                      onChange={(e) => setManualTime(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={manualSaving}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {manualSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  Valider l'arrivée
                </button>
              </form>

              <button
                onClick={() => { setStep('form'); setError(null); }}
                disabled={manualSaving}
                className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Retour
              </button>
            </div>
          )}

          {/* Step 2: Photo capture */}
          {step === 'photo' && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
              <div className="text-center">
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 ${checkType === 'arrival' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  <Camera className={`w-7 h-7 ${checkType === 'arrival' ? 'text-emerald-600' : 'text-amber-600'}`} />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Photo obligatoire</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {checkType === 'arrival'
                    ? 'Prenez une photo pour confirmer votre arrivée.'
                    : 'Prenez une photo pour confirmer votre départ.'}
                </p>
              </div>

              <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3]">
                {!photoDataUrl ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={switchCamera}
                      className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                      title="Changer de caméra"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <img src={photoDataUrl} alt="Photo" className="w-full h-full object-cover" />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              {cameraError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{cameraError}</div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>
              )}

              {!photoDataUrl ? (
                <button
                  onClick={capturePhoto}
                  disabled={!!cameraError}
                  className={`w-full py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${checkType === 'arrival' ? 'bg-gradient-to-r from-emerald-500 to-green-600' : 'bg-gradient-to-r from-amber-500 to-orange-600'}`}
                >
                  <Camera className="w-5 h-5" />
                  Capturer la photo
                </button>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={handleCheckIn}
                    disabled={saving}
                    className={`w-full py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${checkType === 'arrival' ? 'bg-gradient-to-r from-emerald-500 to-green-600' : 'bg-gradient-to-r from-amber-500 to-orange-600'}`}
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    {checkType === 'arrival' ? 'Confirmer mon arrivée' : 'Confirmer mon départ'}
                  </button>
                  <button
                    onClick={retakePhoto}
                    disabled={saving}
                    className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reprendre la photo
                  </button>
                </div>
              )}

              <button
                onClick={resetKiosk}
                disabled={saving}
                className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Retour
              </button>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 'success' && (
            <div className="bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-2 ${checkType === 'arrival' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                <Check className={`w-10 h-10 ${checkType === 'arrival' ? 'text-emerald-600' : 'text-amber-600'}`} />
              </div>
              <h3 className="text-xl font-bold text-gray-900">
                {checkType === 'arrival' ? 'Arrivée enregistrée !' : 'Départ enregistré !'}
              </h3>
              <p className="text-gray-500">
                {selectedPerson?.full_name ?? ''}, votre {checkType === 'arrival' ? 'arrivée' : 'départ'} du{' '}
                {new Date().toLocaleDateString('fr-FR')} à{' '}
                {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}{' '}
                a bien été enregistrée.
              </p>
              <button
                onClick={resetKiosk}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-lg hover:shadow-xl transition-all"
              >
                Pointer une autre personne
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
