/* 秒薪 PWA service worker
 * 缓存应用外壳，让主屏幕 App 在弱网/离线时也能打开。
 * 云端 KVdb、在线 AI 等跨域请求不做缓存。
 */
const CACHE_NAME = "secondsalary-pwa-v2";
const CACHE_PREFIX = "secondsalary-pwa-";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/wage.js",
  "./js/storage.js",
  "./js/cloud.js",
  "./js/ai.js",
  "./js/pwa.js",
  "./js/app.js",
  "./assets/su7.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL.map(function (path) { return new URL(path, self.registration.scope).href; }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function networkFirstNavigation(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(scopeUrl("./index.html"), copy);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(scopeUrl("./index.html"), { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return caches.match(scopeUrl("./"), { ignoreSearch: true }).then(function (root) {
        return root || new Response(
          "<!doctype html><meta charset='utf-8'><title>秒薪</title><body style='background:#08090a;color:#f3f1eb;font-family:sans-serif;padding:40px'>秒薪当前离线。请先联网打开一次，让应用完成缓存。</body>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      });
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request, { ignoreSearch: true }).then(function (cached) {
    const network = fetch(request).then(function (response) {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    }).catch(function () {
      return cached || new Response("", { status: 503 });
    });
    return cached || network;
  });
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
