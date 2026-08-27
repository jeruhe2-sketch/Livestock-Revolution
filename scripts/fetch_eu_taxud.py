# -*- coding: utf-8 -*-
"""
EU 집행위 Agri-food Data Portal 공식 REST API로 TAXUD Weekly Export(돈육) 데이터를 수집한다.
기존에는 Qlik 대시보드에서 사용자가 수동으로 엑셀을 다운받아 처리했으나(scripts/import_manual_export.py류),
이 API가 같은 데이터를 인증키 없이 제공한다는 것을 확인하여 완전 자동화했다.

API 문서: https://agridata.ec.europa.eu/Extensions/API_Documentation/taxud.html
Base URL: https://api.tech.ec.europa.eu/agrifood
엔드포인트: GET /api/taxud/weeklyData/export  (인증 불필요, 공개 API)

산출: data/eu_pigmeat_trade.json
  {
    product, sector, collectedAt, sourceLastUpdate, sourceMostRecentData, granularity,
    msNames: {코드: 이름}, partnerNames: {코드: 이름},
    cols: ["year","week","month","partnerCode","msCode","kg","euro"],
    data: [[year, week, month, partnerCode, msCode, kg, euro], ...]
  }
기존 index.html의 EuTradeApp이 그대로 읽는 스키마와 동일하게 맞춤.

주의(중요): 이 API는 가끔 일시적으로 404를 반환하는 게 관찰됨(진짜 "데이터 없음"이 아니라
백엔드 일시 오류로 추정 - importCategories 같은 정적 메타데이터 엔드포인트는 항상 정상이었는데
weeklyData 조회만 간헐적으로 실패했음). 그래서 404/5xx도 재시도 대상으로 취급한다.
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

import requests

BASE = "https://api.tech.ec.europa.eu/agrifood"
ENDPOINT = f"{BASE}/api/taxud/weeklyData/export"

SECTOR = "Pigs"
PRODUCT = "Frozen pig meat"
PARTNER_CODES = ["KR", "US", "GB", "CN", "JP", "PH", "VN", "MY"]  # 한국/미국/영국/중국/일본/필리핀/베트남/말레이시아
PARTNER_NAMES = {
    "KR": "Korea (Republic of)",
    "US": "United States of America",
    "GB": "United Kingdom",
    "CN": "China",
    "JP": "Japan",
    "PH": "Philippines",
    "VN": "Vietnam",
    "MY": "Malaysia",
}

START_YEAR = 2024
OUTPUT_PATH = "data/eu_pigmeat_trade.json"

MAX_RETRIES = 12
RETRY_BACKOFF_SEC = 15
RETRY_BACKOFF_CAP_SEC = 60


def fetch_year(year: int) -> list:
    """해당 연도(marketingYear) 전체의 export 데이터를 가져온다.
    products/sectors 필터는 서버에서 걸고, partnerCode는 클라이언트에서 걸러낸다
    (partnerCodes 파라미터가 실제로 지원되는지 불확실했으므로 안전하게 직접 필터링).
    """
    params = {
        "sectors": SECTOR,
        "products": PRODUCT,
        "marketingYears": str(year),
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(ENDPOINT, params=params, headers={"Accept": "application/json"}, timeout=60)
        except Exception as e:
            last_err = f"exception: {e!r}"
            print(f"  [{year}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
            continue

        if r.status_code == 200:
            try:
                data = r.json()
            except Exception as e:
                last_err = f"json parse error: {e!r}"
                print(f"  [{year}] 시도 {attempt}/{MAX_RETRIES} JSON 파싱 실패", file=sys.stderr)
                time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
                continue
            print(f"  [{year}] 수집 성공: {len(data)}건")
            return data

        last_err = f"status={r.status_code} body={r.text[:300]}"
        print(f"  [{year}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))

    raise RuntimeError(f"{year}년 데이터 수집 최종 실패: {last_err}")


def _iso_week1_monday(year: int) -> date:
    """ISO 8601 기준 해당 연도 1주차의 월요일 (1/4가 속한 주의 월요일)."""
    jan4 = date(year, 1, 4)
    return jan4 - timedelta(days=jan4.isoweekday() - 1)


def week_to_month(year: int, week: int) -> int:
    """연/주 -> 그 주(월~일) 중 더 많은 날짜가 속한 달의 번호.
    date.fromisocalendar은 그 해가 진짜 ISO 53주짜리가 아니면 week=53에서
    예외를 던지는데, EU TAXUD 쪽 week 번호는 그 규칙을 따르지 않고
    52주 넘는 잔여일을 53주차로 붙이는 경우가 있어 직접 계산한다
    (1주차 월요일 + (week-1)*7일)."""
    monday = _iso_week1_monday(year) + timedelta(weeks=week - 1)
    if week == 53:
        # 53주차(연도 마지막에 붙는 잔여주)는 1월로 넘어가는 날이 더 많아도
        # 항상 그 해의 12월로 고정한다 (기존 데이터/원본 Qlik 처리 방식과 동일하게 확인됨)
        return 12
    counts = {}
    for i in range(7):
        d = monday + timedelta(days=i)
        counts[d.month] = counts.get(d.month, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def main():
    all_ms_names = {}
    compact_rows = []

    end_year = datetime.now().year
    for year in range(START_YEAR, end_year + 1):
        raw = fetch_year(year)
        for rec in raw:
            partner_code = rec.get("partnerCode")
            if partner_code not in PARTNER_CODES:
                continue
            ms_code = rec.get("memberStateCode")
            ms_name = rec.get("memberStateName")
            if ms_code and ms_name:
                all_ms_names[ms_code] = ms_name
            wk = rec.get("week")
            yr = int(rec.get("marketingYear", year))
            month = week_to_month(yr, wk)
            kg = rec.get("kg", 0) or 0
            euro = rec.get("euroValue", 0) or 0
            compact_rows.append([yr, wk, month, partner_code, ms_code, kg, euro])
        time.sleep(1)  # 서버 배려

    # 같은 (year,week,partner,ms) 조합이 cn8/procedure 등으로 여러 줄일 수 있으니 합산
    merged = {}
    for yr, wk, month, partner_code, ms_code, kg, euro in compact_rows:
        key = (yr, wk, partner_code, ms_code)
        if key not in merged:
            merged[key] = [yr, wk, month, partner_code, ms_code, 0.0, 0.0]
        merged[key][5] += kg
        merged[key][6] += euro

    final_rows = sorted(merged.values(), key=lambda r: (r[0], r[1], r[3], r[4]))

    now = datetime.now().astimezone()
    # 소스 최신데이터 시점 추정: 수집된 데이터 중 가장 최근 (year,week)의 일요일
    if final_rows:
        last_year, last_week = max((r[0], r[1]) for r in final_rows)
        last_sunday = _iso_week1_monday(last_year) + timedelta(weeks=last_week - 1, days=6)
        source_most_recent = last_sunday.isoformat()
    else:
        source_most_recent = None

    output = {
        "product": PRODUCT,
        "sector": SECTOR,
        "collectedAt": now.isoformat(),
        "sourceLastUpdate": now.date().isoformat(),
        "sourceMostRecentData": source_most_recent,
        "granularity": "weekly",
        "msNames": dict(sorted(all_ms_names.items(), key=lambda kv: kv[1])),
        "partnerNames": PARTNER_NAMES,
        "cols": ["year", "week", "month", "partnerCode", "msCode", "kg", "euro"],
        "data": final_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(final_rows)}행 저장 -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
