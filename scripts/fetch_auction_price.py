# -*- coding: utf-8 -*-
"""
국내 축산물 도매시장 경락가격(소/돼지) - 축산물품질평가원(KAPE) 공식 API.
data.go.kr "축산물품질평가원_축산물등급판정정보"(15058822).

API가 startYmd~endYmd "범위"를 받아 그 구간 전체의 가중평균을 돌려주므로,
하루하루 부르는 대신 "주(월요일~일요일) 단위로 한 번에" 불러서 호출 수를 줄인다.
(2019년부터 지금까지 매일 부르면 수천 번, 주 단위면 400번 정도로 충분)

소: http://data.ekape.or.kr/openapi-data/service/user/grade/auct/cattle
돼지: http://data.ekape.or.kr/openapi-data/service/user/grade/auct/pigPriceDetail

각 오퍼레이션은 여러 등급별 행을 반환하는데 "평균"(전체 등급 가중평균) 행이 헤드라인,
나머지 등급별 행(1+/1/2/등외 등)은 겹쳐보기용으로 같이 저장.

산출: data/auction_price.json
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
BASE = "http://data.ekape.or.kr/openapi-data/service/user/grade/auct"
OUTPUT_PATH = "data/auction_price.json"

DATA_START = date(2019, 1, 1)  # 최초 시딩(파일 없을 때)만 여기서부터 전체
RECENT_WEEKS = 13  # 파일 있으면 최근 13주(약 3개월)만 재수집
MIN_RELIABLE_CNT = 500


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
    return [{c.tag: c.text for c in item} for item in root.findall(".//item")]


def week_ranges(start: date, end: date):
    """start를 포함하는 주의 월요일부터, end까지 (월,일) 튜플 생성."""
    cur = start - timedelta(days=start.weekday())  # 그 주 월요일로 보정
    while cur <= end:
        week_end = min(cur + timedelta(days=6), end)
        iso_year, iso_week, _ = cur.isocalendar()
        yield cur, week_end, iso_year, iso_week
        cur += timedelta(days=7)


def fetch_range(op: str, start: date, end: date) -> list:
    return _call(op, {"startYmd": start.strftime("%Y%m%d"), "endYmd": end.strftime("%Y%m%d")})


def build_series(op: str, amt_key: str, cnt_key: str, grade_key: str, prev_weekly: list) -> list:
    today = date.today()
    start = DATA_START if not prev_weekly else (today - timedelta(weeks=RECENT_WEEKS))
    new_rows = {}
    for wk_start, wk_end, iso_year, iso_week in week_ranges(start, today):
        rows = fetch_range(op, wk_start, wk_end)
        time.sleep(0.2)
        if not rows:
            continue
        avg_row = next((r for r in rows if r.get(grade_key) == "평균"), None)
        if avg_row is None or not avg_row.get(amt_key):
            continue
        cnt = int(avg_row[cnt_key]) if avg_row.get(cnt_key) else 0
        if cnt < MIN_RELIABLE_CNT:
            continue
        by_grade = {
            r.get(grade_key): {"amt": r.get(amt_key), "cnt": r.get(cnt_key)}
            for r in rows if r.get(grade_key) and r.get(grade_key) != "평균"
        }
        label = f"{iso_year % 100:02d}-{iso_week:02d}"
        new_rows[label] = {
            "label": label,
            "weekStart": wk_start.isoformat(),
            "avgAmt": float(avg_row[amt_key]),
            "avgCnt": cnt,
            "byGrade": by_grade,
        }
    merged = {r["label"]: r for r in prev_weekly}
    merged.update(new_rows)  # 최근 주는 새 값으로 덮어씀
    return sorted(merged.values(), key=lambda r: r["weekStart"]), len(new_rows)


def main():
    existing = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f).get("species", {})
        except Exception:
            existing = {}

    print("소 수집 중...")
    prev_cattle = existing.get("소", {}).get("weekly", [])
    cattle_weekly, n_new = build_series("cattle", "CTotAmt", "CTotCnt", "gradeNm", prev_cattle)
    print(f"  -> 누적 {len(cattle_weekly)}주 (이번 갱신 {n_new}주)")

    print("돼지 수집 중...")
    prev_pig = existing.get("돼지", {}).get("weekly", [])
    pig_weekly, n_new2 = build_series("pigPriceDetail", "auctAmt", "auctCnt", "gradeNm", prev_pig)
    print(f"  -> 누적 {len(pig_weekly)}주 (이번 갱신 {n_new2}주)")

    result = {
        "species": {
            "소": {"unit": "원/kg(지육)", "weekly": cattle_weekly},
            "돼지": {"unit": "원/kg(지육)", "weekly": pig_weekly},
        },
        "source": "축산물품질평가원(KAPE) 도매시장 경락가격 - 전국 주간 가중평균",
        "updatedAt": date.today().isoformat(),
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
