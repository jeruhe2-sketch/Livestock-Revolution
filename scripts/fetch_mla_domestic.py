# -*- coding: utf-8 -*-
"""
MLA(Meat & Livestock Australia) Statistics API로 호주 내수 축산 지표를 수집한다.
인증키 불필요, 공개 API. 실제 API 구조는 GitHub Actions 러너에서 직접 탐색해 확인함
(로컬 개발 환경에서는 mla.com.au 계열 도메인이 봇 차단으로 안 열림 -> 워크플로우에서만 검증 가능).

API 문서(OpenAPI): https://app.nlrsreports.mla.com.au/static/documentation
실제 서버: https://api-mlastatistics.mla.com.au

주의 - 이용약관(비상업/개인·내부용 한정): 이 스크립트가 수집하는 지수는 MLA
Market Reports, Data and Information Terms of Use의 적용을 받음. 공개 배포 전
반드시 이용 범위를 확인할 것. (2026-09 대화에서 "나만 볼 수 있음"을 전제로 진행함)

사용 엔드포인트:
  GET /indicator             - 지표 ID <-> 이름 매핑 참조용 (매번 조회해서 이름 최신화)
  GET /report/5              - 전국 단위 축산 지표 (지표ID로 조회, 1개씩)
                                파라미터: fromDate, toDate, indicatorID(필수, 단일값), page
  GET /report/10             - 호주 주(state)별 주간 도축두수 (NLRS 자발적 조사)
                                파라미터: fromDate, toDate, stateID[], species[], page
                                국가 합계는 6개 주 응답을 모두 합산해서 계산.

수집 대상 지표 (5개, indicator_id는 /indicator 응답 기준):
  0  Eastern Young Cattle Indicator (EYCI)
  4  National Heavy Steer Indicator
  13 National Processor Cow Indicator (폐우/가공용)
  7  National Trade Lamb Indicator
  11 National Mutton Indicator

산출: data/mla_domestic.json
  {
    collectedAt, sourceMostRecentData,
    indicatorNames: {id: {desc, unit, species}},
    indicators: {id: [{date, value, headCount}, ...]},
    slaughter: {"Cattle": [{date, headCount}], "Sheep": [...]}   # 전국 합계, 주간
  }
"""
import json
import os
import sys
import time
from datetime import date, timedelta

import requests

BASE = "https://api-mlastatistics.mla.com.au"
OUTPUT_PATH = "data/mla_domestic.json"

INDICATOR_IDS = [0, 4, 13, 7, 11]
STATES = ["NSW", "SA", "VIC", "QLD", "WA", "TAS"]
SPECIES = ["Cattle", "Sheep"]

START_DATE = "2020-01-01"
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 5
RETRY_BACKOFF_CAP_SEC = 20
PAGE_SIZE_ASSUMED = 100  # API 문서 명시: 100행 초과 시 page 파라미터로 페이지네이션


def _get(path, params, label):
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(f"{BASE}{path}", params=params, headers={"Accept": "application/json"}, timeout=60)
        except Exception as e:
            last_err = f"exception: {e!r}"
            print(f"  [{label}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
            continue
        if r.status_code == 200:
            try:
                return r.json()
            except Exception as e:
                last_err = f"json parse error: {e!r}, body={r.text[:200]}"
        else:
            last_err = f"status={r.status_code} body={r.text[:300]}"
        print(f"  [{label}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
    raise RuntimeError(f"{label} 최종 실패: {last_err}")


def _get_all_pages(path, params, label):
    """total number rows > 100이면 page 파라미터로 순회. 응답 스키마: {message,total number rows,data,disclaimer}"""
    all_rows = []
    page = 1
    while True:
        p = dict(params)
        p["page"] = page
        data = _get(path, p, f"{label} p{page}")
        rows = data.get("data", [])
        all_rows.extend(rows)
        total = data.get("total number rows")
        if total is None or len(all_rows) >= total or not rows:
            break
        page += 1
        time.sleep(0.5)
    return all_rows


def fetch_indicator_names():
    data = _get("/indicator", {}, "indicator")
    out = {}
    for row in data.get("data", []):
        out[str(row["indicator_id"])] = {
            "desc": row["indicator_desc"],
            "unit": row["indicator_units"],
            "species": row["species_id"],
        }
    return out


def fetch_indicator_series(indicator_id, from_date, to_date):
    rows = _get_all_pages("/report/5", {
        "fromDate": from_date, "toDate": to_date, "indicatorID": str(indicator_id),
    }, f"report5 id={indicator_id}")
    out = []
    for row in rows:
        try:
            out.append({
                "date": row["calendar_date"][:10],
                "value": float(row["indicator_value"]),
                "headCount": int(float(row["head_count"])) if row.get("head_count") not in (None, "") else None,
            })
        except (ValueError, TypeError, KeyError):
            continue
    out.sort(key=lambda r: r["date"])
    return out


def fetch_slaughter(from_date, to_date):
    """국가 합계 = 6개 주 응답 head_count를 (날짜, 축종)별로 합산.
    API 제약: toDate는 반드시 "오늘로부터 7일 이전"이어야 함 (그 이내로 요청하면
    500 "Please provide date range 7 days before today!" 응답). 호출부에서
    to_date를 이미 안전하게 깎아서 넘겨준다."""
    result = {}
    for sp in SPECIES:
        rows = _get_all_pages("/report/10", {
            "fromDate": from_date, "toDate": to_date,
            "stateID": STATES, "species": [sp],
        }, f"report10 species={sp}")
        by_date = {}
        for row in rows:
            d = row["result_date"][:10]
            cnt = row.get("slaughter_count")
            if cnt is None:
                continue
            by_date[d] = by_date.get(d, 0) + int(cnt)
        result[sp] = [{"date": d, "headCount": v} for d, v in sorted(by_date.items())]
    return result


def main():
    today = date.today()
    today_iso = today.isoformat()
    # report/10은 "오늘로부터 7일 이전"까지만 허용 -> 여유있게 10일 전으로 자름
    slaughter_to = (today - timedelta(days=10)).isoformat()

    names = fetch_indicator_names()
    print("지표 레퍼런스 수집 완료:", {k: v["desc"] for k, v in names.items() if int(k) in INDICATOR_IDS})

    indicators = {}
    for iid in INDICATOR_IDS:
        series = fetch_indicator_series(iid, START_DATE, today_iso)
        indicators[str(iid)] = series
        print(f"  indicator {iid} ({names.get(str(iid), {}).get('desc')}): {len(series)}건")
        time.sleep(1)

    slaughter = fetch_slaughter(START_DATE, slaughter_to)
    for sp, series in slaughter.items():
        print(f"  slaughter {sp}: {len(series)}주")

    all_dates = [r["date"] for s in indicators.values() for r in s] + [r["date"] for s in slaughter.values() for r in s]
    source_most_recent = max(all_dates) if all_dates else None

    output = {
        "collectedAt": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "sourceMostRecentData": source_most_recent,
        "indicatorNames": {k: v for k, v in names.items() if int(k) in INDICATOR_IDS},
        "indicators": indicators,
        "slaughter": slaughter,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: {OUTPUT_PATH} 저장 (최신일: {source_most_recent})")


if __name__ == "__main__":
    main()
