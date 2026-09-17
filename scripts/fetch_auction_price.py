# -*- coding: utf-8 -*-
"""
국내 축산물 도매시장 경락가격(소/돼지) - 축산물품질평가원(KAPE) 공식 API.
data.go.kr "축산물품질평가원_축산물등급판정정보"(15058822).

소: http://data.ekape.or.kr/openapi-data/service/user/grade/auct/cattle
돼지: http://data.ekape.or.kr/openapi-data/service/user/grade/auct/pigPriceDetail

두 오퍼레이션 모두 여러 등급별 행을 반환하는데, "평균"(전체 등급 가중평균) 행이
따로 있어 그것만 헤드라인으로 쓰고, 나머지 등급별 행도 참고용으로 같이 저장.

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

DAYS_BACK = 130  # 주말 제외하면 실질 거래일이 줄어드니 넉넉히 (약 90영업일 확보 목적)
MIN_RELIABLE_CNT = 1000  # 이보다 두수가 적은 날은 표본이 너무 작아 평균가 왜곡 위험 -> 제외


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


def fetch_cattle_day(ymd: str) -> list:
    return _call("cattle", {"startYmd": ymd, "endYmd": ymd})


def fetch_pig_day(ymd: str) -> list:
    return _call("pigPriceDetail", {"startYmd": ymd, "endYmd": ymd})


def day_iter_back(n_days: int):
    d = date.today()
    for i in range(n_days):
        yield (d - timedelta(days=i)).strftime("%Y%m%d")


def main():
    result = {"species": {}}

    # 소
    cattle_daily = []
    for ymd in day_iter_back(DAYS_BACK):
        rows = fetch_cattle_day(ymd)
        time.sleep(0.25)
        if not rows:
            continue
        avg_row = next((r for r in rows if r.get("gradeNm") == "평균"), None)
        if avg_row is None or not avg_row.get("CTotAmt"):
            continue  # 경매 없는 날(주말 등) - 값 없이 응답만 오는 경우
        cnt = int(avg_row["CTotCnt"]) if avg_row.get("CTotCnt") else 0
        if cnt < MIN_RELIABLE_CNT:
            continue  # 표본 너무 적어 평균가 왜곡되는 날 제외
        by_grade = {r.get("gradeNm"): {"amt": r.get("CTotAmt"), "cnt": r.get("CTotCnt")} for r in rows}
        cattle_daily.append({
            "date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}",
            "avgAmt": float(avg_row["CTotAmt"]),
            "avgCnt": cnt,
            "byGrade": by_grade,
        })
    cattle_daily.sort(key=lambda r: r["date"])

    # 돼지
    pig_daily = []
    for ymd in day_iter_back(DAYS_BACK):
        rows = fetch_pig_day(ymd)
        time.sleep(0.25)
        if not rows:
            continue
        avg_row = next((r for r in rows if r.get("gradeNm") == "평균"), None)
        if avg_row is None or not avg_row.get("auctAmt"):
            continue
        cnt = int(avg_row["auctCnt"]) if avg_row.get("auctCnt") else 0
        if cnt < MIN_RELIABLE_CNT:
            continue
        by_grade = {r.get("gradeNm"): {"amt": r.get("auctAmt"), "cnt": r.get("auctCnt")} for r in rows}
        pig_daily.append({
            "date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}",
            "avgAmt": float(avg_row["auctAmt"]),
            "avgCnt": cnt,
            "byGrade": by_grade,
        })
    pig_daily.sort(key=lambda r: r["date"])

    result["species"] = {
        "소": {"unit": "원/kg(지육)", "daily": cattle_daily},
        "돼지": {"unit": "원/kg(지육)", "daily": pig_daily},
    }
    result["source"] = "축산물품질평가원(KAPE) 도매시장 경락가격 - 전국 평균(등급 가중평균)"
    result["updatedAt"] = date.today().isoformat()

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    print(f"저장 완료: {OUTPUT_PATH} (소 {len(cattle_daily)}일 / 돼지 {len(pig_daily)}일)")


if __name__ == "__main__":
    main()
