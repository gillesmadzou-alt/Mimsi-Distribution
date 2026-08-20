import { useSync } from '@/contexts/SyncContext';
import { useAuth } from '@/contexts/AuthContext';
import { CloudOff, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function SyncIndicator() {
  const { isOnline, syncStatus, pendingCount, syncNow, lastSyncAt } = useSync();
  const { manualOffline } = useAuth();
  const [showDetail, setShowDetail] = useState(false);

  if (syncStatus === 'syncing') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="hidden sm:inline">Synchronisation…</span>
      </div>
    );
  }

  if (!isOnline || manualOffline) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200 hover:bg-amber-100 transition-colors"
        >
          <CloudOff className="w-4 h-4" />
          <span className="hidden sm:inline">Hors-ligne</span>
          {pendingCount > 0 && (
            <span className="ml-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {pendingCount}
            </span>
          )}
        </button>
        {showDetail && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-50">
            <p className="text-sm font-semibold text-gray-900 mb-1">Mode hors-ligne</p>
            <p className="text-xs text-gray-500 mb-2">
              {manualOffline
                ? 'Mode hors-ligne activé manuellement. Vos saisies sont enregistrées sur ce téléphone et seront envoyées automatiquement quand vous désactiverez le mode hors-ligne.'
                : 'Vos saisies sont enregistrées sur ce téléphone et seront envoyées automatiquement dès le retour de la connexion.'}
            </p>
            {pendingCount > 0 && (
              <p className="text-xs text-amber-700 font-medium">
                {pendingCount} opération{pendingCount > 1 ? 's' : ''} en attente de synchronisation
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <button
        onClick={() => syncNow()}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-50 text-orange-700 text-xs font-medium border border-orange-200 hover:bg-orange-100 transition-colors"
        title="Cliquer pour synchroniser maintenant"
      >
        <RefreshCw className="w-4 h-4" />
        <span className="hidden sm:inline">{pendingCount} en attente</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
      <CheckCircle2 className="w-4 h-4" />
      <span className="hidden sm:inline">Synchronisé</span>
    </div>
  );
}
