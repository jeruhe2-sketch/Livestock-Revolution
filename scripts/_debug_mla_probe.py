import re
import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

urls = []
candidates = []

import time as _t

def probe(path, params, label):
    url = f"https://api-mlastatistics.mla.com.au{path}"
    print(f"=== {label}: GET {url} params={params}")
    t0 = _t.time()
    try:
        r = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=30)
        print(f"  status={r.status_code} elapsed={_t.time()-t0:.1f}s body[:500]={r.text[:500]}")
    except Exception as e:
        print(f"  ERROR {e!r} elapsed={_t.time()-t0:.1f}s")

probe("/report/5", {"fromDate": "2026-08-01", "toDate": "2026-09-07", "indicatorID": "0"}, "report5 EYCI small range")
probe("/report/10", {"fromDate": "2026-08-01", "toDate": "2026-09-07", "stateID": ["NSW", "SA", "VIC", "QLD", "WA", "TAS"], "species": ["Cattle"]}, "report10 list-style params")
probe("/report/10", {"fromDate": "2026-08-01", "toDate": "2026-09-07", "stateID": "NSW,SA,VIC,QLD,WA,TAS", "species": "Cattle"}, "report10 comma-joined params")
probe("/report/5", {"fromDate": "2015-01-01", "toDate": "2026-09-07", "indicatorID": "0", "page": 1}, "report5 EYCI full range page1")


for url in urls:
    print("=== GET", url)
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30)
        print("status", r.status_code, "len", len(r.text))
        html = r.text
        if len(html) < 200000:
            print("  FULL BODY:", html)
        # swagger/openapi 스펙 URL, config.json 등 단서 찾기
        for pat in [r'https?://[^\s"\'<>]+\.json', r'https?://[a-zA-Z0-9\.\-]*mla[a-zA-Z0-9\.\-]*/[^\s"\'<>]+',
                    r'"url"\s*:\s*"[^"]+"', r'spec-url="[^"]+"', r'swagger[^"\']*', r'apim[^"\']*',
                    r'azure-api\.net[^\s"\'<>]*']:
            found = sorted(set(re.findall(pat, html, re.IGNORECASE)))[:20]
            if found:
                print(f"  [{pat}] ->", found)
    except Exception as e:
        print("  ERROR", repr(e))

# 흔한 후보 API 베이스들을 직접 두드려봄
candidates = []
for c in candidates:
    print("=== PROBE", c)
    try:
        r = requests.get(c, headers={"User-Agent": UA}, timeout=15)
        print("  status", r.status_code, "ctype", r.headers.get("content-type"), "body[:200]", r.text[:200])
    except Exception as e:
        print("  ERROR", repr(e))
