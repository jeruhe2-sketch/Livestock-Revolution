# -*- coding: utf-8 -*-
"""
impfood.mfds.go.kr 정찰 스크립트 v2.
run_id를 파일명에 넣어서 매번 새 파일로 남기고, print 대신 파일에 직접 기록해서
결과가 확실히 커밋되도록 한다.
"""
import os
import json
from playwright.sync_api import sync_playwright

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
BASE_URL = "https://impfood.mfds.go.kr/ifs/websquare/websquare.html?w2xPath=/ifs/ui/index.xml"

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def main():
    os.makedirs("debug", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        log("1) 메인 페이지 접속")
        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)

        log("2) '수입식품' 클릭")
        try:
            page.get_by_text("수입식품", exact=True).first.click(timeout=5000)
            log("  성공")
        except Exception as e:
            log(f"  실패: {e}")
        page.wait_for_timeout(1500)

        try:
            page.screenshot(path=f"debug/impfood_v2_{RUN_ID}_step2.png", full_page=True)
        except Exception as e:
            log(f"스크린샷 실패: {e}")

        log("3) '냉장/냉동-부위-국가' 텍스트 탐색")
        try:
            candidates = page.get_by_text("냉장/냉동-부위-국가", exact=False)
            count = candidates.count()
            log(f"  개수: {count}")
            for i in range(count):
                try:
                    txt = candidates.nth(i).inner_text(timeout=2000)
                    log(f"  [{i}] {txt!r}")
                except Exception as e:
                    log(f"  [{i}] 오류: {e}")
            if count > 0:
                candidates.first.click(timeout=5000)
                log("  첫번째 항목 클릭함")
            else:
                # 텍스트를 못찾으면 전체 body 텍스트를 남겨서 실제 메뉴 구조 확인
                body_text = page.locator("body").inner_text()
                with open(f"debug/impfood_v2_{RUN_ID}_body.txt", "w", encoding="utf-8") as f:
                    f.write(body_text[:15000])
                log("  전체 body 텍스트 저장함 (못찾아서)")
        except Exception as e:
            log(f"  오류: {e}")

        page.wait_for_timeout(3000)
        try:
            page.screenshot(path=f"debug/impfood_v2_{RUN_ID}_step3.png", full_page=True)
        except Exception as e:
            log(f"스크린샷 실패: {e}")

        log("4) input 요소 전수 조사 (품명/날짜 입력창 후보)")
        try:
            inputs = page.locator("input")
            icount = inputs.count()
            log(f"  input 전체 개수: {icount}")
            for i in range(icount):
                try:
                    el = inputs.nth(i)
                    itype = el.get_attribute("type") or ""
                    ival = ""
                    try:
                        ival = el.input_value(timeout=500)
                    except Exception:
                        pass
                    box = el.bounding_box(timeout=500)
                    log(f"  input[{i}] type={itype!r} value={ival!r} box={box}")
                except Exception as e:
                    log(f"  input[{i}] 오류: {e}")
        except Exception as e:
            log(f"  오류: {e}")

        with open(f"debug/impfood_v2_explore_{RUN_ID}.log", "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))

        browser.close()


if __name__ == "__main__":
    main()
