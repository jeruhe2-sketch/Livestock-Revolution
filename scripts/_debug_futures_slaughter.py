import requests, json, sys

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# 1) 야후 파이낸스로 CME 선물(Live Cattle, Feeder Cattle, Lean Hogs) 되는지 확인
print("########## YAHOO FUTURES ##########")
for sym in ["LE=F", "GF=F", "HE=F"]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
    print("===", sym, url)
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=20)
        print("status", r.status_code)
        if r.status_code == 200:
            meta = r.json()["chart"]["result"][0]["meta"]
            print("  longName:", meta.get("longName"), "shortName:", meta.get("shortName"))
            print("  regularMarketPrice:", meta.get("regularMarketPrice"), "prevClose:", meta.get("previousClose"))
            print("  exchangeName:", meta.get("exchangeName"), "instrumentType:", meta.get("instrumentType"))
        else:
            print("  body:", r.text[:200])
    except Exception as e:
        print("ERROR", repr(e))

# 2) USDA LMR Datamart에서 도축(Slaughter) 관련 리포트가 있는지 확인
# 알려진 legacy slug 후보들을 시도 (Actual Slaughter Under Federal Inspection 계열)
print()
print("########## USDA SLAUGHTER CANDIDATES ##########")
candidates = {
    "2004": "LM_CT150 (후보)",
    "2005": "후보",
    "3373": "National Weekly Cattle/Beef Slaughter (후보)",
}
for rid, label in candidates.items():
    url = f"https://mpr.datamart.ams.usda.gov/services/v1.1/reports/{rid}"
    print("===", rid, label, url)
    try:
        r = requests.get(url, timeout=20)
        print("status", r.status_code)
        print(r.text[:500])
    except Exception as e:
        print("ERROR", repr(e))

# 3) 리포트 전체 목록에서 slaughter/kill 키워드로 검색
print()
print("########## FULL REPORT LIST SEARCH ##########")
try:
    r = requests.get("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/", timeout=30)
    print("status", r.status_code, "len", len(r.text))
    data = r.json()
    if isinstance(data, list):
        for item in data:
            title = (item.get("report_title") or item.get("title") or "").lower()
            if "slaughter" in title or "kill" in title:
                print("  ", item)
except Exception as e:
    print("ERROR", repr(e))
