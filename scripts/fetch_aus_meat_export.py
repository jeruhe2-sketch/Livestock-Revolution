# -*- coding: utf-8 -*-
"""
호주 농림부(DAFF, agriculture.gov.au) "Australian red meat export statistics"의
월별 "57 Destination Report" 엑셀 파일을 Playwright로 다운로드해서
목표 10개국 소고기(Beef & Veal) 수출 데이터를 data/aus_meat_export.json으로 저장한다.

⚠️ 이 스크립트는 실제 사이트의 다운로드 링크 구조/엑셀 컬럼 레이아웃을
   Claude가 직접 확인하지 못한 상태로 작성됨 (샌드박스 네트워크 제한으로
   agriculture.gov.au 접근 불가, web_fetch는 텍스트 추출만 되고 href가 안 보임).
   따라서 최초 1회는 반드시 --merge 없이(검증 모드) 실행해서
   debug/aus_trade_parsed_*.json 을 사람이 직접 확인한 뒤 --merge로 진행할 것.

사용법:
  python scripts/fetch_aus_meat_export.py            # 검증 모드 (병합 안 함)
  python scripts/fetch_aus_meat_export.py --merge    # 실제 병합

대상 목적지 (57개 중 10개만 사용):
  China, Hong Kong, Indonesia, Japan, Philippines,
  South Korea, Taiwan, Thailand, USA East Coast, USA West Coast
"""
import json
import os
import re
import sys
import traceback
from playwright.sync_api import sync_playwright
import pandas as pd

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
MAIN_URL = "https://www.agriculture.gov.au/biosecurity-trade/export/controlled-goods/meat/statistics"
# 과거 연도별 서브페이지. 실제 슬러그는 사이트에서 확인 필요 (아래는 추정치이며
# 스크립트 실행 시 메인 페이지의 사이드바 링크를 그대로 따라가는 방식으로 재확인함)
YEAR_PAGE_SLUGS = {y: f"red-meat-stats-{y}" for y in range(2013, 2026)}

DOWNLOAD_DIR = "debug/aus_trade_downloads"
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aus_meat_export.json")

# 목적지 표시명 -> 우리 코드. 실제 파일의 표기가 약간 다를 수 있어 부분일치로 매칭.
DEST_MATCH = {
    "CN": ["china"],
    "HK": ["hong kong"],
    "ID": ["indonesia"],
    "JP": ["japan"],
    "PH": ["philippines"],
    "KR": ["korea", "south korea"],
    "TW": ["taiwan"],
    "TH": ["thailand"],
    "US_EAST": ["usa east", "us east coast", "united states east"],
    "US_WEST": ["usa west", "us west coast", "united states west"],
}
DEST_LABEL = {
    "CN": "China", "HK": "Hong Kong", "ID": "Indonesia", "JP": "Japan",
    "PH": "Philippines", "KR": "South Korea", "TW": "Taiwan", "TH": "Thailand",
    "US_EAST": "USA East", "US_WEST": "USA West",
}

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def match_dest_code(cell_text):
    if not isinstance(cell_text, str):
        return None
    t = cell_text.strip().lower()
    for code, hints in DEST_MATCH.items():
        for h in hints:
            if h in t:
                return code
    return None


def collect_download_links(page, keyword="m57dest"):
    """현재 페이지(DOM)에서 keyword가 포함된 실제 href를 가진 링크를 모두 찾는다.
    (텍스트만 봐서는 실제 파일 URL을 알 수 없어서, 반드시 실제 렌더링된 DOM에서
    anchor의 href 속성을 직접 읽어야 함.)"""
    anchors = page.eval_on_selector_all(
        "a[href]",
        "els => els.map(e => ({href: e.href, text: e.textContent.trim()}))",
    )
    hits = []
    for a in anchors:
        href = a.get("href", "")
        text = a.get("text", "")
        if keyword in href.lower() or keyword in text.lower():
            hits.append(a)
    return hits


