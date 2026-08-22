const CACHE_NAME = 'mimsi-distribution-v34';
const PHOTO_CACHE_NAME = 'mimsi-attendance-photos-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/WhatsApp_Image_2026-07-31_at_19.28.27.jpeg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
