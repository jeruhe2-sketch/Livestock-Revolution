import requests, json

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

for sym in ["KRW=X", "EURKRW=X"]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
    print("=== ", url)
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=20)
        print("status", r.status_code)
        print(r.text[:1500])
    except Exception as e:
        print("ERROR", repr(e))

# 대체 호스트도 확인
for sym in ["KRW=X"]:
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{sym}"
    print("=== ", url)
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
        print("status", r.status_code)
        print(r.text[:600])
    except Exception as e:
        print("ERROR", repr(e))
