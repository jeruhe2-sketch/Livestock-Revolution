# -*- coding: utf-8 -*-
"""
(사)한국육류유통수출협회(KMTA) 리포트 게시판 4종 - 제목/작성일만 수집.
  - 주간판매동향   /kr/info/week.php         (mode=weekselltrend)
  - 월간시장동향   /kr/info/pork_market.php  (mode=porktrend)
  - 시장전망칼럼   /kr/info/distribution.php (tb_board=columntrend)
  - 축산관측(KREI) /kr/info/krei.php         (mode=krei)

이 4개는 가격표 데이터가 아니라 실제 작성된 글(칼럼/리포트, 첨부파일 PDF/HWP인
경우도 많음)이라 전문을 긁어와 재게시하면 저작권 문제가 있음. 그래서 제목·
작성일·글번호만 모으고, "원문 보기"는 개별 글이 아니라 해당 게시판 목록
페이지로 링크한다(개별 글 상세보기가 POST 전용 네비게이션이라 GET으로 직접
링크가 안 됨 - 확인해봄).

목록은 페이지네이션 되어있는데(POST로 page=N), 최신 소식 배너 용도라 전체
역사(17페이지 x 4종)를 다 긁을 필요는 없다고 보고 최근 5페이지(약 70~75건,
발행주기 감안하면 월간/칼럼류는 수년치, 주간판매동향은 1년 남짓)만 수집.

산출: data/kmta_reports.json
  {source, updatedAt,
   boards: {
     "주간판매동향": {listUrl, items: [{no, title, date}, ...]},
     ...
   }}
"""
import json
import os
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

BOARDS = [
    {"label": "주간판매동향", "path": "/kr/info/week.php", "extra": {"mode": "weekselltrend"}},
    {"label": "월간시장동향", "path": "/kr/info/pork_market.php", "extra": {"mode": "porktrend"}},
    {"label": "시장전망칼럼", "path": "/kr/info/distribution.php", "extra": {"tb_board": "columntrend"}},
    {"label": "축산관측(KREI)", "path": "/kr/info/krei.php", "extra": {"mode": "krei"}},
]
BASE = "https://www.kmta.or.kr"
OUTPUT_PATH = "data/kmta_reports.json"
PAGES_PER_BOARD = 5


def fetch_board(session, board):
    url = BASE + board["path"]
    items = []
    for page in range(1, PAGES_PER_BOARD + 1):
        data = {"typ": "list", "page": str(page), "cate": "", "comcd": "", "list_url": board["path"]}
        data.update(board["extra"])
        resp = session.post(url, data=data, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.find_all("tr")
        page_items = []
        for tr in rows:
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) != 3 or cells[0] == "번호":
                continue
            no, title, d = cells
            if not no.isdigit():
                continue
            page_items.append({"no": no, "title": title, "date": d})
        if not page_items:
            break  # 더 이상 페이지 없음
        items.extend(page_items)
        time.sleep(0.3)
    return items


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0", "Referer": BASE})

    boards_out = {}
    for board in BOARDS:
        try:
            items = fetch_board(session, board)
        except Exception as e:
            print(f"ERROR {board['label']}: {e}")
            items = []
        # 글번호 기준 중복 제거 + 최신순 정렬(글번호 클수록 최신이라고 가정)
        by_no = {it["no"]: it for it in items}
        sorted_items = sorted(by_no.values(), key=lambda x: int(x["no"]), reverse=True)
        boards_out[board["label"]] = {
            "listUrl": BASE + board["path"],
            "items": sorted_items,
        }
        print(f"{board['label']}: {len(sorted_items)}건")

    out = {
        "source": "KMTA(한국육류유통수출협회)",
        "updatedAt": date.today().isoformat(),
        "boards": boards_out,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"완료 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