def download_via_href(context, href, save_path):
    """href를 새 페이지에서 직접 열어서 다운로드 이벤트를 받는다."""
    page = context.new_page()
    try:
        with page.expect_download(timeout=30000) as dl_info:
            page.goto(href, timeout=30000)
        download = dl_info.value
        download.save_as(save_path)
        return True
    except Exception as e:
        log(f"    다운로드 실패 ({href}): {e}")
        return False
    finally:
        page.close()


def diagnose_connectivity():
    """Playwright 문제인지 네트워크(IP 차단) 문제인지 구분하기 위한 사전 진단."""
    import requests
    try:
        r = requests.get(MAIN_URL, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        log(f"[진단] requests GET 상태코드={r.status_code}, 응답길이={len(r.content)}")
    except Exception as e:
        log(f"[진단] requests GET 실패: {type(e).__name__}: {e}")


def download_all():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    diagnose_connectivity()
    saved = {}  # (year, month) -> path
    with sync_playwright() as p:
        # net::ERR_HTTP2_PROTOCOL_ERROR 회피: HTTP/2 비활성화 + networkidle 대신
        # domcontentloaded 사용(이 사이트는 추적 스크립트 때문에 networkidle이 잘 안 옴)
        browser = p.chromium.launch(args=["--disable-http2"])
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        def goto_with_retry(pg, url, tries=3):
            last_err = None
            for attempt in range(tries):
                try:
                    pg.goto(url, wait_until="domcontentloaded", timeout=45000)
                    pg.wait_for_timeout(1500)
                    return
                except Exception as e:
                    last_err = e
                    log(f"    goto 실패(시도 {attempt + 1}/{tries}): {e}")
                    pg.wait_for_timeout(3000)
            raise last_err

        # 1) 메인 페이지: 최근 몇 개월치
        log("메인 통계 페이지 접속")
        goto_with_retry(page, MAIN_URL)
        hits = collect_download_links(page, "m57dest")
        log(f"메인 페이지에서 m57dest 링크 {len(hits)}개 발견")
        for h in hits:
            m = re.search(r"(\d{2})(\d{2})", h["text"] or h["href"])
            if not m:
                continue
            yy, mm = int(m.group(1)), int(m.group(2))
            year = 2000 + yy
            save_path = os.path.join(DOWNLOAD_DIR, f"{year}-{mm:02d}.xlsx")
            if download_via_href(context, h["href"], save_path):
                saved[(year, mm)] = save_path
                log(f"  {year}-{mm:02d} 다운로드 성공")

        # 2) 사이드바에서 과거 연도 페이지 링크를 실제로 따라가서(하드코딩 슬러그 대신)
        #    "Red meat export statistics YYYY" 텍스트를 가진 링크를 순회
        sidebar_links = page.eval_on_selector_all(
            "a[href]",
            "els => els.map(e => ({href: e.href, text: e.textContent.trim()}))",
        )
        year_pages = {}
        for a in sidebar_links:
            m = re.match(r"Red meat export statistics (\d{4})$", a["text"] or "")
            if m:
                year_pages[int(m.group(1))] = a["href"]
        log(f"연도별 페이지 링크 {len(year_pages)}개 발견: {sorted(year_pages.keys())}")

        for year, url in sorted(year_pages.items()):
            try:
                goto_with_retry(page, url)
                hits = collect_download_links(page, "m57dest")
                log(f"{year} 페이지: m57dest 링크 {len(hits)}개")
                for h in hits:
                    m = re.search(r"(\d{2})(\d{2})", h["text"] or h["href"])
                    if not m:
                        continue
                    yy, mm = int(m.group(1)), int(m.group(2))
                    y = 2000 + yy
                    if (y, mm) in saved:
                        continue
                    save_path = os.path.join(DOWNLOAD_DIR, f"{y}-{mm:02d}.xlsx")
                    if download_via_href(context, h["href"], save_path):
                        saved[(y, mm)] = save_path
                        log(f"  {y}-{mm:02d} 다운로드 성공")
            except Exception as e:
                log(f"{year} 페이지 처리 실패: {e}")

        browser.close()
    return saved


def parse_file(path, year, month):
    """엑셀에서 목적지별 행을 찾아 소고기(Beef & Veal) 관련 수치를 뽑는다.
    실제 컬럼 헤더 문구를 모르므로, 헤더 후보 행에서 키워드로 컬럼을 찾는
    방식으로 최대한 유연하게 처리한다."""
    xl = pd.ExcelFile(path)
    sheet_name = xl.sheet_names[0]
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)

    header_row_idx = None
    col_chilled = col_frozen = col_total = col_goat = col_dest = None
    for r_idx in range(min(15, len(df))):
        row_vals = [str(v).strip().lower() for v in df.iloc[r_idx].tolist()]
        # 목적지 컬럼 찾기 힌트: "destination" 또는 "area" 헤더
        dest_candidates = [i for i, v in enumerate(row_vals) if "destination" in v or v == "area"]
        if not dest_candidates:
            continue
        header_row_idx = r_idx
        col_dest = dest_candidates[0]
        for i, v in enumerate(row_vals):
            if "chilled" in v and "beef" in v:
                col_chilled = i
            elif "frozen" in v and col_frozen is None and "beef" in v:
                col_frozen = i
            elif "beef" in v and "veal" in v and "total" in v and "chilled" not in v and "frozen" not in v:
                col_total = i
            elif "goat" in v:
                col_goat = i
        break

    if header_row_idx is None:
        log(f"  {path}: 헤더 행을 못찾음 (destination 컬럼 없음)")
        return []
    log(f"  {path}: 헤더행={header_row_idx}, dest열={col_dest}, chilled={col_chilled}, frozen={col_frozen}, total={col_total}, goat={col_goat}")

    records = []
    for r_idx in range(header_row_idx + 1, len(df)):
        dest_cell = df.iloc[r_idx, col_dest]
        code = match_dest_code(dest_cell)
        if code is None:
            continue

        def num(col):
            if col is None:
                return None
            v = df.iloc[r_idx, col]
            if pd.isna(v) or v == "-":
                return 0.0
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        chilled = num(col_chilled)
        frozen = num(col_frozen)
        total = num(col_total)
        goat = num(col_goat)
        records.append([year, month, code, chilled, frozen, total, goat])
    return records


