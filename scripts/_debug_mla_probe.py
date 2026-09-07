import re
import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

urls = [
    "https://www.mla.com.au/prices-markets/statistics/api/",
]

for url in urls:
    print("=== GET", url)
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/html"}, timeout=30)
        print("status", r.status_code, "len", len(r.text))
        html = r.text
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
candidates = [
    "https://statistics.mla.com.au/",
    "https://statistics.mla.com.au/api/",
    "https://api.mla.com.au/",
    "https://mlastatisticsapi.azure-api.net/",
    "https://www.mla.com.au/api/",
]
for c in candidates:
    print("=== PROBE", c)
    try:
        r = requests.get(c, headers={"User-Agent": UA}, timeout=15)
        print("  status", r.status_code, "ctype", r.headers.get("content-type"), "body[:200]", r.text[:200])
    except Exception as e:
        print("  ERROR", repr(e))
