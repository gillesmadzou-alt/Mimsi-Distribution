import { useSync } from '@/contexts/SyncContext';
import { CloudOff, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';

export default function SyncIndicator() {
  const { isOnline, syncStatus, pendingCount, syncNow } = useSync();

  if (syncStatus === 'syncing') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="hidden sm:inline">Synchronisation…</span>
      </div>
    );
  }

  // Offline indicator — non interactif (plus de bouton pour activer le mode hors‑ligne)
  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
        <CloudOff className="w-4 h-4" />
        <span className="hidden sm:inline">Hors‑ligne</span>
        {pendingCount > 0 && (
          <span className="ml-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {pendingCount}
          </span>
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
