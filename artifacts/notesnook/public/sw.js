// LocalNotes Service Worker - Offline-first cache strategy
const CACHE_NAME = 'localnotes-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(() => {
      // Silently fail if some assets can't be cached
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Cache-first for static assets, network-first for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // For navigation requests, try network first then fall back to cached root
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match('/').then(r => r || fetch(request)))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|webmanifest)$/.test(url.pathname);
  
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return response;
        });
      })
    );
    return;
  }
});
