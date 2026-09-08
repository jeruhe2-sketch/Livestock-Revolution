# -*- coding: utf-8 -*-
"""
USDA AMS LMR Datamart(인증키 불필요)로 돈육/소고기 "컷아웃"(부위 합산 종합가)을 수집한다.
기존 usda_pork_domestic.json(부위별 3종: 등심/전지/목전지)과는 다른, "오늘 미국 육류가
전체적으로 얼마인지"를 나타내는 헤드라인 지표.

- 돈육 컷아웃: report 2498(LM_PK602, 일간) "Cutout and Primal Values" 섹션의 pork_carcass 필드.
  usda_pork_domestic.json과 같은 리포트라 매일 발표됨.
- 소고기 컷아웃(Choice/Select): report 2461(LM_XB459, "주간" 리포트라고 이름 붙었지만 실제로는
  그 주 매일치 컷아웃값이 "Weekly Summary Cutout Values" 섹션에 rp_date(월/일)별로 다 들어있음)
  choice_600_900 / select_600_900 필드.

산출: data/usda_cutout.json
  {
    collectedAt, sourceMostRecentData,
    pork: {unit, data: [{date, value}, ...]},
    beef: {unit, data: [{date, choice, select}, ...]}
  }
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse

import requests

OUT = "data/usda_cutout.json"
HIST_START = dt.date(2023, 1, 1)
CHUNK_DAYS = 170
MAX_RETRIES = 6


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "").replace("$", ""))
    except ValueError:
        return None


def fetch_section(report_id: str, section: str, start: dt.date, end: dt.date):
    url = f"https://mpr.datamart.ams.usda.gov/services/v1.1/reports/{report_id}/{urllib.parse.quote(section)}"
    params = {"q": f"report_date={start.strftime('%m/%d/%Y')}:{end.strftime('%m/%d/%Y')}"}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=90)
        except Exception as e:
            last_err = repr(e)
            time.sleep(min(5 * attempt, 30))
            continue
        if r.status_code == 200:
            try:
                return r.json()
            except Exception as e:
                last_err = f"json parse error: {e!r}"
        else:
            last_err = f"status={r.status_code} body={r.text[:300]}"
        print(f"  [{report_id}/{section}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(min(5 * attempt, 30))
    print(f"경고: [{report_id}/{section}] {start}~{end} 구간 최종 실패, 건너뜀 ({last_err})", file=sys.stderr)
    return None


def _flatten_results(payload):
    """report/{id}/{section} 응답에서 results 배열(들)을 전부 모아 평평하게 반환."""
    rows = []
    if not payload:
        return rows

    def walk(node):
        if isinstance(node, dict):
            if "results" in node and isinstance(node["results"], list):
                rows.extend(node["results"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(payload)
    return rows


def date_chunks(start: dt.date, end: dt.date, step_days: int):
    cur = start
    while cur <= end:
        chunk_end = min(cur + dt.timedelta(days=step_days - 1), end)
        yield cur, chunk_end
        cur = chunk_end + dt.timedelta(days=1)


def collect_pork(today: dt.date):
    by_date = {}
    for start, end in date_chunks(HIST_START, today, CHUNK_DAYS):
        payload = fetch_section("2498", "Cutout and Primal Values", start, end)
        for row in _flatten_results(payload):
            d = row.get("report_date")
            v = num(row.get("pork_carcass"))
            if not d or v is None:
                continue
            iso = dt.datetime.strptime(d, "%m/%d/%Y").date().isoformat()
            by_date[iso] = v
        time.sleep(0.5)
    return [{"date": d, "value": v} for d, v in sorted(by_date.items())]


def collect_beef(today: dt.date):
    by_date = {}
    for start, end in date_chunks(HIST_START, today, CHUNK_DAYS):
        payload = fetch_section("2461", "Weekly Summary Cutout Values", start, end)
        for row in _flatten_results(payload):
            report_date_s = row.get("report_date")
            rp_date_s = row.get("rp_date")  # "MM/DD" 형식, 연도 없음
            choice = num(row.get("choice_600_900"))
            select = num(row.get("select_600_900"))
            if not report_date_s or not rp_date_s or choice is None:
                continue
            report_date = dt.datetime.strptime(report_date_s, "%m/%d/%Y").date()
            rp_month, rp_day = (int(x) for x in rp_date_s.split("/"))
            year = report_date.year
            # 리포트 발표일이 1월인데 rp_date가 12월이면 전년도로 보정 (연말/연초 경계)
            if report_date.month == 1 and rp_month == 12:
                year -= 1
            try:
                iso = dt.date(year, rp_month, rp_day).isoformat()
            except ValueError:
                continue
            by_date[iso] = {"choice": choice, "select": select}
        time.sleep(0.5)
    return [{"date": d, **v} for d, v in sorted(by_date.items())]


def main():
    today = dt.date.today()
    print("돈육 컷아웃 수집...")
    pork = collect_pork(today)
    print(f"  {len(pork)}건")
    print("소고기 컷아웃 수집...")
    beef = collect_beef(today)
    print(f"  {len(beef)}건")

    source_most_recent = max([r["date"] for r in pork] + [r["date"] for r in beef], default=None)

    output = {
        "collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceMostRecentData": source_most_recent,
        "pork": {"unit": "$/cwt", "label": "돈육 컷아웃 (LM_PK602)", "data": pork},
        "beef": {"unit": "$/cwt", "label": "소고기 Choice/Select 컷아웃 (LM_XB459)", "data": beef},
    }

    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: {OUT} 저장 (최신: {source_most_recent})")


if __name__ == "__main__":
    main()
