# -*- coding: utf-8 -*-
"""
EU 집행위 Agri-food Data Portal 공식 REST API로 EU 돼지 도체가격(Pigmeat carcass prices)을 수집한다.
인증키 불필요, 공개 API (fetch_eu_taxud.py의 수출 API와 같은 도메인/스타일).

API 문서: https://agridata.ec.europa.eu/Extensions/API_Documentation/Pigmeat.html
엔드포인트: GET /api/pigmeat/prices
  파라미터: memberStateCodes, pigClasses(S,E,R,SE,Piglet, 콤마로 복수 지정 가능), marketingYears, weeks, beginDate, endDate
  응답 필드: memberStateCode, memberStateName, beginDate, endDate, weekNumber, pigClass, unit, price("€1.85" 형태 문자열)

기존(v1)에서는 5개국 × S등급 하나만 받았는데, 실제로는 memberStateCodes를 생략하면
EU 27개국 전체 + EU 평균이 한 번에 내려오고, pigClasses도 콤마로 여러 등급을
한 번의 요청으로 받을 수 있다는 걸 확인했음. API가 이미 다 갖고 있는 걸 굳이
5개국으로 잘라서 가져올 이유가 없어서 전체로 확장.

산출: data/eu_pigmeat_price.json
  {
    pigClasses: ["S","E"], unit, collectedAt, sourceMostRecentData,
    msNames: {코드: 이름} (전체 회원국 + EU),
    cols: ["year","week","pigClass","msCode","price"],
    data: [[year, week, pigClass, msCode, price], ...]
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

# S(Superior)=지표로 가장 흔히 인용되는 살코기 최고등급, E(Estimated/우수)=차상위 등급.
# 둘 다 받아서 프론트에서 토글 가능하게 함.
PIG_CLASSES = ["S", "E"]

START_YEAR = 2015
OUTPUT_PATH = "data/eu_pigmeat_price.json"

MAX_RETRIES = 10
RETRY_BACKOFF_SEC = 15
RETRY_BACKOFF_CAP_SEC = 60


def fetch_year(year: int) -> list:
    params = {
        "pigClasses": ",".join(PIG_CLASSES),
        "marketingYears": str(year),
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(ENDPOINT, params=params, headers={"Accept": "application/json"}, timeout=90)
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


def parse_price(v):
    """'€1.85' 같은 문자열/숫자 어느 쪽이 와도 실수로 변환."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("€", "").replace(",", ".").strip()
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
            ms_name = rec.get("memberStateName")
            pig_class = rec.get("pigClass")
            if not ms_code or pig_class not in PIG_CLASSES:
                continue
            if ms_name:
                ms_names[ms_code] = ms_name
            wk = rec.get("weekNumber")
            price = parse_price(rec.get("price"))
            if price is None:
                continue
            if unit is None:
                unit = rec.get("unit")
            key = (year, wk, pig_class, ms_code)
            rows_by_key[key] = [year, wk, pig_class, ms_code, price]
        time.sleep(1)  # 서버 배려

    if "EU" not in ms_names:
        ms_names["EU"] = "European Union"

    final_rows = sorted(rows_by_key.values(), key=lambda r: (r[0], r[1], r[2], r[3]))

    now = datetime.now().astimezone()
    source_most_recent = None
    if final_rows:
        last_year, last_week = max((r[0], r[1]) for r in final_rows)
        source_most_recent = f"{last_year}-W{last_week:02d}"

    output = {
        "pigClasses": PIG_CLASSES,
        "unit": unit or "100 KG",
        "collectedAt": now.isoformat(),
        "sourceMostRecentData": source_most_recent,
        "granularity": "weekly",
        "msNames": dict(sorted(ms_names.items(), key=lambda kv: (kv[0] != "EU", kv[1]))),
        "cols": ["year", "week", "pigClass", "msCode", "price"],
        "data": final_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(final_rows)}행 / {len(ms_names)}개 지역 저장 -> {OUTPUT_PATH} (최신: {source_most_recent})")


if __name__ == "__main__":
    main()

