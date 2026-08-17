import { useState, useEffect, useRef } from 'react';
import { MapPin, Crosshair, Loader2, X, AlertTriangle, LocateFixed } from 'lucide-react';

interface GeoPickerModalProps {
  open: boolean;
  initialLat: string;
  initialLng: string;
  onConfirm: (lat: string, lng: string) => void;
  onClose: () => void;
}

export default function GeoPickerModal({ open, initialLat, initialLng, onConfirm, onClose }: GeoPickerModalProps) {
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [status, setStatus] = useState<'idle' | 'locating' | 'found' | 'error' | 'denied'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setLat(initialLat);
      setLng(initialLng);
      setStatus(initialLat && initialLng ? 'found' : 'idle');
    }
  }, [open, initialLat, initialLng]);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setErrorMsg("La géolocalisation n'est pas supportée par ce navigateur.");
      return;
    }
    setStatus('locating');
    setErrorMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude.toFixed(6);
        const ln = pos.coords.longitude.toFixed(6);
        setLat(la);
        setLng(ln);
        setAccuracy(pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null);
        setStatus('found');
        setTimeout(() => onConfirm(la, ln), 600);
      },
      (err) => {
        if (err.code === 1) {
          setStatus('denied');
          setErrorMsg('Permission refusée. Autorisez la géolocalisation dans votre navigateur.');
        } else {
          setStatus('error');
          setErrorMsg(err.message || 'Impossible d\'obtenir votre position.');
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-[scaleIn_180ms_ease-out]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
              <LocateFixed className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Géolocalisation automatique</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visual indicator */}
        <div
          ref={mapRef}
          className="relative h-44 rounded-xl overflow-hidden mb-4 flex items-center justify-center"
          style={{
            background: 'repeating-linear-gradient(0deg,#f0fdfa,#f0fdfa 20px,#e0f7f4 20px,#e0f7f4 40px),repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(20,184,166,0.06) 20px,rgba(20,184,166,0.06) 40px)',
          }}
        >
          {status === 'found' && lat && lng ? (
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-teal-500/20 flex items-center justify-center animate-pulse">
                <MapPin className="w-6 h-6 text-teal-600" />
              </div>
              <p className="mt-2 text-sm font-medium text-teal-700">Position captée</p>
            </div>
          ) : status === 'locating' ? (
            <div className="flex flex-col items-center text-teal-600">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="mt-2 text-sm">Localisation en cours…</p>
            </div>
          ) : status === 'error' || status === 'denied' ? (
            <div className="flex flex-col items-center text-gray-400">
              <Crosshair className="w-8 h-8" />
              <p className="mt-2 text-sm">Position non captée</p>
              <p className="text-xs">Vous pouvez réessayer ci-dessous</p>
            </div>
          ) : (
            <div className="flex flex-col items-center text-gray-400">
              <Crosshair className="w-8 h-8" />
              <p className="mt-2 text-sm">Cliquez sur le bouton ci-dessous</p>
            </div>
          )}
        </div>

        {/* Status / error */}
        {status === 'denied' && (
          <div className="flex items-start gap-2 mb-3 p-3 rounded-xl bg-red-50 border border-red-100">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-start gap-2 mb-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">{errorMsg}</p>
          </div>
        )}

        {/* Coordinates display */}
        {lat && lng && status === 'found' && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">Latitude</p>
              <p className="text-sm font-semibold text-gray-900">{lat}</p>
            </div>
            <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">Longitude</p>
              <p className="text-sm font-semibold text-gray-900">{lng}</p>
            </div>
          </div>
        )}
        {accuracy != null && status === 'found' && (
          <p className="text-xs text-gray-400 mb-3">Précision: ±{accuracy} m</p>
        )}

        {/* Actions */}
          <button
            onClick={locate}
            disabled={status === 'locating'}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            {status === 'locating' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Crosshair className="w-5 h-5" />}
            {status === 'found'
              ? 'Re-localiser'
              : status === 'error' || status === 'denied'
              ? 'Réessayer la localisation'
              : 'Localiser ma position'}
          </button>
      </div>
    </div>
  );
}
