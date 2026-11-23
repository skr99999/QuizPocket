"use strict";

const scope = new URL(self.registration.scope);
const cachePrefix = `quizpocket:${scope.pathname}:`;
const cacheName = `${cachePrefix}__VERSION__`;
const files = __FILES__;
const shell = new URL("index.html", scope);
const appFiles = new Set(files.map(file => new URL(file, scope).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files.map(file => new Request(new URL(file, scope), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isLaunch = event.request.mode === "navigate" && url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === shell.pathname);
  const target = isLaunch ? shell.href : url.href;
  if (!appFiles.has(target)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(target) || fetch(event.request);
  })());
});
