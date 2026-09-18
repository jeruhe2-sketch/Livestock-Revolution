# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) "돈육 부산물 시세"(공장출고가, 원/kg) 수집.
https://www.kmta.or.kr/kr/price/pork_etc.php

구조는 fetch_kmta_pork_price.py(부위별시세)와 완전히 동일한 폼(ymw_y/m/w 범위,
scode=6)이지만 테이블이 훨씬 단순함 - 일반/브랜드, 냉장/냉동 구분 없이 부산물별
가격 한 칸씩만("두내장", "등뼈", "족발", "A지방", "돈피" 등, 사이트에서 늘어나면
자동으로 같이 잡힘).

실제로 조회해보니 2008년까지는 전부 "0"(부위별시세와 같은 "거래없음=0" 표기 버릇),
2010년부터 실제 값이 나옴 - 그래서 2003~2009는 전부 걸러지고 자동으로 2010년부터만
저장됨(별도 시작연도 하드코딩 불필요, 0=null 처리만 해두면 알아서 그렇게 됨).

산출: data/kmta_pork_etc.json
  {source, sourceUrl, updatedAt,
   weeks: [{label, year, month, week, items: {"두내장": 18000, ...}}]}
"""
import json
import os
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

URL = "https://www.kmta.or.kr/kr/price/pork_etc.php?scode=6&kej="
SOURCE_URL = "https://www.kmta.or.kr/kr/price/pork_etc.php"
OUTPUT_PATH = "data/kmta_pork_etc.json"

DATA_START_YEAR = 2003  # 실제 유효 데이터는 2010년부터지만, 0=거래없음 필터가 알아서
                         # 그 이전은 다 걸러내므로 시작연도를 낮게 잡아둬도 무해함
RECHECK_MONTHS = 3
WEEKS = ["1", "2", "3", "4", "5"]


def _num(s):
    s = (s or "").strip().replace(",", "")
    if not s:
        return None
    try:
        v = float(s) if "." in s else int(s)
    except ValueError:
        return None
    # fetch_kmta_pork_price.py와 같은 이유: 이 사이트는 거래없음을 "0"으로 씀
    return None if v == 0 else v


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
    items = {}
    for tr in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) != 2:
            continue
        name, val = cells[0], _num(cells[1])
        if val is not None:
            items[name] = val
    return items or None


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
                    items = fetch_week(session, y, m, w)
                except Exception as e:
                    print(f"ERROR {y}-{m:02d} W{w}: {e}", file=sys.stderr)
                    errors += 1
                    time.sleep(1)
                    continue
                if items is None:
                    skipped += 1
                    continue
                existing[key] = {"label": f"{y}-{m:02d} {w}주", "year": y, "month": m, "week": w, "items": items}
                fetched += 1
                time.sleep(0.2)

    weeks = [existing[k] for k in sorted(existing.keys())]
    out = {
        "source": "KMTA(한국육류유통수출협회)",
        "sourceUrl": SOURCE_URL,
        "updatedAt": today.isoformat(),
        "weeks": weeks,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"완료: {fetched}건 갱신, {skipped}건 데이터없음, {errors}건 에러, 총 {len(weeks)}건 저장 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
