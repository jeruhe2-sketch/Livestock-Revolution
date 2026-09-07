# -*- coding: utf-8 -*-
"""
EU 집행위 Agri-food Data Portal 공식 REST API로 EU 돼지 도체가격(Pigmeat carcass prices)을 수집한다.
인증키 불필요, 공개 API (fetch_eu_taxud.py의 수출 API와 같은 도메인/스타일).

API 문서: https://agridata.ec.europa.eu/Extensions/API_Documentation/Pigmeat.html
엔드포인트: GET /api/pigmeat/prices
  파라미터: memberStateCodes, pigClasses(S,E,R,SE,Piglet), marketingYears, weeks, beginDate, endDate
  응답 필드: memberStateCode, memberStateName, beginDate, endDate, weekNumber, pigClass, unit, price("€1.85" 형태 문자열)

pigClass 'S'(Superior, 살코기 비율 최고 등급) = 유럽 돈가 지표로 통상 인용되는 등급.
EU 평균은 memberStateCode가 "EU"로 내려오는 것으로 확인(다른 회원국과 동일한 배열 원소).

수집 대상: EU 평균 + 독일/스페인/덴마크/네덜란드 (기존 EU 수출현황 탭과 동일한 4개국,
사용자가 비교하기 쉽도록 통일)

산출: data/eu_pigmeat_price.json
  {
    pigClass, unit, collectedAt, sourceMostRecentData,
    msNames: {코드: 이름},
    cols: ["year","week","msCode","price"],
    data: [[year, week, msCode, price], ...]
  }
"""
import json
import os
import sys
import time
from datetime import datetime

import requests

BASE = "https://api.tech.ec.europa.eu/agrifood"
ENDPOINT = f"{BASE}/api/pigmeat/prices"

PIG_CLASS = "S"  # Superior 등급 - 유럽 돈가 지표로 통상 인용되는 등급
MS_CODES = ["EU", "DE", "ES", "DK", "NL"]

START_YEAR = 2015
OUTPUT_PATH = "data/eu_pigmeat_price.json"

MAX_RETRIES = 10
RETRY_BACKOFF_SEC = 15
RETRY_BACKOFF_CAP_SEC = 60


def fetch_year(year: int) -> list:
    params = {
        "pigClasses": PIG_CLASS,
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

        # weeklyData 엔드포인트처럼 이 API도 간헐적 404/5xx가 있을 수 있어 재시도 대상으로 취급
        last_err = f"status={r.status_code} body={r.text[:300]}"
        print(f"  [{year}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))

    raise RuntimeError(f"{year}년 데이터 수집 최종 실패: {last_err}")


def parse_price(v) -> float:
    """'€1.85' 같은 문자열/숫자 어느 쪽이 와도 실수로 변환."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    s = s.replace("€", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def main():
    ms_names = {}
    unit = None
    rows_by_key = {}

    end_year = datetime.now().year
    for year in range(START_YEAR, end_year + 1):
        raw = fetch_year(year)
        for rec in raw:
            ms_code = rec.get("memberStateCode")
            if ms_code not in MS_CODES:
                continue
            ms_name = rec.get("memberStateName")
            if ms_code and ms_name:
                ms_names[ms_code] = ms_name
            wk = rec.get("weekNumber")
            yr = year
            price = parse_price(rec.get("price"))
            if price is None:
                continue
            if unit is None:
                unit = rec.get("unit")
            key = (yr, wk, ms_code)
            rows_by_key[key] = [yr, wk, ms_code, price]
        time.sleep(1)  # 서버 배려

    if "EU" not in ms_names:
        ms_names["EU"] = "European Union"

    final_rows = sorted(rows_by_key.values(), key=lambda r: (r[0], r[1], r[2]))

    now = datetime.now().astimezone()
    source_most_recent = None
    if final_rows:
        last_year, last_week = max((r[0], r[1]) for r in final_rows)
        source_most_recent = f"{last_year}-W{last_week:02d}"

    output = {
        "pigClass": PIG_CLASS,
        "unit": unit or "EUR/100kg",
        "collectedAt": now.isoformat(),
        "sourceMostRecentData": source_most_recent,
        "granularity": "weekly",
        "msNames": dict(sorted(ms_names.items(), key=lambda kv: (kv[0] != "EU", kv[1]))),
        "cols": ["year", "week", "msCode", "price"],
        "data": final_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(final_rows)}행 저장 -> {OUTPUT_PATH} (최신: {source_most_recent})")


if __name__ == "__main__":
    main()
