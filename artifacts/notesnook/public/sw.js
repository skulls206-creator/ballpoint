// Ballpoint Service Worker — offline-first + notification support
const CACHE_NAME = 'ballpoint-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
];

// ── Install: cache app shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for nav, cache-first for static assets ───────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Always pass through cross-origin requests (fonts, APIs)
  if (url.origin !== self.location.origin) return;

  // Skip Vite HMR/dev server requests
  if (url.pathname.startsWith('/@') || url.pathname.includes('__vite')) return;

  // Navigation: serve app shell, fall back to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Cache the navigation response
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/').then(r => r ?? new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts, manifests): cache-first with background update
  const isStatic = /\.(js|mjs|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|webmanifest|webp)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchAndCache = fetch(request).then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
          return res;
        });
        // Return cached immediately, update in background (stale-while-revalidate)
        return cached ?? fetchAndCache;
      })
    );
  }
});

// ── SW Update: notify all clients when a new SW version is waiting ────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Notification click → open/focus PWA and navigate to the note ──────────────
self.addEventListener('notificationclick', event => {
  const { noteId } = event.notification.data ?? {};
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (noteId) client.postMessage({ type: 'OPEN_NOTE', noteId });
          return;
        }
      }
      return clients.openWindow('/');
    })
  );
});
