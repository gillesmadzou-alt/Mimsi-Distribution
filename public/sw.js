const CACHE_NAME = 'mimsi-distribution-v105';
const PHOTO_CACHE_NAME = 'mimsi-attendance-photos-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/WhatsApp_Image_2026-07-31_at_19.28.27.jpeg',
  '/etiquette-madeleines-mimsi-sans-qr-hd.png',
];

self.addEventListener('install', (event) => {
  // Lors d'une mise à jour, le nouveau service worker doit rester en attente
  // afin que l'application puisse proposer explicitement « Mettre à jour ».
  // Le premier service worker s'active automatiquement lorsqu'il n'y en a pas
  // déjà un qui contrôle l'application.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Background Sync API : quand la connexion revient (même si l'onglet est en
// arrière-plan et que ses setInterval/setTimeout sont ralentis par le
// navigateur), Chrome réveille le service worker et déclenche cet
// événement. Le SW n'a pas la session Supabase authentifiée de la page (elle
// vit dans le contexte JS de l'onglet, pas du SW), donc on ne rejoue pas la
// file ici : on réveille toutes les pages ouvertes pour qu'elles relancent
// leur propre `syncNow()`, qui a déjà toute la logique et l'authentification
// nécessaires (voir src/contexts/SyncContext.tsx). Le polling existant
// (toutes les 15s côté page) reste le filet de sécurité pour les navigateurs
// qui ne supportent pas Background Sync (Safari/Firefox notamment) ou quand
// aucune page n'est ouverte au moment de la reconnexion.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-offline-queue') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGER' }));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== PHOTO_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache attendance photos from Supabase storage for offline use
  if (url.pathname.includes('/storage/v1/object/public/attendance-photos/')) {
    event.respondWith(
      caches.open(PHOTO_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Never cache Supabase API calls or edge functions — always go to network.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/')) {
    return;
  }

  // Navigations: network-first (latest HTML), fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    const freshUrl = new URL(request.url);
    freshUrl.searchParams.set('sw_ts', Date.now().toString());
    event.respondWith(
      fetch(freshUrl.href, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match('/').then((root) => root || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/html' } })))
        )
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts/icons): CACHE-FIRST.
  if (
    url.pathname.startsWith('/assets/') ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        caches.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Everything else same-origin GET: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Web Push : affiche une notification système même si l'app est fermée.
// Le payload envoyé par la fonction Edge `send-push` est un JSON
// { title, body, link_page, priority }.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Mimsi Distribution', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Mimsi Distribution';
  const options = {
    body: payload.body || '',
    icon: '/etiquette-madeleines-mimsi-sans-qr-hd.png',
    badge: '/etiquette-madeleines-mimsi-sans-qr-hd.png',
    tag: payload.notification_id || undefined,
    data: { link_page: payload.link_page || null },
    requireInteraction: payload.priority === 'haute',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur une notification système : focus un onglet existant si possible,
// sinon en ouvre un nouveau, et transmet la page cible à afficher.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const linkPage = event.notification.data && event.notification.data.link_page;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'PUSH_NOTIFICATION_CLICK', linkPage });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
