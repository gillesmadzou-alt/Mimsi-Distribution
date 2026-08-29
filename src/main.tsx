import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Change this value for every production PWA release. It gives browsers a
// new service-worker URL, even when they retained an older script in cache.
const SW_VERSION = 'v77';

if ('serviceWorker' in navigator) {
  let refreshing = false;

  const showUpdateDialog = () => {
    if (document.getElementById('sw-update-dialog')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sw-update-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;animation:sw-fade-in 0.25s ease-out;';

    overlay.innerHTML = `
      <div style="background:white;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:380px;width:100%;padding:28px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;animation:sw-scale-in 0.3s ease-out;">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 4 21 10 15 10"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Mise à jour disponible</h2>
        <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.5;">Une nouvelle version de l'application est prête. Mettez à jour pour profiter des dernières améliorations du mode hors ligne.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="sw-update-btn" style="background:#f59e0b;color:white;border:none;border-radius:12px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.2s;">Mettre à jour maintenant</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes sw-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sw-scale-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
    `;
    document.head.appendChild(styleEl);

    document.getElementById('sw-update-btn')?.addEventListener('click', () => {
      const button = document.getElementById('sw-update-btn') as HTMLButtonElement | null;
      if (button) {
        button.disabled = true;
        button.textContent = 'Installation de la mise à jour…';
      }
      overlay.remove();
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          // Le contrôleur a pu être activé entre l'affichage de la boîte et
          // le clic : une vérification puis un rechargement évitent de rester
          // sur l'ancienne page.
          reg?.update().finally(() => window.location.reload());
        }
      });
    });
  };

  const registerSW = () => {
    navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`, { updateViaCache: 'none' }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateDialog();
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateDialog();
            }
          });
        }
      });

      // Ne pas utiliser le cache HTTP pour la recherche d'une nouvelle version.
      reg.update();
    }).catch(() => {
      navigator.serviceWorker.register('/sw.js');
    });
  };

  window.addEventListener('load', () => {
    registerSW();
    setInterval(() => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update();
      });
    }, 30 * 1000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update();
      });
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
