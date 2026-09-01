# -*- coding: utf-8 -*-
"""
data.mafra.go.kr 동축산물 검역실적 파일 다운로드 정찰.
"""
import os
import traceback
from playwright.sync_api import sync_playwright

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
URL = "https://data.mafra.go.kr/opendata/data/indexOpenDataDetail.do?data_id=20181019000000000968"

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def main():
    os.makedirs("debug", exist_ok=True)
    os.makedirs("debug/mafra_downloads", exist_ok=True)
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()

            log("1) 페이지 접속")
            page.goto(URL, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)
            log("  성공")

            log("2) 파일 목록(2025년) 다운로드 시도")
            try:
                link = page.get_by_text("동축산물 검역실적_2025", exact=False).first
                log(f"  링크 텍스트 확인: {link.inner_text(timeout=3000)!r}")
                with page.expect_download(timeout=30000) as download_info:
                    link.click(timeout=10000)
                download = download_info.value
                save_path = f"debug/mafra_downloads/2025_{RUN_ID}.xlsx"
                download.save_as(save_path)
                log(f"  다운로드 성공: {save_path}")
                log(f"  파일 크기: {os.path.getsize(save_path)} bytes")
            except Exception as e:
                log(f"  다운로드 실패: {e}")
                page.screenshot(path=f"debug/mafra_{RUN_ID}_fail.png", full_page=True)

            browser.close()
            browser = None
    except Exception:
        log("=== 최상위 예외 ===")
        log(traceback.format_exc())
    finally:
        try:
            if browser is not None:
                browser.close()
        except Exception:
            pass
        with open(f"debug/mafra_explore_{RUN_ID}.log", "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))


if __name__ == "__main__":
    main()
