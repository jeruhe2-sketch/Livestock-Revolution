// 축산레이더 서비스워커
//
// 전략: "거의 안 바뀌는 이미지/아이콘류"만 캐시 우선, 그 나머지(HTML/데이터json/
// scripts/*.js 전부 포함)는 전부 네트워크 우선(실패시에만 캐시 폴백)으로 통일.
//
// (2026-09-17 전면 개편) 예전엔 scripts/*.js 같은 정적 자산을 캐시 우선으로 서빙해서,
// 코드를 고쳐 배포해도 CACHE_VERSION을 같이 안 올리면 기존 방문자 브라우저는
// 계속 옛날 스크립트를 쓰는 문제가 실제로 있었다(드롭다운 위치 버그 수정이 안
// 보이던 사고). 게다가 서비스워커 자체가 갱신되는 타이밍도 브라우저마다 달라서
// "즐겨찾기로 들어와도 예전 버전"이라는 체감으로 이어졌음.
// → 이제부터 코드 변경사항은 CACHE_VERSION을 안 올려도 다음 새로고침에서 바로
//   반영된다(네트워크 우선이라). CACHE_VERSION은 "오프라인 폴백용 캐시 청소"
//   목적으로만 가끔 올리면 되고, 안 올려도 기능상 문제는 없다.
const CACHE_VERSION = "v29";
const SHELL_CACHE = `axr-shell-${CACHE_VERSION}`;
const DATA_CACHE = `axr-data-${CACHE_VERSION}`;
const SHELL_FILES = ["./icons/icon-192.png?v=2", "./icons/icon-512.png?v=2", "./apple-touch-icon.png?v=2", "./favicon.ico?v=2"];

// 캐시 우선으로 둬도 되는 것: 이미지/아이콘류뿐 (내용이 거의 안 바뀜 + 오프라인일 때도
// 앱 껍데기(아이콘)는 즉시 뜨는 게 사용자 경험에 좋음).
function isImageAsset(pathname) {
  return /\.(png|ico|jpg|jpeg|svg|webp)$/.test(pathname.split("?")[0]);
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;

  if (isImageAsset(u.pathname)) {
    // 이미지/아이콘: 캐시 우선, 없으면 네트워크에서 받아서 캐시에 저장
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((r) => {
            const copy = r.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy));
            return r;
          })
      )
    );
    return;
  }

  // 그 외 전부(HTML/네비게이션/manifest/data json/scripts js 등): 네트워크 우선,
  // 실패했을 때만(오프라인) 마지막으로 받아둔 캐시로 폴백.
  const isData = u.pathname.includes("/data/") && u.pathname.endsWith(".json");
  const cacheName = isData ? DATA_CACHE : SHELL_CACHE;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(cacheName).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
