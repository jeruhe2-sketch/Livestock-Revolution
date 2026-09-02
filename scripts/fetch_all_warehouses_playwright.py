# -*- coding: utf-8 -*-
"""
창고 재고 데이터 자동 수집 스크립트 - Playwright(실제 Chromium) 버전

requests 라이브러리로 직접 login.do 를 호출하는 방식(fetch_all_warehouses.py)이
브라우저에서는 되고 requests/curl로는 계속 404가 나서(원인 특정 못함),
실제 브라우저 엔진을 그대로 띄워서 로그인하는 방식으로 우회한다.

사전 준비 (최초 1회):
  pip install playwright beautifulsoup4
  playwright install chromium

사용 방법 (기존과 동일하게 환경변수 설정 후):
  python scripts/fetch_all_warehouses_playwright.py
"""

import json
import os
import sys
from datetime import datetime

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from fetch_all_warehouses import (
    WAREHOUSE_CONFIGS,
    OUTPUT_PATH,
    parse_stock_table,
    parse_acecs_table,
    apply_default_customs_status,
    load_existing,
    append_daily_history,
    now_kst,
)


def fetch_one_with_browser(playwright, cfg: dict) -> list:
    login_id = os.environ.get(cfg["id_env"])
    login_pw = os.environ.get(cfg["pw_env"])
    if not login_id or not login_pw:
        raise RuntimeError(
            f"[{cfg['창고명']}/{cfg['계정용도']}] 환경변수 {cfg['id_env']} / {cfg['pw_env']} 가 설정되지 않았습니다."
        )

    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        )

        # 1) 메인 페이지 접속 -> login.do 로 리다이렉트됨
        page.goto(cfg["base_url"] + "/", wait_until="networkidle", timeout=90000)

        # 2) 로그인 폼 채우고 제출 (실제 사람이 누르는 것과 동일)
        page.fill("input[name='id']", login_id)
        page.fill("input[name='pw']", login_pw)
        with page.expect_navigation(wait_until="networkidle", timeout=90000):
            page.click("button[type='submit']")

        # 로그인 성공 확인 (좌측 메뉴/logout 링크 존재 여부)
        if "logout.do" not in page.content():
            raise RuntimeError(
                f"[{cfg['창고명']}/{cfg['계정용도']}] 로그인 실패로 추정됩니다 (logout.do 없음). "
                "id/pw를 확인하세요."
            )

        # 3) 재고조회(셀분리) 화면으로 이동해서 hidden 필드 읽고, 전체조회 실행
        page.goto(
            f"{cfg['base_url']}/rtv_stock02.do?nav_num=0107",
            wait_until="networkidle",
            timeout=90000,
        )

        today = now_kst().strftime("%Y%m%d")
        # 통관구분을 "전체"로 설정. 재고기준일자(dt)는 사이트에 따라 readonly인 경우가 있는데,
        # 그럴 때는 이미 오늘 날짜로 기본 채워져 있으므로 건드리지 않고 넘어간다.
        page.select_option("select[name='pass_fg']", "*")
        date_input = page.locator("input[name='dt']")
        is_readonly = date_input.get_attribute("readonly") is not None
        if not is_readonly:
            date_input.fill("")
            date_input.fill(today)

        with page.expect_navigation(wait_until="networkidle", timeout=90000):
            page.click("button[type='submit']:has-text('조회')")

        # DataTables가 화면에 25건씩만 페이지네이션해서 보여주는데(사이트 기본값
        # pageLength: 25), 지금까지 이 25건만 긁어오고 있었다 - 실제 전체 건수보다
        # 훨씬 적게 수집되는 버그였음. DataTables JS API로 페이지 길이를 "전체"로
        # 바꿔서 모든 행이 DOM에 나타나게 한 뒤 읽는다.
        page.evaluate(
            """
            () => {
                const $ = window.jQuery;
                if ($ && $.fn && $.fn.dataTable) {
                    const table = $('.dataTables-example').DataTable();
                    table.page.len(-1).draw();
                }
            }
            """
        )
        page.wait_for_timeout(2000)

        html = page.content()
        rows = parse_stock_table(html, cfg["창고명"])
        if not rows:
            # 0건으로 파싱되는 경우가 간헐적으로 발생(삼진1냉장 등) - DataTables
            # 렌더링이 evaluate() 직후 2초 안에 다 안 끝났을 가능성이 있어
            # 한 번 더 기다렸다가 재파싱해본다 (완전 재로그인은 안 함, 가벼운 재시도).
            print(f"  -> [{cfg['창고명']}] 1차 파싱 0건, 3초 더 대기 후 재시도", file=sys.stderr)
            page.wait_for_timeout(3000)
            html = page.content()
            rows = parse_stock_table(html, cfg["창고명"])
        if len(rows) == 25:
            print(
                f"  -> 경고: 정확히 25건 수집됨. DataTables 페이지네이션이 여전히 "
                "걸려있을 가능성이 있으니 실제 사이트 총건수와 비교해보세요.",
                file=sys.stderr,
            )
        if not rows:
            debug_path = f"debug/snapshot_{cfg['창고명']}_{cfg['계정용도']}.html"
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(html)
            print(
                f"  -> 0건 파싱됨. 원본 페이지를 {debug_path} 에 저장했으니 "
                "이 파일을 보내주시면 표 구조를 확인할 수 있습니다.",
                file=sys.stderr,
            )
        return rows
    finally:
        browser.close()


