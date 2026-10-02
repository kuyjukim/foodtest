/* 오프라인에서도 열리도록 앱 파일을 캐시해 둔다.
 * 파일을 고친 뒤에는 CACHE 이름의 숫자를 올려야 사용자에게 새 버전이 전달된다. */
var CACHE = 'fridge-recipe-v14';

var SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'data/recipes.js',
  'data/ingredients.js',
  'data/affiliate.js',
  'data/coupang-links.js',
  'data/coupang-products.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  // 화면 이동은 네트워크를 먼저 보고, 실패하면 캐시된 첫 화면을 돌려준다
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  // 나머지는 캐시 우선. 새로 받은 건 조용히 캐시에 넣어 둔다
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
