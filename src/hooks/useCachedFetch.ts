import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCachedPageData, cachePageData } from '@/lib/readCache';

interface FetchResult<T> {
  data: T | null;
  error: string | null;
  fromCache: boolean;
}

export function useOfflineFetch() {
  const { offlineMode, manualOffline } = useAuth();
  const isOffline = offlineMode || manualOffline;

  const fetchWithCache = useCallback(
    async <T>(page: string, fetcher: () => Promise<T>): Promise<FetchResult<T>> => {
      const actuallyOffline = isOffline || !navigator.onLine;

      if (actuallyOffline) {
        const cached = await getCachedPageData<T>(page);
        if (cached) {
          return { data: cached.data, error: null, fromCache: true };
        }
        return { data: null, error: 'Hors ligne — les données seront disponibles à la reconnexion.', fromCache: false };
      }

      try {
        const data = await fetcher();
        await cachePageData(page, data);
        return { data, error: null, fromCache: false };
      } catch {
        const cached = await getCachedPageData<T>(page);
        if (cached) {
          return { data: cached.data, error: null, fromCache: true };
        }
        return { data: null, error: 'Erreur de chargement. Vérifiez votre connexion.', fromCache: false };
      }
    },
    [isOffline],
  );

  return { fetchWithCache, isOffline };
}
