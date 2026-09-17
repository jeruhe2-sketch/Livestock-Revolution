import json, os, urllib.request

API_KEY = os.environ["QIA_API_KEY"]
BASE = "http://211.237.50.150:7080/openapi"
API_URL_ID = "Grid_20151204000000000316_1"

def fetch(start, end):
    url = f"{BASE}/{API_KEY}/json/{API_URL_ID}/{start}/{end}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")

for start, end in [(1, 2), (100000, 100002), (500000, 500002), (1000000, 1000002), (2000000, 2000002)]:
    try:
        raw = fetch(start, end)
        data = json.loads(raw)
        top_keys = list(data.keys())
        rows = data.get(API_URL_ID, {}).get("row", []) if isinstance(data.get(API_URL_ID), dict) else None
        print(f"--- {start}~{end} ---")
        print("최상위 키:", top_keys)
        if API_URL_ID in data and isinstance(data[API_URL_ID], dict):
            inner_keys = list(data[API_URL_ID].keys())
            print("내부 키:", inner_keys)
        print("row 개수:", len(rows) if rows is not None else "구조다름")
        if rows:
            print("첫 row:", rows[0])
            print("마지막 row:", rows[-1])
    except Exception as e:
        print(f"--- {start}~{end} 실패: {e!r}")
