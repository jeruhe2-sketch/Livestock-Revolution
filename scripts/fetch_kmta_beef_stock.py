# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) "소고기 재고"(부위별 추정 재고량, 톤) 수집.
https://www.kmta.or.kr/kr/info/beef_stock.php

월 단위(연/월 선택), POST 필드는 year/month 외에 숨은 필드 몇 개(typ, list_url,
page, idate, subitem, board=info4_0109, scode=9)를 그대로 같이 보내야 함
- 안 보내도 되는진 확인 안 해봄, 브라우저가 실제로 보내는 값 그대로 흉내.

응답 표는 부위별(안심 및 특수부위/등심/채끝/앞다리·설도·우둔/양지·사태/목심/갈비) + 합계 행, 그리고
"대비(%)"(전월/전년 대비)까지 있는데 이건 추정량(quantity)만 있으면 이쪽에서
다시 계산 가능한 파생값이라 저장 안 하고 quantity만 저장.

KAPE 기반 "국내 축산물 재고동향" 탭과 부위 구분 방식이 서로 달라서(KAPE는
API 자체 분류, 이건 KMTA 자체 분류) 직접 항목 대 항목 비교는 안 되지만,
서로 다른 소스로 크로스체크하기엔 좋음.

실제 조회해보니 2003년부터 값이 있음(월 단위라 백필량이 부담 없는 수준 - 24년
x 12개월 = 288회).

산출: data/kmta_beef_stock.json
  {source, sourceUrl, updatedAt, unit:"kg",
   months: [{label:"2026-06", year, month, parts:{"안심 및 특수부위":194253,...,"합계":2862460}}]}
"""
import json
import os
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

URL = "https://www.kmta.or.kr/kr/info/beef_stock.php"
OUTPUT_PATH = "data/kmta_beef_stock.json"

DATA_START_YEAR = 2003
RECHECK_MONTHS = 3


def _num(s):
    s = (s or "").strip().replace(",", "")
    if not s:
        return None
    try:
        v = float(s) if "." in s else int(s)
    except ValueError:
        return None
    return None if v == 0 else v


def fetch_month(session, y, m):
    resp = session.post(
        URL,
        data={"typ": "", "list_url": "/kr/info/beef_stock.php", "page": "1",
              "idate": "", "subitem": "", "board": "info9", "scode": "9",
              "year": str(y), "month": f"{m:02d}"},
        timeout=20,
    )
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.select_one("table.table1")
    if not table:
        return None
    parts = {}
    for tr in table.find_all("tr")[2:]:  # 헤더 2행 제외
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 2:
            continue
        name, val = cells[0], _num(cells[1])
        if val is not None:
            parts[name] = val
    return parts or None


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0", "Referer": URL})

    existing = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            prev = json.load(f)
        for mo in prev.get("months", []):
            existing[(mo["year"], mo["month"])] = mo

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
            key = (y, m)
            try:
                parts = fetch_month(session, y, m)
            except Exception as e:
                print(f"ERROR {y}-{m:02d}: {e}", file=sys.stderr)
                errors += 1
                time.sleep(1)
                continue
            if parts is None:
                skipped += 1
                continue
            existing[key] = {"label": f"{y}-{m:02d}", "year": y, "month": m, "parts": parts}
            fetched += 1
            time.sleep(0.2)

    months = [existing[k] for k in sorted(existing.keys())]
    out = {
        "source": "KMTA(한국육류유통수출협회)",
        "sourceUrl": URL,
        "updatedAt": today.isoformat(),
        "unit": "kg",
        "months": months,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"완료: {fetched}건 갱신, {skipped}건 데이터없음, {errors}건 에러, 총 {len(months)}건 저장 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
