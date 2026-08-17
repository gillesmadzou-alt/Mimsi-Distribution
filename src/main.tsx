import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Keep this in sync with the cache name / version used in public/sw.js
const SW_VERSION = 'v25';

if ('serviceWorker' in navigator) {
  let refreshing = false;

  const showUpdateDialog = () => {
    if (document.getElementById('sw-update-dialog')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sw-update-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;animation:sw-fade-in 0.25s ease-out';

    overlay.innerHTML = `
      <div style="background:white;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:380px;width:100%;padding:28px 24px;text-align:center;font-family:-apple-system,BlinkMacSystem,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Mise à jour disponible</h2>
        <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.5;">Une nouvelle version de l'application est prête. Mettez à jour pour profiter des dernières améliorations du mode hors‑ligne et des corrections.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="sw-update-btn" style="background:#f59e0b;color:white;border:none;border-radius:12px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.2s">Mettre à jour</button>
          <button id="sw-update-later" style="background:transparent;color:#9ca3af;border:none;font-size:14px;cursor:pointer;padding:8px;">Plus tard</button>
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
      overlay.remove();
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      });
    });

    document.getElementById('sw-update-later')?.addEventListener('click', () => {
      overlay.remove();
    });
  };

  const registerSW = () => {
    // register with version query so deploys that update SW_VERSION force a new registration
    navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`).then((reg) => {
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

      // try to keep the registration up to date
      reg.update();
    }).catch((err) => {
      // fallback: register without query if something blocks the versioned URL
      console.error('SW registration failed with versioned URL, retrying without query', err);
      navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW fallback registration failed', e));
    });
  };

  window.addEventListener('load', () => {
    registerSW();
    setInterval(() => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update();
      }).catch(() => {});
    }, 30 * 1000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update();
      }).catch(() => {});
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  // Debug helper: clear caches and unregister service workers then reload
  (window as any).__mimsi_clearSW = async () => {
    try {
      console.log('[mimsi] clearing service workers and caches');
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log('[mimsi] cleared, reloading');
    } catch (err) {
      console.error('[mimsi] error clearing SW/caches', err);
    }
    window.location.reload();
  };
}
