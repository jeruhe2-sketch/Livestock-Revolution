"""
USDA FAS ESR(Export Sales Reporting) 데이터 수집 스크립트.
미국 -> 한국/중국/영국/일본/필리핀 돼지고기(1702)/소고기(1701) 주간 수출 현황.

API: https://api.fas.usda.gov/api/esr/...  (헤더: X-Api-Key)
"""
import json
import os
import sys
import time

import requests

BASE = "https://api.fas.usda.gov/api"
API_KEY = os.environ.get("USDA_API_KEY", "")
HEADERS = {"X-Api-Key": API_KEY}
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "usda_meat_export.json")

COMMODITIES = {
    1701: "\uBE44\uc721\uc6b0",   # 소고기 (Fresh, Chilled, or Frozen Muscle Cuts of Beef)
    1702: "\ub3c8\uc721",        # 돼지고기 (Fresh, Chilled, or Frozen Muscle Cuts of Pork)
}
COUNTRIES = {
    5800: "KR",  # Korea, Republic of
    5700: "CN",  # China
    4120: "GB",  # United Kingdom
    5880: "JP",  # Japan
    5650: "PH",  # Philippines
}


def get(url, **kwargs):
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30, **kwargs)
            if r.status_code == 200:
                return r.json()
            print(f"  -> {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"  재시도 {attempt+1}/3: {e}", file=sys.stderr)
            time.sleep(3)
    return None


def main():
    if not API_KEY:
        print("USDA_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    all_rows = []
    # 최근 3개 마켓이어(전년+금년+내년 커밋 일부) 정도만 수집해도 충분 - 우선 2024~2026
    for market_year in [2024, 2025, 2026]:
        for commodity_code, commodity_name in COMMODITIES.items():
            for country_code, country_alpha in COUNTRIES.items():
                url = f"{BASE}/esr/exports/commodityCode/{commodity_code}/countryCode/{country_code}/marketYear/{market_year}"
                data = get(url)
                if not data:
                    continue
                for row in data:
                    all_rows.append([
                        market_year,
                        commodity_code,
                        country_code,
                        row.get("weekEndingDate", "")[:10],
                        row.get("weeklyExports", 0),
                        row.get("accumulatedExports", 0),
                        row.get("outstandingSales", 0),
                        row.get("grossNewSales", 0),
                        row.get("currentMYNetSales", 0),
                        row.get("currentMYTotalCommitment", 0),
                    ])
                print(f"[{market_year}/{commodity_name}/{country_alpha}] {len(data)}건 수집")

    out = {
        "collectedAt": None,  # 아래에서 KST로 채움
        "commodities": COMMODITIES,
        "countries": COUNTRIES,
        "cols": ["marketYear", "commodityCode", "countryCode", "weekEndingDate",
                 "weeklyExports", "accumulatedExports", "outstandingSales",
                 "grossNewSales", "currentMYNetSales", "currentMYTotalCommitment"],
        "data": all_rows,
    }

    from datetime import datetime, timedelta, timezone
    KST = timezone(timedelta(hours=9))
    out["collectedAt"] = datetime.now(KST).isoformat()

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(all_rows)}행 저장 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
