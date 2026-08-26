"""
USDA FAS ESR(Export Sales Reporting) 데이터 수집 스크립트
미국 -> 한국/중국/영국/일본/필리핀 돼지고기(1702)/소고기(1701) 주간 수출 데이터
UsdaTradeApp이 기대하는 형식(usda_meat_export.json)으로 저장
"""
import os, json, sys, time
import requests
import datetime

BASE = "https://api.fas.usda.gov/api"
KEY = os.environ["USDA_API_KEY"]
HEADERS = {"X-Api-Key": KEY}

COMMODITY_CODES = [1701, 1702]  # 소고기, 돼지고기
COUNTRIES = {
    5800: "KR",  # 한국
    5700: "CN",  # 중국
    4120: "GB",  # 영국
    5880: "JP",  # 일본
    5650: "PH",  # 필리핀
}

START_YEAR = 2023
END_YEAR = datetime.datetime.now().year


def fetch_all():
    records = []
    for commodity_code in COMMODITY_CODES:
        for country_code in COUNTRIES:
            for year in range(START_YEAR, END_YEAR + 1):
                url = f"{BASE}/esr/exports/commodityCode/{commodity_code}/countryCode/{country_code}/marketYear/{year}"
                try:
                    r = requests.get(url, headers=HEADERS, timeout=30)
                except Exception as e:
                    print(f"  에러: {commodity_code} {country_code} {year}: {e}", file=sys.stderr)
                    continue
                if r.status_code != 200:
                    print(f"  실패({r.status_code}): {commodity_code} {country_code} {year}", file=sys.stderr)
                    time.sleep(0.5)
                    continue
                data = r.json()
                for row in data:
                    we = row.get("weekEndingDate", "")
                    if not we:
                        continue
                    records.append([
                        year, commodity_code, country_code, we,
                        row.get("weeklyExports", 0),
                        row.get("accumulatedExports", 0),
                        row.get("outstandingSales", 0),
                        row.get("grossNewSales", 0),
                        row.get("currentMYNetSales", 0),
                        row.get("currentMYTotalCommitment", 0),
                    ])
                print(f"  수집: 코드{commodity_code} 국가{country_code} {year} -> {len(data)}건")
                time.sleep(0.2)
    return records


def main():
    records = fetch_all()
    out = {
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "countries": {str(k): v for k, v in COUNTRIES.items()},
        "data": records,
    }
    os.makedirs("data", exist_ok=True)
    with open("data/usda_meat_export.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: 총 {len(records)}행 저장")


if __name__ == "__main__":
    main()
