// 축산레이더 서비스워커
// 목적: 인터넷이 끊기거나 느릴 때도 "마지막으로 받아온 데이터"와 앱 화면 자체는 뜨게 한다.
// 전략:
//   - 앱 셸(index.html, manifest, 아이콘 등): 캐시 우선(cache-first), 없으면 네트워크
//   - data/*.json(실시간성이 중요한 자동갱신 데이터): 네트워크 우선(network-first),
//     실패하면(오프라인) 캐시된 마지막 값을 보여줌
// 주의: 버전을 올리지 않으면 배포해도 기존 방문자 브라우저에 캐시가 남아있을 수 있어서,
//       index.html/manifest.json을 바꿀 때는 CACHE_VERSION도 같이 올려야 한다.

const CACHE_VERSION = "v6";
const SHELL_CACHE = `axr-shell-${CACHE_VERSION}`;
const DATA_CACHE = `axr-data-${CACHE_VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json?v=2",
  "./favicon.ico?v=2",
  "./icons/icon-192.png?v=2",
  "./icons/icon-512.png?v=2",
  "./apple-touch-icon.png?v=2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isData = url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isData) {
    // 데이터 파일: 네트워크 우선, 실패하면 캐시된 마지막 값
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 그 외(앱 셸): 캐시 우선, 없으면 네트워크 + 캐시에 저장
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      });
    })
  );
});
