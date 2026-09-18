# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) "돈육 부위별시세"(공장출고가, 원/kg) 수집.
https://www.kmta.or.kr/kr/price/pork.php

공식 API가 아니라 공개 웹페이지를 폼 POST로 그대로 흉내내서 가져온다(로그인/캡차 없음,
robots.txt 제한 없음, 개인/내부용 참고 목적 - 협회 홈페이지 이용약관 범위 내).

폼 파라미터: ymw_y/ymw_m/ymw_w ~ ymw2_y/ymw2_m/ymw2_w (연/월/주 범위, 주는 1~5,
실제로는 보통 1~4). 응답은 <table class="table1"> 안에 부위별 x (일반/브랜드 x 냉장/냉동)
5열 표.

발행 주기: 주 단위, 다만 실제로는 발행 시차가 2주 정도 있어서 "이번 달 마지막 주"가
아직 안 나와 있는 경우가 흔함(예: 9/18에 조회해도 8월 4주차까지만 있고 9월은 전부 비어있는
식) - KAPE 재고동향의 "집계 시차 2~3개월"과 같은 종류의, 사이트 쪽 사정. 그래서 매번
전체 기간을 다시 긁는 대신, 최근 몇 달은 "비어있을 수 있다"고 보고 늘 재확인하고, 그보다
이전 달은 한번 채워지면 안 바뀐다고 보고 건너뛴다.

산출: data/kmta_pork_price.json
  {
    source, sourceUrl, updatedAt,
    weeks: [
      {label:"2026-08 4주", year, month, week,
       parts: {"삼겹살": {general:{fresh,frozen}, brand:{fresh,frozen}}, ...}}
    ]
  }
"""
import json
import os
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

URL = "https://www.kmta.or.kr/kr/price/pork.php?scode=3&kej="
SOURCE_URL = "https://www.kmta.or.kr/kr/price/pork.php"
OUTPUT_PATH = "data/kmta_pork_price.json"

DATA_START_YEAR = 2003  # 실제 최초 조회해보니 2003-01부터 데이터가 있었음(사이트가 지원하는 만큼 전부)
RECHECK_MONTHS = 3  # 파일 있으면 최근 3개월치만 매번 다시 확인(발행 시차 대응)
WEEKS = ["1", "2", "3", "4", "5"]


def _num(s):
    s = (s or "").strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def fetch_week(session, y, m, w):
    resp = session.post(
        URL,
        data={"ymw_y": str(y), "ymw_m": f"{m:02d}", "ymw_w": str(w),
              "ymw2_y": str(y), "ymw2_m": f"{m:02d}", "ymw2_w": str(w)},
        timeout=20,
    )
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.select_one("table.table1")
    if not table:
        return None
    rows = table.find_all("tr")
    parts = {}
    for tr in rows[2:]:
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 5:
            continue
        name = cells[0]
        vals = [_num(v) for v in cells[1:5]]
        if all(v is None for v in vals):
            continue  # 그 부위 데이터가 그 주에 아예 없음
        parts[name] = {
            "general": {"fresh": vals[0], "frozen": vals[1]},
            "brand": {"fresh": vals[2], "frozen": vals[3]},
        }
    if not parts:
        return None
    return parts


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0", "Referer": SOURCE_URL})

    existing = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            prev = json.load(f)
        for w in prev.get("weeks", []):
            existing[(w["year"], w["month"], w["week"])] = w

    today = date.today()
    if existing:
        # 증분: 최근 RECHECK_MONTHS개월만 다시 확인, 그 이전은 이미 있는 값 그대로 유지
        start_y, start_m = today.year, today.month
        for _ in range(RECHECK_MONTHS - 1):
            start_m -= 1
            if start_m < 1:
                start_m += 12
                start_y -= 1
        year_range = range(start_y, today.year + 1)
    else:
        start_y, start_m = DATA_START_YEAR, 1
        year_range = range(DATA_START_YEAR, today.year + 1)

    fetched, skipped, errors = 0, 0, 0
    for y in year_range:
        m_start = start_m if y == start_y else 1
        m_end = today.month if y == today.year else 12
        for m in range(m_start, m_end + 1):
            for w in WEEKS:
                key = (y, m, w)
                try:
                    parts = fetch_week(session, y, m, w)
                except Exception as e:
                    print(f"ERROR {y}-{m:02d} W{w}: {e}", file=sys.stderr)
                    errors += 1
                    time.sleep(1)
                    continue
                if parts is None:
                    skipped += 1
                    if key in existing:
                        pass  # 기존에 있던 값은 유지(과거엔 있었는데 지금 조회가 어쩌다 비어오면 덮어쓰지 않음)
                    continue
                existing[key] = {
                    "label": f"{y}-{m:02d} {w}주", "year": y, "month": m, "week": w,
                    "parts": parts,
                }
                fetched += 1
                time.sleep(0.25)

    weeks = [existing[k] for k in sorted(existing.keys())]
    out = {
        "source": "KMTA(한국육류유통수출협회)",
        "sourceUrl": SOURCE_URL,
        "updatedAt": today.isoformat(),
        "weeks": weeks,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=None, separators=(",", ":"))
    print(f"완료: {fetched}건 갱신, {skipped}건 데이터없음, {errors}건 에러, 총 {len(weeks)}건 저장 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
