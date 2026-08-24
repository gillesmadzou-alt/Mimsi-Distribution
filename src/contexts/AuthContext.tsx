import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, Profile, UserRole } from '@/lib/supabase';
import { clearPageCache, getAllCachedData } from '@/lib/readCache';
import { precacheAllData, isPrecacheDone } from '@/lib/precache';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  kioskMode: boolean;
  offlineMode: boolean;
  manualOffline: boolean;
  setManualOffline: (v: boolean) => void;
  signIn: (email: string, password: string, selectedRole: number) => Promise<{ error: string | null }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>;
  enterKiosk: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_CACHE_KEY = 'mimsi_cached_profile';
const SESSION_CACHE_KEY = 'mimsi_cached_session';
const PWD_HASH_KEY = 'mimsi_cached_pwd_hash';
const ROLE_CACHE_KEY = 'mimsi_cached_role';

const PWD_SALT_KEY = 'mimsi_pwd_salt';
const PBKDF2_ITERATIONS = 200000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getOrCreateDeviceSalt(): string {
  try {
    const existing = localStorage.getItem(PWD_SALT_KEY);
    if (existing) return existing;
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(PWD_SALT_KEY, salt);
    return salt;
  } catch {
    return 'fallback_device_salt';
  }
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = getOrCreateDeviceSalt();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cacheProfile(profile: Profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch { /* ignore quota errors */ }
}

function getCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.id !== 'string') return null;
    parsed.role = Number(parsed.role);
    if (isNaN(parsed.role) || parsed.role < 1 || parsed.role > 16 || parsed.role === 15) return null;
    return parsed as Profile;
  } catch {
    return null;
  }
}

function cacheSession(session: Session) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

function getCachedSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) as Session : null;
  } catch {
    return null;
  }
}

function cachePwdHash(password: string) {
  hashPassword(password).then((hash) => {
    try { localStorage.setItem(PWD_HASH_KEY, hash); } catch { /* ignore */ }
  });
}

function getCachedPwdHash(): string | null {
  try { return localStorage.getItem(PWD_HASH_KEY); } catch { return null; }
}

function cacheRole(role: number) {
  try { localStorage.setItem(ROLE_CACHE_KEY, String(role)); } catch { /* ignore */ }
}

function getCachedRole(): number | null {
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    return raw ? Number(raw) : null;
  } catch { return null; }
}

function clearCache() {
  localStorage.removeItem(PROFILE_CACHE_KEY);
  localStorage.removeItem(SESSION_CACHE_KEY);
  localStorage.removeItem(PWD_HASH_KEY);
  localStorage.removeItem(ROLE_CACHE_KEY);
  localStorage.removeItem(PWD_SALT_KEY);
  clearPageCache();
}

