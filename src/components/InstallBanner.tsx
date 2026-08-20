import { useEffect, useState } from 'react';
import { X, Download, Share, Plus } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!standalone) setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!isStandalone && (deferredPrompt || isIOS)) {
      const dismissed = sessionStorage.getItem('install_banner_dismissed');
      if (!dismissed) setVisible(true);
    }
  }, [deferredPrompt, isIOS, isStandalone]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') setVisible(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    sessionStorage.setItem('install_banner_dismissed', '1');
  };

  if (!visible || isStandalone) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto bg-white rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <Download className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Installer l'application</p>
          {isIOS && !deferredPrompt ? (
            <p className="text-xs text-gray-500 mt-1">
              Appuyez sur <Share className="inline w-3 h-3" /> puis « Sur l'écran d'accueil » <Plus className="inline w-3 h-3" />
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">Accédez rapidement à l'app depuis votre écran d'accueil.</p>
          )}
          <div className="flex gap-2 mt-2">
            {!isIOS || deferredPrompt ? (
              <button
                onClick={handleInstall}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
              >
                Installer
              </button>
            ) : null}
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button onClick={handleDismiss} className="flex-shrink-0 text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
