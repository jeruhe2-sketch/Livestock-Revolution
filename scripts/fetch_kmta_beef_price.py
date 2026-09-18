# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) "한우육 부위별시세"(한우 거세우 1등급 기준,
공장출고가, 원/kg) 수집. https://www.kmta.or.kr/kr/price/beef.php

폼 구조는 fetch_kmta_pork_price.py/fetch_kmta_pork_etc.py와 동일(ymw_y/m/w 범위,
scode=7). 다만 이 페이지는 HTML이 약간 깨져있어서(<th>안심<td>...</td></th> 처럼
td가 th 안에 중첩된 행이 대부분, 첫 행만 정상 형제 태그) 이름 텍스트에 값이
같이 붙어 나옴 - th.get_text()에서 td.get_text() 부분을 빼는 방식으로 우회.

"한우"는 정의상 한국 재래종 소라 전부 국내산(수입 소고기는 이 카테고리에 안 들어감).
사이트 자체 각주: "한우 거세우 1등급 기준 공장출고가격임."

실제 조회해보니 2014~2016년 사이 어디쯤부터 값이 있고 그 전은 빈칸 -
0=거래없음 필터와 같은 이유로 빈칸/못 찾는 값은 그냥 건너뛰므로 시작연도를
정확히 특정할 필요 없음.

산출: data/kmta_beef_price.json
  {source, sourceUrl, updatedAt,
   weeks: [{label, year, month, week, parts: {"안심": 96250, ...}}]}
"""
import json
import os
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

URL = "https://www.kmta.or.kr/kr/price/beef.php?scode=7&kej="
SOURCE_URL = "https://www.kmta.or.kr/kr/price/beef.php"
OUTPUT_PATH = "data/kmta_beef_price.json"

DATA_START_YEAR = 2003
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
    parts = {}
    for tr in table.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td", class_="num_field") or tr.find("td")
        if not th or not td:
            continue
        val_text = td.get_text(strip=True)
        name = th.get_text(strip=True).replace(val_text, "").strip()
        val = _num(val_text)
        if name and val is not None:
            parts[name] = val
    return parts or None


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
                    parts = fetch_week(session, y, m, w)
                except Exception as e:
                    print(f"ERROR {y}-{m:02d} W{w}: {e}", file=sys.stderr)
                    errors += 1
                    time.sleep(1)
                    continue
                if parts is None:
                    skipped += 1
                    continue
                existing[key] = {"label": f"{y}-{m:02d} {w}주", "year": y, "month": m, "week": w, "parts": parts}
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
