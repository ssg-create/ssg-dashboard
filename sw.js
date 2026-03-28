// SSG Operations Center — Service Worker
const CACHE = 'ssg-v1';
const PRECACHE = [
  './index.html',
  './manifest.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Dados remotos (GitHub Pages / OTRS): sempre rede, cache como fallback
  if(e.request.url.includes('github.io') || e.request.url.includes('xlsx') || e.request.url.includes('.json')){
    e.respondWith(
      fetch(e.request).then(function(r){
        var rc = r.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, rc); });
        return r;
      }).catch(function(){
        return caches.match(e.request);
      })
    );
    return;
  }
  // Assets locais: cache primeiro
  e.respondWith(
    caches.match(e.request).then(function(r){
      return r || fetch(e.request).then(function(nr){
        var rc2 = nr.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, rc2); });
        return nr;
      });
    })
  );
});
