import { MapPinOff, Crosshair, AlertTriangle, RotateCw } from 'lucide-react';

export default function MandatoryLocationGate() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-amber-100 overflow-hidden">
        {/* Header band */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-3">
            <MapPinOff className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Localisation requise</h1>
          <p className="text-amber-50 text-sm mt-1">Le suivi GPS est obligatoire pour les commerciaux</p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-50 rounded-2xl">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-800">
              <p className="font-semibold mb-1">Accès à la position refusé</p>
              <p>Sans localisation, vous ne pouvez pas accéder à l'application. Votre position est nécessaire pour le suivi des tournées.</p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">Comment activer la localisation :</p>

            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-amber-700">1</span>
              </div>
              <p className="text-sm text-gray-600">
                <strong>Android (Chrome)</strong> — Appuyez sur l'icône cadenas ou les trois points en haut, puis autorisez « Position ».
              </p>
            </div>

            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-amber-700">2</span>
              </div>
              <p className="text-sm text-gray-600">
                <strong>iPhone (Safari)</strong> — Allez dans Réglages &gt; Safari &gt; Position &gt; « Autoriser », puis revenez sur cette page.
              </p>
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium text-sm shadow-sm hover:shadow-md transition-all"
          >
            <RotateCw className="w-4 h-4" />
            Réessayer
          </button>

          <div className="flex items-center justify-center gap-2 text-xs text-gray-400 pt-2">
            <Crosshair className="w-3 h-3" />
            Votre position est partagée uniquement pendant vos tournées
          </div>
        </div>
      </div>
    </div>
  );
}