def merge_into_json(all_records):
    existing = {"destNames": DEST_LABEL, "cols": ["year", "month", "dest", "chilledKg", "frozenKg", "totalBeefVealKg", "goatKg"], "data": []}
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    by_key = {(r[0], r[1], r[2]): r for r in existing.get("data", [])}
    for r in all_records:
        by_key[(r[0], r[1], r[2])] = r

    import datetime
    out = {
        "product": "Beef & Veal (10개 주요 목적지)",
        "sector": "Red meat",
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "granularity": "monthly",
        "destNames": DEST_LABEL,
        "cols": ["year", "month", "dest", "chilledKg", "frozenKg", "totalBeefVealKg", "goatKg"],
        "data": sorted(by_key.values(), key=lambda r: (r[0], r[1], r[2])),
    }
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"병합 완료: 총 {len(out['data'])}행")


def main():
    try:
        saved = download_all()
    except Exception:
        log("=== 다운로드 중 최상위 예외 ===")
        log(traceback.format_exc())
        saved = {}

    all_records = []
    for (year, month), path in saved.items():
        try:
            recs = parse_file(path, year, month)
            log(f"{year}-{month:02d}: {len(recs)}건 파싱")
            all_records.extend(recs)
        except Exception as e:
            log(f"{year}-{month:02d} 파싱 실패: {e}")
            log(traceback.format_exc())

    os.makedirs("debug", exist_ok=True)
    with open(f"debug/aus_trade_parsed_{RUN_ID}.json", "w", encoding="utf-8") as f:
        json.dump(all_records, f, ensure_ascii=False, indent=2)
    log(f"파싱 결과 저장: debug/aus_trade_parsed_{RUN_ID}.json (총 {len(all_records)}건)")

    if "--merge" in sys.argv:
        if all_records:
            merge_into_json(all_records)
        else:
            log("병합할 레코드가 없어서 건너뜀 (다운로드/파싱이 전부 실패했을 가능성이 높음)")
    else:
        log("검증 모드: --merge 없이 실행되어 실제 데이터 파일은 갱신하지 않음")

    with open(f"debug/aus_trade_last.log", "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


if __name__ == "__main__":
    main()
