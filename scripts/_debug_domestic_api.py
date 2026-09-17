import json, os, urllib.request

API_KEY = os.environ["QIA_API_KEY"]
BASE = "http://211.237.50.150:7080/openapi"
API_URL_ID = "Grid_20151204000000000316_1"

def fetch(start, end):
    url = f"{BASE}/{API_KEY}/json/{API_URL_ID}/{start}/{end}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")

for start, end in [(46100, 46140), (46141, 46145)]:
    try:
        raw = fetch(start, end)
        data = json.loads(raw)
        inner = data.get(API_URL_ID, {})
        rows = inner.get("row", [])
        print(f"--- {start}~{end} ---")
        print("totalCnt:", inner.get("totalCnt"), "| startRow:", inner.get("startRow"), "| endRow:", inner.get("endRow"), "| result:", inner.get("result"))
        print("row 개수:", len(rows))
        if rows:
            dates = [r.get("OCCRRNC_DE") for r in rows]
            print("이 구간 날짜 범위:", min(dates), "~", max(dates))
            print("마지막 row:", rows[-1])
    except Exception as e:
        print(f"--- {start}~{end} 실패: {e!r}")
