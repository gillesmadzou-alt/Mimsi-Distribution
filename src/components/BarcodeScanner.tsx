import { useRef, useState, useEffect, useCallback } from 'react';
import { ScanLine, X, CheckCircle2, Camera, Loader2, Keyboard, RotateCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
  /** Target number of scans; if set, scanner stays open until target reached and shows progress. */
  targetCount?: number;
  /** Current number of already-scanned codes (for progress display). */
  scannedCount?: number;
  /** Called when user removes a previously scanned code (not used in single mode). */
  onRemoveLast?: () => void;
}

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string | null }[]>;
};

const SUPPORTED_FORMATS = [
  'code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8',
  'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'pdf417', 'aztec',
];

function getNativeBarcodeDetector(): BarcodeDetectorLike | null {
  const w = window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike };
  if (typeof w.BarcodeDetector !== 'function') return null;
  try {
    return new w.BarcodeDetector({ formats: SUPPORTED_FORMATS });
  } catch {
    return null;
  }
}

export default function BarcodeScanner({ onScan, onClose, targetCount, scannedCount = 0, onRemoveLast }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastScannedRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [suggestions, setSuggestions] = useState<{ code: string; pot_type_name: string | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isContinuous = targetCount != null && targetCount > 0;

  // Debounced autocomplete: search barcodes by code prefix
  useEffect(() => {
    const query = manualCode.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('barcodes')
        .select('code, pot_type:pot_types(name)')
        .ilike('code', `${query}%`)
        .limit(8);
      if (data) {
        setSuggestions(data.map((d: any) => ({
          code: d.code,
          pot_type_name: d.pot_type?.name ?? null,
        })));
        setShowSuggestions(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [manualCode]);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const handleResult = useCallback(
    (text: string) => {
      const now = Date.now();
      // Debounce: ignore same code scanned within 2 seconds
      if (lastScannedRef.current === text && now - lastScanTimeRef.current < 2000) return;
      lastScannedRef.current = text;
      lastScanTimeRef.current = now;
      setLastScanned(text);

      onScan(text);

      // In continuous mode, keep camera running for next scan
      if (!isContinuous) {
        stop();
      }
    },
    [onScan, stop, isContinuous],
  );

  const tick = useCallback(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    detector
      .detect(video)
      .then((results) => {
        for (const r of results) {
          if (r.rawValue) {
            handleResult(r.rawValue);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        rafRef.current = requestAnimationFrame(tick);
      });
  }, [handleResult]);

  const startCamera = useCallback(async () => {
    setStarting(true);
    setError(null);
    setLastScanned(null);

    const video = videoRef.current;
    if (!video) {
      setStarting(false);
      return;
    }

    // Stop any existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Try to get camera stream with back camera preferred
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'environment' } },
        audio: false,
      });
    } catch {
      // Fallback: without exact constraint (some browsers don't support facingMode.exact)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch {
        try {
          // Last resort: any camera
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch {
          setError("Impossible d'accéder à la caméra. Vérifiez les permissions du navigateur ou saisissez le code manuellement.");
          setStarting(false);
          return;
        }
      }
    }

    if (!stream) {
      setError("Impossible d'accéder à la caméra. Vérifiez les permissions du navigateur ou saisissez le code manuellement.");
      setStarting(false);
      return;
    }

    streamRef.current = stream;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');

    try {
      await video.play();
    } catch {
      // Some browsers need a user gesture; try again
      setTimeout(() => video.play().catch(() => {}), 100);
    }

    // Try native BarcodeDetector first
    const nativeDetector = getNativeBarcodeDetector();
    if (nativeDetector) {
      detectorRef.current = nativeDetector;
      setStarting(false);
      setCameraActive(true);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // Fallback: ZXing library using decodeFromStream (more reliable than decodeFromVideoDevice)
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
        BarcodeFormat.CODABAR, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
        BarcodeFormat.ITF, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.PDF_417, BarcodeFormat.AZTEC,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 });

      // Use decodeFromStream which takes our existing MediaStream
      reader.decodeFromStream(stream, video, (result, _err, controls) => {
        if (result) {
          handleResult(result.getText());
          if (!isContinuous) {
            controls.stop();
          }
        }
      });

      setStarting(false);
      setCameraActive(true);
    } catch {
      setError("Le scanner n'est pas supporté par ce navigateur. Saisissez le code manuellement.");
      setStarting(false);
    }
  }, [tick, handleResult, isContinuous]);

  useEffect(() => {
    startCamera();
    return () => {
      stop();
    };
  }, [startCamera, stop]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    handleResult(code);
    setManualCode('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const remaining = isContinuous ? Math.max(0, (targetCount ?? 0) - scannedCount) : 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full animate-[scaleIn_180ms_ease-out]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-gray-900">
              {isContinuous ? `Scanner (${scannedCount}/${targetCount})` : 'Scanner le code à barres'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar in continuous mode */}
        {isContinuous && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Pots scannés</span>
              <span className="font-semibold text-gray-700">{scannedCount} / {targetCount}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-600 rounded-full transition-all"
                style={{ width: `${targetCount ? (scannedCount / targetCount) * 100 : 0}%` }}
              />
            </div>
            {remaining === 0 && (
              <p className="text-xs text-emerald-600 font-medium mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Tous les pots ont été scannés !
              </p>
            )}
          </div>
        )}

        {/* Video element is ALWAYS in the DOM so the stream can attach immediately */}
        <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
          {starting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-black">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm">Initialisation de la caméra…</p>
            </div>
          )}
          {!starting && !error && !manualMode && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/4 h-1/3 border-2 border-amber-400 rounded-xl shadow-[0_0_0_1000px_rgba(0,0,0,0.3)]" />
            </div>
          )}
          {lastScanned && !starting && !manualMode && (
            <div className="absolute bottom-2 left-2 right-2 bg-emerald-500/90 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
              <span className="text-xs text-white font-mono truncate">{lastScanned}</span>
            </div>
          )}
        </div>

        {error && !manualMode && (
          <div className="text-center py-6">
            <Camera className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500 px-4 mb-4">{error}</p>
            <button
              onClick={() => setManualMode(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
            >
              <Keyboard className="w-4 h-4" />
              Saisie manuelle
            </button>
          </div>
        )}

        {!starting && !error && !manualMode && (
          <>
            <p className="text-xs text-gray-400 text-center mt-3">
              {isContinuous
                ? remaining > 0
                  ? `Placez chaque pot dans le cadre. ${remaining} pot(s) restant(s) à scanner.`
                  : 'Tous les pots ont été scannés. Vous pouvez fermer ou continuer.'
                : 'Placez le code à barres dans le cadre. Le scan est automatique.'}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { stop(); setManualMode(true); }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"
              >
                <Keyboard className="w-4 h-4" />
                Saisie manuelle
              </button>
              <button
                onClick={() => { stop(); startCamera(); }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"
              >
                <RotateCw className="w-4 h-4" />
                Relancer
              </button>
            </div>
          </>
        )}

        {manualMode && (
          <form onSubmit={submitManual} className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {isContinuous ? 'Saisir le code du pot' : 'Saisie manuelle du code'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                autoFocus
                placeholder="Ex : 1234567890128"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-48 overflow-y-auto">
                  {suggestions.map((s) => (
                    <li key={s.code}>
                      <button
                        type="button"
                        onMouseDown={() => {
                          setManualCode(s.code);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center justify-between gap-2"
                      >
                        <span className="font-mono text-sm text-gray-800">{s.code}</span>
                        {s.pot_type_name && (
                          <span className="text-xs text-gray-400">{s.pot_type_name}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="w-full px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isContinuous ? 'Ajouter ce pot' : 'Valider le code'}
            </button>
            {isContinuous && scannedCount > 0 && (
              <p className="text-xs text-gray-400 text-center">{scannedCount} pot(s) scanné(s)</p>
            )}
            <button
              type="button"
              onClick={() => {
                setManualMode(false);
                setManualCode('');
                startCamera();
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"
            >
              <Camera className="w-4 h-4" />
              Retour au scanner
            </button>
          </form>
        )}

        {isContinuous && cameraActive && !starting && !error && !manualMode && remaining === 0 && (
          <button
            onClick={onClose}
            className="mt-3 w-full px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            Terminer et valider
          </button>
        )}
      </div>
    </div>
  );
}
