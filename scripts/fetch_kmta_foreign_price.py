# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) "해외시세"(돈육 지육가격, US$/kg, 국가별) 수집.
https://www.kmta.or.kr/kr/price/foreign.php

다른 KMTA 페이지들과 달리 이 페이지는 특이하게 ymw_y/m/w ~ ymw2_y/m/w
범위를 한 번에 다 던지면(예: 2003-01-1주 ~ 오늘) **그 사이 전체 주차를 한
HTTP 요청으로 다 돌려준다** (2003~2026 전체가 요청 1번, 응답 1187행).
그래서 이 스크립트는 fetch_kmta_*_price.py들과 달리 주차별로 나눠 부르지
않고 매번 "전체 기간 통짜 요청 1번"으로 끝냄 - 증분/재확인 로직 자체가
필요 없음(그냥 매번 최신까지 통째로 다시 받아서 덮어씀).

단위: US$/kg, 지육가격 기준(※※ 각주). 일본만 "동경시장 기준"(※ 각주).
국가: 미국/일본/캐나다/벨기에/덴마크/프랑스/네덜란드(돈육 수출국 위주 - 소고기
수출국인 호주/뉴질랜드는 없음 -> 이 표는 돈육 국제가 비교용으로 판단됨).
표 마지막 "평균" 행은 국가별 전체기간 평균이라 주차 데이터가 아니므로 제외.

산출: data/kmta_foreign_price.json
  {source, sourceUrl, updatedAt, unit, countries: [...],
   weeks: [{label, year, month, week, byCountry: {"미국":1.14, ...}}]}
"""
import json
import os
import re
from datetime import date

import requests
from bs4 import BeautifulSoup

URL = "https://www.kmta.or.kr/kr/price/foreign.php?scode=5&kej="
SOURCE_URL = "https://www.kmta.or.kr/kr/price/foreign.php"
OUTPUT_PATH = "data/kmta_foreign_price.json"

LABEL_RE = re.compile(r"^(\d{4})년\s*(\d{2})월\s*(\d)주$")


def _num(s):
    s = (s or "").strip().replace(",", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    # 다른 KMTA 페이지와 같은 이유: 데이터없음을 "0.00"으로 표기함
    return None if v == 0 else v


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0", "Referer": SOURCE_URL})

    today = date.today()
    resp = session.post(
        URL,
        data={"ymw_y": "2003", "ymw_m": "01", "ymw_w": "1",
              "ymw2_y": str(today.year), "ymw2_m": f"{today.month:02d}", "ymw2_w": "5"},
        timeout=60,
    )
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.select_one("table.table1")
    if not table:
        raise SystemExit("table.table1을 찾을 수 없음 - 페이지 구조가 바뀌었을 수 있음")

    rows = table.find_all("tr")
    header = [c.get_text(strip=True) for c in rows[0].find_all(["td", "th"])]
    countries = header[1:]

    weeks = []
    for tr in rows[1:]:
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) != len(header):
            continue
        m = LABEL_RE.match(cells[0])
        if not m:
            continue  # "평균" 등 요약행 제외
        y, mo, w = int(m.group(1)), int(m.group(2)), m.group(3)
        by_country = {}
        for name, val_text in zip(countries, cells[1:]):
            val = _num(val_text)
            if val is not None:
                by_country[name] = val
        if by_country:
            weeks.append({"label": f"{y}-{mo:02d} {w}주", "year": y, "month": mo, "week": w, "byCountry": by_country})

    out = {
        "source": "KMTA(한국육류유통수출협회)",
        "sourceUrl": SOURCE_URL,
        "updatedAt": today.isoformat(),
        "unit": "US$/kg",
        "countries": countries,
        "weeks": weeks,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"완료: {len(weeks)}주 저장 ({OUTPUT_PATH}), 국가 {len(countries)}개: {countries}")


if __name__ == "__main__":
    main()
