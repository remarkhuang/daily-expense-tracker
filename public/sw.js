// ============================================
// Service Worker — 離線快取
// ============================================

const CACHE_NAME = 'expense-tracker-v5';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
];

// 安裝：快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 啟動：清除舊快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// 攔截請求：Network First + Cache Fallback
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Google API 請求不做快取
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('google.com') ||
        url.hostname.includes('gstatic.com')) {
        return;
    }

    // CDN 資源使用 Cache First
    if (url.hostname.includes('cdn.sheetjs.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                        return response;
                    });
                })
        );
        return;
    }

    // 本地資源使用 Network First
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
