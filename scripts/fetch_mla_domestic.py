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

START_DATE = "2020-01-01"  # 최초 백필(과거 기록용, 이제 평소 실행에선 안 씀 - 아래 FETCH_WINDOW_DAYS 참고)
FETCH_WINDOW_DAYS = 183  # 매 실행마다 새로 받아오는 범위: 최근 약 6개월치만. 그 이전 과거값은
                         # 안 바뀌므로 기존 파일에 이미 저장된 걸 그대로 유지(병합)한다.
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


def fetch_us_imported_meat(from_date, to_date):
    """/report/9 US Imported Meat Prices (Steiner, republished by MLA, weekly 화요일 갱신).
    응답에 여러 indicator_name이 섞여 있을 수 있어 "90CL Boneless Beef, NZ/Australia"만 필터.
    indicator_value가 문자열로 오므로 float 변환."""
    TARGET_NAME = "90CL Boneless Beef, NZ/Australia"
    rows = _get_all_pages("/report/9", {
        "fromDate": from_date, "toDate": to_date,
    }, "report9 90CL")
    out = []
    for row in rows:
        if row.get("indicator_name") != TARGET_NAME:
            continue
        try:
            out.append({
                "date": row["indicator_date"][:10],
                "value": float(row["indicator_value"]),
                "unit": row.get("indicator_units"),
            })
        except (ValueError, TypeError, KeyError):
            continue
    out.sort(key=lambda r: r["date"])
    return out


def load_existing():
    """이전에 저장된 파일을 읽어온다. 없으면(최초 실행) 빈 구조 반환."""
    if not os.path.exists(OUTPUT_PATH):
        return {"indicators": {}, "slaughter": {}, "usImported90cl": []}
    try:
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            old = json.load(f)
        return {
            "indicators": old.get("indicators", {}),
            "slaughter": old.get("slaughter", {}),
            "usImported90cl": old.get("usImported90cl", []),
        }
    except Exception as e:
        print(f"기존 파일 읽기 실패({e!r}), 빈 상태로 시작", file=sys.stderr)
        return {"indicators": {}, "slaughter": {}, "usImported90cl": []}


def merge_by_date(old_rows, new_rows, date_key="date"):
    """날짜 기준 병합. 겹치는 날짜는 새 값으로 덮어씀(정정된 값 반영), 나머지는 유지."""
    by_date = {r[date_key]: r for r in old_rows if date_key in r}
    for r in new_rows:
        by_date[r[date_key]] = r
    return [by_date[d] for d in sorted(by_date.keys())]



def main():
    today = date.today()
    # report/5, report/9도 toDate가 "오늘"이면 500 "Please provide date range before today!"
    # 응답이 남 (report/10의 "7일 이전" 제약과 비슷한 종류). 안전하게 하루 전까지만 요청.
    safe_to_iso = (today - timedelta(days=1)).isoformat()
    # report/10은 "오늘로부터 7일 이전"까지만 허용 -> 여유있게 10일 전으로 자름
    slaughter_to = (today - timedelta(days=10)).isoformat()
    # 매번 2020년부터 전부 다시 받으면 지표 5개 x 6년치 페이지네이션으로 실행시간이
    # 몇 분~10분씩 걸려서 다른 워크플로우들과 공유하는 락을 오래 붙잡는 문제가 있었음.
    # 최근 6개월만 새로 받고, 그보다 오래된 값은 기존 파일에 이미 저장된 걸 그대로 유지.
    window_from = (today - timedelta(days=FETCH_WINDOW_DAYS)).isoformat()

    existing = load_existing()

    names = fetch_indicator_names()
    print("지표 레퍼런스 수집 완료:", {k: v["desc"] for k, v in names.items() if int(k) in INDICATOR_IDS})

    indicators = {}
    for iid in INDICATOR_IDS:
        new_series = fetch_indicator_series(iid, window_from, safe_to_iso)
        merged = merge_by_date(existing["indicators"].get(str(iid), []), new_series)
        indicators[str(iid)] = merged
        print(f"  indicator {iid} ({names.get(str(iid), {}).get('desc')}): 신규 {len(new_series)}건 / 누적 {len(merged)}건")
        time.sleep(1)

    new_slaughter = fetch_slaughter(window_from, slaughter_to)
    slaughter = {}
    for sp in SPECIES:
        merged = merge_by_date(existing["slaughter"].get(sp, []), new_slaughter.get(sp, []))
        slaughter[sp] = merged
        print(f"  slaughter {sp}: 신규 {len(new_slaughter.get(sp, []))}주 / 누적 {len(merged)}주")

    new_90cl = fetch_us_imported_meat(window_from, safe_to_iso)
    us_imported_90cl = merge_by_date(existing["usImported90cl"], new_90cl)
    print(f"  us_imported_90cl: 신규 {len(new_90cl)}건 / 누적 {len(us_imported_90cl)}건")

    all_dates = (
        [r["date"] for s in indicators.values() for r in s]
        + [r["date"] for s in slaughter.values() for r in s]
        + [r["date"] for r in us_imported_90cl]
    )
    source_most_recent = max(all_dates) if all_dates else None

    output = {
        "collectedAt": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "sourceMostRecentData": source_most_recent,
        "indicatorNames": {k: v for k, v in names.items() if int(k) in INDICATOR_IDS},
        "indicators": indicators,
        "slaughter": slaughter,
        "usImported90cl": us_imported_90cl,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: {OUTPUT_PATH} 저장 (최신일: {source_most_recent})")


if __name__ == "__main__":
    main()
