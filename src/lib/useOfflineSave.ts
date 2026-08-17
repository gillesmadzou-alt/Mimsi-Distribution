import { enqueueJob, buildSteps, QueueStep, isOnline, executeStep } from '@/lib/offlineQueue';
import { supabase } from './supabase';
import { useSync } from '@/contexts/SyncContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCallback } from 'react';

export function useOfflineSave() {
  const { syncNow } = useSync();
  const { manualOffline } = useAuth();

  const save = useCallback(
    async (
      label: string,
      page: string,
      steps: QueueStep[],
      onAfterSync?: () => void,
    ): Promise<{ queued: boolean; offline: boolean; error?: string }> => {
      const offline = !isOnline() || manualOffline;

      if (offline) {
        try {
          await enqueueJob(label, page, steps);
          if (onAfterSync) onAfterSync();
          return { queued: true, offline: true };
        } catch (err) {
          return { queued: false, offline: true, error: err instanceof Error ? err.message : 'Erreur de sauvegarde hors ligne' };
        }
      }

      try {
        const results = new Map<string, unknown>();
        for (const step of steps) {
          const result = await executeStep(step, results);
          if (step.selectSingle) {
            results.set(step.id, result);
          }
        }
        if (onAfterSync) onAfterSync();
        return { queued: false, offline: false };
      } catch (err) {
        try {
          await enqueueJob(label, page, steps);
          syncNow();
          return { queued: true, offline: false, error: err instanceof Error ? err.message : 'Sauvegarde reportée' };
        } catch (queueErr) {
          return { queued: false, offline: false, error: queueErr instanceof Error ? queueErr.message : 'Erreur de sauvegarde' };
        }
      }
    },
    [syncNow],
  );

  return { save };
}

export { buildSteps };
