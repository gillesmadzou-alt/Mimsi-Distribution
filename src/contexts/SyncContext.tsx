import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { getPendingJobs, processAllPending, countPendingJobs, registerBackgroundSync, QueuedJob } from '@/lib/offlineQueue';
import { useAuth } from '@/contexts/AuthContext';

type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

interface SyncContextValue {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  pendingJobs: QueuedJob[];
  syncNow: () => Promise<void>;
  lastSyncAt: Date | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { manualOffline } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine && !manualOffline);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(navigator.onLine && !manualOffline ? 'online' : 'offline');
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingJobs, setPendingJobs] = useState<QueuedJob[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const isSyncing = useRef(false);

  const refreshPending = useCallback(async () => {
    const jobs = await getPendingJobs();
    setPendingJobs(jobs);
    setPendingCount(jobs.length);
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || manualOffline) return;
    if (isSyncing.current) return;
    isSyncing.current = true;
    setSyncStatus('syncing');
    try {
      const result = await processAllPending();
      setLastSyncAt(new Date());
      await refreshPending();
      if (result.failed > 0) {
        setSyncStatus('error');
      } else {
        setSyncStatus('online');
      }
    } catch {
      setSyncStatus('error');
    } finally {
      isSyncing.current = false;
    }
  }, [refreshPending]);

  useEffect(() => {
    (async () => {
      await refreshPending();
      if (navigator.onLine) {
        const count = await countPendingJobs();
        if (count > 0) {
          syncNow();
          registerBackgroundSync();
        }
      }
    })();
  }, [refreshPending, syncNow]);

  // Background Sync API : le service worker réveille cet onglet (ou n'importe
  // quel autre onglet ouvert) dès que la connexion revient, sans attendre le
  // prochain tick du polling de 15s ci-dessous — utile quand l'onglet est en
  // arrière-plan et que le navigateur ralentit ses propres timers.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC_TRIGGER') syncNow();
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [syncNow]);

  useEffect(() => {
    setIsOnline(navigator.onLine && !manualOffline);
    setSyncStatus(navigator.onLine && !manualOffline ? 'online' : 'offline');
  }, [manualOffline]);

  useEffect(() => {
    const handleOnline = () => {
      if (manualOffline) return;
      setIsOnline(true);
      setSyncStatus('online');
      syncNow();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow, manualOffline]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshPending();
      if (navigator.onLine && !manualOffline && !isSyncing.current) {
        syncNow();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshPending, syncNow]);

  return (
    <SyncContext.Provider value={{ isOnline, syncStatus, pendingCount, pendingJobs, syncNow, lastSyncAt }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