function isSessionExpired(session: Session): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 < Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [kioskMode, setKioskMode] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [manualOffline, setManualOfflineState] = useState(() => {
    try { return localStorage.getItem('manual_offline') === 'true'; } catch { return false; }
  });
  const initDone = useRef(false);

  const setManualOffline = (v: boolean) => {
    setManualOfflineState(v);
    try { localStorage.setItem('manual_offline', String(v)); } catch {}
    if (v) setOfflineMode(true); else setOfflineMode(!navigator.onLine);
  };
  const manualOfflineRef = useRef(manualOffline);
  manualOfflineRef.current = manualOffline;
  const goOffline = (v: boolean) => { if (v || manualOfflineRef.current) setOfflineMode(true); else setOfflineMode(false); };

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      const cached = getCachedProfile();
      if (cached && cached.id === userId) return cached;
      return null;
    }



    cacheProfile(data);
    cacheRole(Number(data.role));
    return data;
  };

  useEffect(() => {
    const init = async () => {
      // When offline, skip the network call entirely and use cached session.
      if (!navigator.onLine) {
        const cachedSession = getCachedSession();
        if (cachedSession?.user && !isSessionExpired(cachedSession)) {
          setSession(cachedSession);
          setUser(cachedSession.user);
          const cachedProfile = getCachedProfile();
          if (cachedProfile) {
            setProfile(cachedProfile);
            setOfflineMode(true);
          }
        }
        initDone.current = true;
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        setSession(session);
        setUser(session.user);
        cacheSession(session);
        const prof = await fetchProfile(session.user.id);
        if (prof) {
          setProfile(prof);
        } else {
          const cached = getCachedProfile();
          if (cached) {
            setProfile(cached);
            setOfflineMode(true);
          }
        }
      } else {
        const cachedSession = getCachedSession();
        if (cachedSession?.user && !isSessionExpired(cachedSession)) {
          setSession(cachedSession);
          setUser(cachedSession.user);
          const cachedProfile = getCachedProfile();
          if (cachedProfile) {
            setProfile(cachedProfile);
            setOfflineMode(true);
          }
        }
      }

      initDone.current = true;
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && initDone.current) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        cacheSession(session);
        (async () => {
          const prof = await fetchProfile(session.user.id);
          if (prof) {
            setProfile(prof);
            goOffline(false);
            if (navigator.onLine) {
              (async () => {
                const needsPrecache = !isPrecacheDone() || Object.keys(await getAllCachedData()).length === 0;
                if (needsPrecache) precacheAllData(undefined, { id: prof.id, role: prof.role }).catch(() => {});
              })();
            }
          } else {
            const cached = getCachedProfile();
            if (cached) {
              setProfile(cached);
              setOfflineMode(true);
            }
          }
          setLoading(false);
        })();
      } else {
        setProfile(null);
        setKioskMode(false);
        clearCache();
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Revalidate when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      if (!manualOfflineRef.current) setOfflineMode(false);
      if (!user) return;
      const prof = await fetchProfile(user.id);
      if (prof) {
        setProfile(prof);
        if (navigator.onLine) {
          (async () => {
            const needsPrecache = !isPrecacheDone() || Object.keys(await getAllCachedData()).length === 0;
            if (needsPrecache) precacheAllData(undefined, { id: prof.id, role: prof.role }).catch(() => {});
          })();
        }
        if (!manualOfflineRef.current) goOffline(false);
      }
    };
    const handleOffline = () => {
      if (!manualOfflineRef.current) setOfflineMode(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user]);

  const signIn = async (email: string, password: string, selectedRole: number) => {
    if (!navigator.onLine) {
      const cachedSession = getCachedSession();
      const cachedProfile = getCachedProfile();
      const cachedPwdHash = getCachedPwdHash();
      const cachedRole = getCachedRole();

      if (cachedSession?.user && cachedProfile && cachedPwdHash && cachedRole !== null) {
        if (cachedSession.user.email !== email) {
          return { error: 'Hors ligne : cet email ne correspond pas à la dernière session enregistrée sur cet appareil.' };
        }
        if (cachedRole !== selectedRole) {
          return { error: 'Hors ligne : la fonction sélectionnée ne correspond pas à la dernière session enregistrée.' };
        }
        const inputHash = await hashPassword(password);
        if (!constantTimeEquals(inputHash, cachedPwdHash)) {
          return { error: 'Mot de passe incorrect.' };
        }
        if (isSessionExpired(cachedSession)) {
          return { error: 'Session expirée. Reconnectez-vous en ligne pour rafraîchir la session.' };
        }
        setSession(cachedSession);
        setUser(cachedSession.user);
        setProfile(cachedProfile);
        setOfflineMode(true);
        return { error: null };
      }

      return {
        error: 'Vous êtes hors ligne. Connectez-vous au moins une fois en ligne pour activer le mode hors ligne sur cet appareil.',
      };
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data.session) {
      const prof = await fetchProfile(data.session.user.id);
      if (!prof) {
        clearCache();
        setSession(null);
        setUser(null);
        setProfile(null);
        try { await supabase.auth.signOut(); } catch { /* ignore */ }
        setLoading(false);
        return {
          error: 'Connexion reconnue, mais votre profil utilisateur est introuvable ou inaccessible. Vérifiez que vous utilisez bien la version Mimsi mise à jour, puis réessayez.',
        };
      }
      if (prof.role !== selectedRole) {
        clearCache();
        setSession(null);
        setUser(null);
        setProfile(null);
        try { await supabase.auth.signOut(); } catch { /* ignore */ }
        setLoading(false);
        return {
          error: `La fonction sélectionnée ne correspond pas à ce compte. Sélectionnez « ${ROLE_LABELS[prof.role]} » puis réessayez.`,
        };
      }
      if (prof && prof.is_active === false) {
        clearCache();
        setLoading(false);
        try { await supabase.auth.signOut(); } catch { /* ignore */ }
        return { error: 'Ce compte est désactivé. Contactez un administrateur.' };
      }
      cacheSession(data.session);
      cachePwdHash(password);
      cacheRole(prof.role);
      goOffline(false);
      setSession(data.session);
      setUser(data.session.user);
      if (prof) {
        setProfile(prof);
        if (navigator.onLine) {
          (async () => {
            const needsPrecache = !isPrecacheDone() || Object.keys(await getAllCachedData()).length === 0;
            if (needsPrecache) precacheAllData(undefined, { id: prof.id, role: prof.role }).catch(() => {});
          })();
        }
      } else {
        const cached = getCachedProfile();
        if (cached) {
          setProfile(cached);
          setOfflineMode(true);
        }
      }
    }

    setLoading(false);
    if (error) {
      console.error('Sign-in failed:', error);
      return { error: 'Identifiants invalides. Vérifiez votre email et votre mot de passe.' };
    }
    return { error: null };
  };

  const enterKiosk = () => {
    setKioskMode(true);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!navigator.onLine || manualOffline) {
      return { error: 'La modification du mot de passe nécessite une connexion Internet.' };
    }
    if (!user?.email) return { error: 'Adresse e-mail du compte introuvable.' };
    if (newPassword.length < 8) return { error: 'Le nouveau mot de passe doit comporter au moins 8 caractères.' };

    const { error: verificationError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verificationError) return { error: 'Le mot de passe actuel est incorrect.' };

    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: 'Impossible de modifier le mot de passe. Réessayez.' };
    if (data.session) {
      cacheSession(data.session);
      setSession(data.session);
      setUser(data.session.user);
    }
    cachePwdHash(newPassword);
    return { error: null };
  };

  const signOut = async () => {
    setKioskMode(false);
    goOffline(false);
    setManualOfflineState(false);
    try { localStorage.removeItem('manual_offline'); } catch {}
    setSession(null);
    setUser(null);
    setProfile(null);
    clearCache();
    try {
      await supabase.auth.signOut();
    } catch {
      // Offline or network error — local state already cleared
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, kioskMode, offlineMode, manualOffline, setManualOffline, signIn, changePassword, enterKiosk, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
