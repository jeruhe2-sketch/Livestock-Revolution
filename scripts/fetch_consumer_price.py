# -*- coding: utf-8 -*-
"""
국내 축산물 소비자가격 정보 - 축산물품질평가원(KAPE) 공식 API.
data.go.kr "축산물품질평가원_축산물유통정보"(15000577) 중
- 일자별: consumerPriceDaily (standYmd=YYYYMMDD) -> "오늘 시세" 스냅샷용
- 월별:   consumerPriceMonth (standYm=YYYYMM)   -> 추이 차트용

품목코드(itemCd)는 필터링이 제대로 안 걸려서(넣어도 전체가 나옴) 아예 생략하고
응답에 실제로 들어있는 품목만 그대로 수집한다.

산출: data/consumer_price.json
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, timedelta

SERVICE_KEY = os.environ.get("KAPE_SERVICE_KEY")
BASE = "http://data.ekape.or.kr/openapi-data/service/user/grade"
OUTPUT_PATH = "data/consumer_price.json"

SPECIES = {"4301": "소", "4304": "돼지"}
MONTHS_BACK = 100  # 최초 시딩(파일 없을 때)만 전체
RECENT_MONTHS = 3  # 파일 있으면 최근 3개월만
YEARS_BACK = 10
RECENT_YEARS = 1  # 연도별도 파일 있으면 올해만 재수집
DAILY_LOOKBACK_DAYS = 10  # 오늘 시세는 최근 며칠 안에서 데이터 있는 첫날 채택


def _call(op: str, params: dict):
    if not SERVICE_KEY:
        print("ERROR: KAPE_SERVICE_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)
    q = {"serviceKey": SERVICE_KEY, **params}
    url = f"{BASE}/{op}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")
    root = ET.fromstring(raw)
    if root.findtext(".//resultCode") != "00":
        return []
    return root.findall(".//item")


def _item_to_dict(item) -> dict:
    d = {}
    for child in item:
        d[child.tag] = child.text
    return d


def fetch_month(yyyy_mm: str, judge_kind: str) -> list:
    items = _call("consumerPriceMonth", {"standYm": yyyy_mm, "judgeKind": judge_kind})
    return [_item_to_dict(i) for i in items]


def fetch_daily(yyyymmdd: str, judge_kind: str) -> list:
    items = _call("consumerPriceDaily", {"standYmd": yyyymmdd, "judgeKind": judge_kind})
    return [_item_to_dict(i) for i in items]


def fetch_year(yyyy: str, judge_kind: str) -> list:
    items = _call("consumerPriceYear", {"standY": yyyy, "judgeKind": judge_kind})
    return [_item_to_dict(i) for i in items]


def fetch_tendays(yyyy_mm: str, judge_kind: str) -> list:
    items = _call("consumerPriceTenDays", {"standYm": yyyy_mm, "judgeKind": judge_kind})
    return [_item_to_dict(i) for i in items]


def year_iter_back(n_years: int):
    this_year = date.today().year
    for i in range(n_years):
        yield str(this_year - i)


def month_iter_back(n_months: int):
    today = date.today()
    y, m = today.year, today.month
    for _ in range(n_months):
        yield f"{y:04d}{m:02d}"
        m -= 1
        if m == 0:
            m = 12
            y -= 1


def find_latest_daily(judge_kind: str):
    d = date.today()
    for _ in range(DAILY_LOOKBACK_DAYS):
        ymd = d.strftime("%Y%m%d")
        rows = fetch_daily(ymd, judge_kind)
        if rows:
            return ymd, rows
        d -= timedelta(days=1)
    return None, []


def main():
    existing = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f).get("species", {})
        except Exception:
            existing = {}

    result = {"species": {}}
    for judge_kind, name in SPECIES.items():
        prev = existing.get(name, {})
        has_prev = bool(prev.get("history"))
        months_back = RECENT_MONTHS if has_prev else MONTHS_BACK
        years_back = RECENT_YEARS if prev.get("yearly") else YEARS_BACK

        # 월별 추이 - 최근 N개월만 새로 받아서 기존과 병합
        new_history = {}
        for ym in month_iter_back(months_back):
            rows = fetch_month(ym, judge_kind)
            time.sleep(0.25)
            if not rows:
                continue
            by_item = {}
            for r in rows:
                item_nm = r.get("itemNm", "?")
                ntsl = r.get("ntslPrc")
                if ntsl is None:
                    continue
                by_item.setdefault(item_nm, []).append(float(ntsl))
            key = f"{ym[:4]}-{ym[4:]}"
            new_history[key] = {"yearMonth": key, "items": {k: sum(v) / len(v) for k, v in by_item.items()}}
        merged_history = {h["yearMonth"]: h for h in prev.get("history", [])}
        merged_history.update(new_history)
        history = sorted(merged_history.values(), key=lambda r: r["yearMonth"])

        # 오늘 시세 스냅샷 (항상 최신 며칠만 조회하므로 그대로 매번 수행)
        latest_ymd, daily_rows = find_latest_daily(judge_kind)
        latest_snapshot = {}
        for r in daily_rows:
            item_nm = r.get("itemNm", "?")
            ntsl = r.get("ntslPrc")
            if ntsl is not None:
                latest_snapshot.setdefault(item_nm, []).append(float(ntsl))
        latest_snapshot = {k: sum(v) / len(v) for k, v in latest_snapshot.items()}
        unit = (daily_rows[0].get("unit") if daily_rows else None) or prev.get("unit") or "원/100g"

        # 연도별(평년비교) - 기존 있으면 올해만 갱신
        new_yearly = {}
        for yyyy in year_iter_back(years_back):
            rows = fetch_year(yyyy, judge_kind)
            time.sleep(0.25)
            if not rows:
                continue
            by_item = {}
            for r in rows:
                item_nm = r.get("itemNm", "?")
                ntsl = r.get("ntslPrc")
                if ntsl is not None:
                    by_item.setdefault(item_nm, []).append(float(ntsl))
            new_yearly[yyyy] = {"year": yyyy, "items": {k: sum(v) / len(v) for k, v in by_item.items()}}
        merged_yearly = {y["year"]: y for y in prev.get("yearly", [])}
        merged_yearly.update(new_yearly)
        yearly = sorted(merged_yearly.values(), key=lambda r: r["year"])

        # 순별(초/중/하순) - 최근 N개월만
        new_tendays = {}
        for ym in month_iter_back(months_back):
            rows = fetch_tendays(ym, judge_kind)
            time.sleep(0.25)
            if not rows:
                continue
            for period_idx, period_label in [(1, "초순"), (2, "중순"), (3, "하순")]:
                by_item = {}
                for r in rows:
                    item_nm = r.get("itemNm", "?")
                    val = r.get(f"ntslPrc_{period_idx}")
                    if val is not None:
                        by_item.setdefault(item_nm, []).append(float(val))
                if by_item:
                    label = f"{ym[:4]}-{ym[4:]}-{period_label}"
                    new_tendays[label] = {"label": label, "items": {k: sum(v) / len(v) for k, v in by_item.items()}}
        merged_tendays = {t["label"]: t for t in prev.get("tendays", [])}
        merged_tendays.update(new_tendays)
        tendays = sorted(merged_tendays.values(), key=lambda r: r["label"])

        result["species"][name] = {
            "judgeKind": judge_kind,
            "unit": unit,
            "history": history,
            "yearly": yearly,
            "tendays": tendays,
            "latestDate": latest_ymd,
            "latestSnapshot": latest_snapshot,
        }
        print(f"  {name}: 월별 누적 {len(history)}개월(이번 갱신 {len(new_history)}) / 순별 {len(tendays)} / 연도별 {len(yearly)} / 최신시세 {latest_ymd or '없음'}")

    result["source"] = "축산물품질평가원(KAPE) 축산물유통정보 - 소비자가격 정보"
    result["updatedAt"] = date.today().isoformat()

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
