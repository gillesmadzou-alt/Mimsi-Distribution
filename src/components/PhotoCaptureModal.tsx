import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, RefreshCw, Check, X, SwitchCamera, Loader2 } from 'lucide-react';

interface PhotoCaptureModalProps {
  open: boolean;
  title: string;
  subtitle: string;
  accentColor: 'emerald' | 'red';
  onClose: () => void;
  onCapture: (photoDataUrl: string) => void;
}

export default function PhotoCaptureModal({
  open, title, subtitle, accentColor, onClose, onCapture,
}: PhotoCaptureModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
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
  }, [stream]);

  useEffect(() => {
    if (open && !photoDataUrl) {
      startCamera(facingMode);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  const retakePhoto = () => {
    setPhotoDataUrl(null);
    startCamera(facingMode);
  };

  const switchCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setPhotoDataUrl(null);
    startCamera(next);
  };

  const handleConfirm = () => {
    if (!photoDataUrl) return;
    setSaving(true);
    onCapture(photoDataUrl);
  };

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setPhotoDataUrl(null);
    setCameraError(null);
    setSaving(false);
    onClose();
  };

  if (!open) return null;

  const accent = accentColor === 'emerald'
    ? { bg: 'bg-emerald-50', text: 'text-emerald-600', btn: 'bg-emerald-500 hover:bg-emerald-600' }
    : { bg: 'bg-red-50', text: 'text-red-600', btn: 'bg-red-500 hover:bg-red-600' };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera className={`w-5 h-5 ${accent.text}`} />
            <div>
              <p className="text-sm font-bold text-gray-900">{title}</p>
              <p className="text-xs text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            disabled={saving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {cameraError && (
            <div className="text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3 mb-3 text-center">
              {cameraError}
            </div>
          )}

          {!photoDataUrl && !cameraError && (
            <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <button
                onClick={switchCamera}
                className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                title="Changer de caméra"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            </div>
          )}

          {photoDataUrl && (
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
              <img src={photoDataUrl} alt="Photo capturée" className="w-full h-full object-cover" />
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          <div className="flex gap-2 mt-4">
            {!photoDataUrl && !cameraError && (
              <button
                onClick={capturePhoto}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-medium ${accent.btn} transition-colors`}
              >
                <Camera className="w-5 h-5" />
                Prendre la photo
              </button>
            )}

            {photoDataUrl && !saving && (
              <>
                <button
                  onClick={retakePhoto}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refaire
                </button>
                <button
                  onClick={handleConfirm}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-medium ${accent.btn} transition-colors`}
                >
                  <Check className="w-4 h-4" />
                  Confirmer
                </button>
              </>
            )}

            {saving && (
              <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 text-gray-500 text-sm font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                Enregistrement…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