def fetch_one_acecs(playwright, cfg: dict) -> list:
    """
    ACE CS(cs.acecs.co.kr, "Intralogis"/DevExpress ASPxGridView) 시스템 수집.
    nwill과 완전히 다른 구조라 별도 함수로 분리:
    - DataTables가 아니라 DevExpress 콜백 방식이라 요청을 직접 흉내내지 않고,
      실제 화면에서 창고 드롭다운 선택 -> 조회 버튼 클릭까지 그대로 재현한다.
    - 로그인 필드명이 확인 안 돼서 "첫 번째 text input / password input"으로
      최대한 범용적으로 찾는다.
    """
    login_id = os.environ.get(cfg["id_env"])
    login_pw = os.environ.get(cfg["pw_env"])
    if not login_id or not login_pw:
        raise RuntimeError(
            f"[{cfg['창고명']}/{cfg['계정용도']}] 환경변수 {cfg['id_env']} / {cfg['pw_env']} 가 설정되지 않았습니다."
        )

    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    )
    try:
        try:
            return _run_acecs_flow(page, cfg, login_id, login_pw)
        except Exception:
            debug_path = f"debug/snapshot_{cfg['창고명']}_{cfg['계정용도']}_실패시점.html"
            try:
                with open(debug_path, "w", encoding="utf-8") as f:
                    f.write(page.content())
                print(f"  -> 실패 시점 화면을 {debug_path} 에 저장했습니다.", file=sys.stderr)
            except Exception:
                pass
            raise
    finally:
        browser.close()


def _run_acecs_flow(page, cfg: dict, login_id: str, login_pw: str) -> list:
    # 1) 로그인 페이지 접속, id/pw 입력 (실제 로그인 폼 필드명 확인됨: UserID/UserPw/btnLogin)
    page.goto(cfg["base_url"], wait_until="networkidle", timeout=90000)
    page.fill("#UserID", login_id)
    page.fill("#UserPw", login_pw)
    with page.expect_navigation(wait_until="networkidle", timeout=90000):
        page.click("#btnLogin")

    if "General" not in page.url and "WMS" not in page.url:
        # 로그인 후 재고조회(General) 화면으로 명시적 이동
        page.goto(
            "https://cs.acecs.co.kr/IL6/WMS/General",
            wait_until="networkidle",
            timeout=90000,
        )

    # 이 사이트는 좌측 메뉴를 눌러야 "재고조회" 화면(창고 드롭다운 포함)이
    # 실제로 로드되는 구조(단순 URL 이동만으로는 기본 홈 화면만 뜸).
    try:
        page.get_by_text("재고조회", exact=True).first.click(timeout=15000)
        page.wait_for_load_state("networkidle", timeout=90000)
    except Exception:
        pass  # 이미 재고조회 화면이면 무시하고 계속 진행

    # 2) 창고 드롭다운(그리드 룩업) 열고 원하는 창고 선택
    page.wait_for_selector("#gridLookupDepotInventoryInfo_B-1", timeout=30000)
    page.click("#gridLookupDepotInventoryInfo_B-1")
    page.wait_for_selector("#gridLookupDepotInventoryInfo_DDD_gv_DXMainTable", timeout=15000)
    depot_name = cfg["depot_name"]
    page.get_by_text(depot_name, exact=True).first.click()
    page.wait_for_timeout(300)

    # 3) 조회 버튼 클릭 -> 위탁사/기간은 기본값 그대로 사용
    with page.expect_response(lambda r: "InventoryInfoList" in r.url, timeout=90000):
        page.click("#btnInventorySearch")
    page.wait_for_timeout(2000)

    # 4) 이 그리드는 기본 10건씩 페이지네이션되어 있어서(DevExpress ASPxGridView),
    # "다음 페이지" 버튼을 화면상 사라질 때까지 계속 눌러가며 전부 모은다.
    all_rows = []
    seen_page_html = set()
    for _ in range(500):  # 무한루프 방지용 안전장치
        html = page.content()
        rows = parse_acecs_table(html, cfg["창고명"])
        all_rows.extend(rows)

        next_btn = page.locator(
            "img[alt='다음 페이지'], img[alt='Next Page'], "
            ".dxp-button:has-text('다음'), a[title='다음 페이지'], a[title='Next Page']"
        ).first
        if next_btn.count() == 0:
            break
        # 비활성화(더 이상 다음 페이지 없음) 상태면 종료
        classattr = next_btn.get_attribute("class") or ""
        if "dxp-disabledButton" in classattr:
            break

        with page.expect_response(lambda r: "InventoryInfoList" in r.url, timeout=90000):
            next_btn.click()
        page.wait_for_timeout(1200)

        # 같은 페이지가 반복되면(다음 버튼이 실제로 안 눌린 경우) 무한루프 방지
        fingerprint = page.content()[:2000]
        if fingerprint in seen_page_html:
            break
        seen_page_html.add(fingerprint)

    if not all_rows:
        debug_path = f"debug/snapshot_{cfg['창고명']}_{cfg['계정용도']}.html"
        with open(debug_path, "w", encoding="utf-8") as f:
            f.write(page.content())
        print(
            f"  -> 0건 파싱됨. 원본 페이지를 {debug_path} 에 저장했으니 "
            "이 파일을 보내주시면 표 구조를 확인할 수 있습니다.",
            file=sys.stderr,
        )
    return all_rows


