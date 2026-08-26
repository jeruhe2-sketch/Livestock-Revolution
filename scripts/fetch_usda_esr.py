"""
USDA FAS ESR(Export Sales Reporting) 데이터 수집 스크립트
미국 -> 한국/일본/영국/중국/필리핀 돼지고기(1702)/소고기(1701) 주간 수출 데이터
"""
import os, json, sys, time
import requests

BASE = "https://api.fas.usda.gov/api"
KEY = os.environ["USDA_API_KEY"]
HEADERS = {"X-Api-Key": KEY}

COMMODITIES = {1701: "beef", 1702: "pork"}
COUNTRIES = {
    5800: "KR",  # 한국
    5880: "JP",  # 일본
    4120: "GB",  # 영국
    5700: "CN",  # 중국
    5650: "PH",  # 필리핀
}
COUNTRY_LABEL = {"KR": "한국", "JP": "일본", "GB": "영국", "CN": "중국", "PH": "필리핀"}

# 시작 마켓이어 (부담 줄이기 위해 최근 몇 년만)
START_YEAR = 2023
import datetime
END_YEAR = datetime.datetime.now().year


def fetch_all():
    records = []
    for commodity_code, commodity_name in COMMODITIES.items():
        for country_code, country_short in COUNTRIES.items():
            for year in range(START_YEAR, END_YEAR + 1):
                url = f"{BASE}/esr/exports/commodityCode/{commodity_code}/countryCode/{country_code}/marketYear/{year}"
                try:
                    r = requests.get(url, headers=HEADERS, timeout=30)
                except Exception as e:
                    print(f"  에러: {commodity_name} {country_short} {year}: {e}", file=sys.stderr)
                    continue
                if r.status_code != 200:
                    print(f"  실패({r.status_code}): {commodity_name} {country_short} {year}", file=sys.stderr)
                    time.sleep(0.5)
                    continue
                data = r.json()
                for row in data:
                    we = row.get("weekEndingDate", "")
                    if not we:
                        continue
                    dt = we[:10]  # YYYY-MM-DD
                    y, m, d = dt.split("-")
                    records.append([
                        int(y), int(m), int(d),
                        commodity_name, country_short,
                        row.get("weeklyExports", 0),
                        row.get("outstandingSales", 0),
                        row.get("accumulatedExports", 0),
                        row.get("grossNewSales", 0),
                    ])
                print(f"  수집: {commodity_name} {country_short} {year} -> {len(data)}건")
                time.sleep(0.2)
    return records


def main():
    records = fetch_all()
    out = {
        "product": "Pork/Beef",
        "collectedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "granularity": "weekly",
        "countryLabel": COUNTRY_LABEL,
        "cols": ["year", "month", "day", "commodity", "countryCode", "weeklyExports", "outstandingSales", "accumulatedExports", "grossNewSales"],
        "data": records,
    }
    os.makedirs("data", exist_ok=True)
    with open("data/usda_livestock_esr.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: 총 {len(records)}행 저장")


if __name__ == "__main__":
    main()
