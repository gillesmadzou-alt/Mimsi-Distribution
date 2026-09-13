import { useState } from 'react';
import { X, Loader2, Clock, MapPin, AlertTriangle } from 'lucide-react';
import { DeliveryBatch, Driver } from '@/lib/supabase';
import { computeTourneeSuivi, TourneeSuivi } from '@/lib/tourneeSuivi';

function formatMinutes(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

export default function TourneeSuiviModal({
  batches,
  drivers,
  onClose,
}: {
  batches: DeliveryBatch[];
  drivers: Driver[];
  onClose: () => void;
}) {
  const [batchId, setBatchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TourneeSuivi | { error: string } | null>(null);

  const driverName = (id: string) => drivers.find((d) => d.id === id)?.full_name ?? '—';

  const run = async (id: string) => {
    setBatchId(id);
    setResult(null);
    if (!id) return;
    setLoading(true);
    const r = await computeTourneeSuivi(id);
    setResult(r);
    setLoading(false);
  };

  const sorted = [...batches].sort((a, b) => b.batch_date.localeCompare(a.batch_date));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Clock className="w-5 h-5 text-violet-600" /> Suivi de tournée</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500">
          Temps passé sur chaque point de vente (dans un rayon de 50 m) et temps écoulé entre deux livraisons, calculés après coup à partir de la tournée sélectionnée.
        </p>

        <select
          value={batchId}
          onChange={(e) => run(e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-violet-500"
        >
          <option value="">Sélectionnez une tournée</option>
          {sorted.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batch_code} — {driverName(b.driver_id)} — {new Date(b.batch_date).toLocaleDateString('fr-FR')}
            </option>
          ))}
        </select>

        {loading && (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-violet-500 animate-spin" /></div>
        )}

        {result && 'error' in result && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">{result.error}</div>
        )}

        {result && !('error' in result) && (
          <div className="space-y-3">
            {!result.historyAvailable && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Pas d'historique GPS pour cette tournée — le temps passé sur les points ne peut pas être calculé (fonctionne pour les tournées faites après le déploiement de cette fonctionnalité).</span>
              </div>
            )}
            {result.visits.map((v, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 flex items-center gap-1.5 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" /> {v.salesPointName}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(v.depositedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-right shrink-0 text-xs space-y-1">
                  <p className="text-gray-600">Depuis précédent : <span className="font-medium text-gray-900">{formatMinutes(v.minutesSincePrevious)}</span></p>
                  <p className="text-gray-600">Temps sur place : <span className="font-medium text-gray-900">{formatMinutes(v.dwellMinutes)}</span></p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
