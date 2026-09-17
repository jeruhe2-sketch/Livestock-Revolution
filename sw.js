// 축산레이더 서비스워커
// index/data는 네트워크 우선, 정적 자산(scripts/*.js 등)은 캐시 우선.
// 주의: scripts/*.js나 index.html/manifest.json 내용을 바꿀 때는 CACHE_VERSION도
// 반드시 같이 올려야 한다. 안 올리면 배포해도 기존 방문자 브라우저는 캐시 우선
// 전략 때문에 옛날 파일을 계속 쓰게 되어 "서버엔 반영됐는데 화면엔 안 보임" 상태가 됨
// (2026-09-17: 드롭다운 위치 버그를 shared_ui.js에서 고쳤는데 버전을 안 올려서
//  실제로 이 문제가 재현된 적 있음 - 반드시 체크리스트화할 것).
const CACHE_VERSION = "v28";
const SHELL_CACHE = `axr-shell-${CACHE_VERSION}`;
const DATA_CACHE = `axr-data-${CACHE_VERSION}`;
const SHELL_FILES = ["./icons/icon-192.png?v=2","./icons/icon-512.png?v=2","./apple-touch-icon.png?v=2","./favicon.ico?v=2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(SHELL_CACHE).then(c=>c.addAll(SHELL_FILES)).catch(()=>{}));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL_CACHE&&k!==DATA_CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==self.location.origin)return;const data=u.pathname.includes("/data/")&&u.pathname.endsWith(".json");const fresh=u.pathname.endsWith(".html")||u.pathname==="/"||u.pathname.endsWith("/")||u.pathname.endsWith("manifest.json")||e.request.mode==="navigate";if(data||fresh){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(data?DATA_CACHE:SHELL_CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));return;}e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const x=r.clone();caches.open(SHELL_CACHE).then(k=>k.put(e.request,x));return r;})));});