def main():
    existing = load_existing()
    existing_rows = existing.get("데이터", [])

    all_new_rows = []
    had_error = False
    # (창고명, 통관상태) 단위로 "이번 실행에서 이 조합을 책임지는 계정이 성공적으로 돌았는지"를
    # 직접 추적한다. 예전엔 all_new_rows에 그 조합의 행이 하나라도 있어야만 교체했는데,
    # 삼진1냉장처럼 통관/미통관을 한 계정이 같이 긁는 경우 실제로 미통관 재고가 0건이 되면
    # 그 조합이 결과에 아예 안 나타나서 "수집 실패"로 오인되어 옛날 재고가 영원히 안 지워지는
    # 버그가 있었음 (실사례: 삼진1냉장 미통관 3개 품목이 20시간+ 고정).
    succeeded_replace_keys = set()

    with sync_playwright() as p:
        for cfg in WAREHOUSE_CONFIGS:
            try:
                if cfg.get("system") == "acecs":
                    rows = fetch_one_acecs(p, cfg)
                else:
                    rows = fetch_one_with_browser(p, cfg)
                apply_default_customs_status(rows, cfg)
                print(f"[{cfg['창고명']}/{cfg['계정용도']}] {len(rows)}건 수집")
                all_new_rows.extend(rows)

                usage = cfg.get("계정용도", "")
                if "미통관" in usage:
                    responsible_statuses = {"미통관"}
                elif "통관" in usage:
                    responsible_statuses = {"통관"}
                else:  # "전체" 등 구분 없는 단일 계정 -> 통관/미통관 둘 다 이 계정이 책임짐
                    responsible_statuses = {"통관", "미통관"}
                for st in responsible_statuses:
                    succeeded_replace_keys.add((cfg["창고명"], st))
            except Exception as e:  # noqa: BLE001
                had_error = True
                print(f"[오류] {cfg['창고명']}/{cfg['계정용도']} 수집 실패: {e}", file=sys.stderr)

    if not all_new_rows and had_error:
        print("모든 신규 창고 수집이 실패하여 기존 데이터를 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 버그 수정: "창고명"만 기준으로 지우면, 같은 창고의 다른 통관상태(예: 대청냉장/통관)까지
    # 통째로 사라진다. 이번에 "성공적으로 수집을 시도한" (창고명, 통관상태) 조합만 정확히 교체한다.
    # (수집된 행이 0건이어도, 그 조합을 책임지는 계정이 이번에 성공했다면 확실히 비운다.)
    kept_rows = [
        r for r in existing_rows
        if (r.get("창고명"), r.get("통관상태")) not in succeeded_replace_keys
    ]
    merged_rows = kept_rows + all_new_rows

    output = {
        "수집시각": now_kst().isoformat(),
        "총건수": len(merged_rows),
        "데이터": merged_rows,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    append_daily_history(merged_rows)

    print(f"완료: 총 {len(merged_rows)}건 저장 ({OUTPUT_PATH})")


if __name__ == "__main__":
    main()
