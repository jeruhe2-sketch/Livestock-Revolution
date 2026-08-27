// 축산레이더 서비스워커
// 목적: 인터넷이 끊기거나 느릴 때도 앱 화면과 마지막 데이터는 뜨게 한다.
// 전략:
//   - index.html / manifest.json: 네트워크 우선(network-first) - 항상 최신본을 먼저 시도하고,
//     오프라인일 때만 캐시된 걸 보여줌. (예전엔 캐시 우선이라 새로 배포해도 항상 옛날 버전이
//     먼저 응답해버리는 문제가 있었음 - 매번 "업데이트 안 됨"으로 보이던 원인이 이것)
//   - 아이콘/파비콘처럼 내용이 거의 안 바뀌는 정적 파일만 캐시 우선
//   - data/*.json(자동갱신 데이터): 네트워크 우선, 실패하면(오프라인) 캐시된 마지막 값
// 주의: 버전을 올리지 않으면 배포해도 기존 방문자 브라우저에 캐시가 남아있을 수 있어서,
//       index.html/manifest.json을 바꿀 때는 CACHE_VERSION도 같이 올려야 한다.

const CACHE_VERSION = "v25";
const SHELL_CACHE = `axr-shell-${CACHE_VERSION}`;
const DATA_CACHE = `axr-data-${CACHE_VERSION}`;

const SHELL_FILES = [
  "./icons/icon-192.png?v=2",
  "./icons/icon-512.png?v=2",
  "./apple-touch-icon.png?v=2",
  "./favicon.ico?v=2",
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
  const isNeverStale = url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/")
    || url.pathname.endsWith("manifest.json") || event.request.mode === "navigate";

  if (isData || isNeverStale) {
    // \ud56d\uc0c1 \ucd5c\uc2e0\uc744 \uba3c\uc800 \uc2dc\ub3c4, \uc624\ud504\ub77c\uc778\uc77c \ub54c\ub9cc \uce90\uc2dc\ub41c \uac12 \uc0ac\uc6a9
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

  // \uadf8 \uc678(\uc544\uc774\ucf58 \ub4f1 \uc815\uc801 \ud30c\uc77c): \uce90\uc2dc \uc6b0\uc120, \uc5c6\uc73c\uba74 \ub124\ud2b8\uc6cc\ud06c + \uce90\uc2dc\uc5d0 \uc800\uc7a5
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
