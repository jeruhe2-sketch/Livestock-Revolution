# -*- coding: utf-8 -*-
"""
impfood.mfds.go.kr 정찰 스크립트 v2.
어디서 죽든 finally에서 로그를 무조건 파일로 남긴다 (v1의 실패 원인 수정).
"""
import os
import traceback
from playwright.sync_api import sync_playwright

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
BASE_URL = "https://impfood.mfds.go.kr/ifs/websquare/websquare.html?w2xPath=/ifs/ui/index.xml"

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def main():
    os.makedirs("debug", exist_ok=True)
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()

            log("1) 메인 페이지 접속")
            try:
                page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
            except Exception as e:
                log(f"  goto(networkidle) 실패: {e}")
                log("  domcontentloaded로 재시도")
                page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2000)

            log("2) '수입식품' 클릭")
            try:
                page.get_by_text("수입식품", exact=True).first.click(timeout=5000)
                log("  성공")
            except Exception as e:
                log(f"  실패: {e}")
            page.wait_for_timeout(1500)

            log("2-1) '일반현황' 클릭")
            try:
                page.get_by_text("일반현황", exact=True).first.click(timeout=5000)
                log("  성공")
            except Exception as e:
                log(f"  실패: {e}")
            page.wait_for_timeout(1500)

            try:
                page.screenshot(path=f"debug/impfood_v2_{RUN_ID}_step2.png", full_page=True)
                log("  step2 스크린샷 저장함")
            except Exception as e:
                log(f"  스크린샷 실패: {e}")

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
                    body_text = page.locator("body").inner_text()
                    with open(f"debug/impfood_v2_{RUN_ID}_body.txt", "w", encoding="utf-8") as f:
                        f.write(body_text[:15000])
                    log("  전체 body 텍스트 저장함 (못찾아서)")
            except Exception as e:
                log(f"  오류: {e}")

            page.wait_for_timeout(3000)
            try:
                page.screenshot(path=f"debug/impfood_v2_{RUN_ID}_step3.png", full_page=True)
                log("  step3 스크린샷 저장함")
            except Exception as e:
                log(f"  스크린샷 실패: {e}")

            log("4) input 요소 전수 조사")
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

            log("5) '품명' 입력 및 검색 시도")
            try:
                label = page.get_by_text("품명", exact=True).first
                label_box = label.bounding_box(timeout=3000)
                log(f"  '품명' 라벨 위치: {label_box}")
                text_inputs = page.locator("input[type='text']")
                icount = text_inputs.count()
                target_input = None
                best_dist = None
                for i in range(icount):
                    try:
                        box = text_inputs.nth(i).bounding_box(timeout=500)
                        if not box or not label_box:
                            continue
                        if abs(box["y"] - label_box["y"]) < 20 and box["x"] > label_box["x"]:
                            dist = box["x"] - label_box["x"]
                            if best_dist is None or dist < best_dist:
                                best_dist = dist
                                target_input = i
                    except Exception:
                        continue
                log(f"  '품명' 입력창 추정 index(type=text 중): {target_input}")

                # 처리일자(시작/종료) input은 type이 지정 안 된(text도 아닌) input으로 확인됨
                all_inputs = page.locator("input")
                aicount = all_inputs.count()
                date_inputs = []
                for i in range(aicount):
                    try:
                        el = all_inputs.nth(i)
                        itype = el.get_attribute("type") or ""
                        val = el.input_value(timeout=500)
                        if itype == "" and "-" in val and len(val) == 10:
                            date_inputs.append(i)
                    except Exception:
                        continue
                log(f"  날짜 input으로 추정되는 index들: {date_inputs}")

                if len(date_inputs) >= 2:
                    start_el = all_inputs.nth(date_inputs[0])
                    end_el = all_inputs.nth(date_inputs[1])
                    for el, val in [(start_el, "2019-01-01"), (end_el, "2019-01-31")]:
                        el.click()
                        page.keyboard.press("Control+A")
                        page.keyboard.press("Delete")
                        el.type(val, delay=50)
                        page.keyboard.press("Tab")
                    log("  날짜 2019-01-01 ~ 2019-01-31 입력함")

                if target_input is not None:
                    el = text_inputs.nth(target_input)
                    el.click()
                    page.keyboard.press("Control+A")
                    page.keyboard.press("Delete")
                    el.type("소고기", delay=100)
                    log("  '소고기' 타이핑 입력함 (검증용: 데이터 있는 게 확실한 품목)")
                    page.wait_for_timeout(500)

                    cur_val = el.input_value(timeout=1000)
                    log(f"  입력창 현재 값(클릭 전) 확인: {cur_val!r}")

                    # '검색' 텍스트가 페이지 상단 전역검색 아이콘에도 있어서 .first는 위험함.
                    # 필터 폼 영역(y가 대략 100~250 사이)에 있는 '검색'만 후보로 고른다.
                    search_candidates = page.get_by_text("검색", exact=True)
                    scount = search_candidates.count()
                    log(f"  '검색' 텍스트 후보 개수: {scount}")
                    search_target = None
                    for i in range(scount):
                        try:
                            box = search_candidates.nth(i).bounding_box(timeout=1000)
                            log(f"    후보[{i}] box={box}")
                            if box and 100 < box["y"] < 250:
                                search_target = i
                        except Exception as e:
                            log(f"    후보[{i}] 오류: {e}")

                    if search_target is not None:
                        search_candidates.nth(search_target).click(timeout=5000)
                        log(f"  '검색'(후보[{search_target}]) 클릭함")
                    else:
                        log("  적절한 '검색' 버튼을 못찾음, Enter로 대체")
                        el.press("Enter")

                    try:
                        page.wait_for_selector("text=처리중입니다", state="hidden", timeout=20000)
                        log("  '처리중입니다' 로딩 사라짐 확인")
                    except Exception as e:
                        log(f"  로딩 대기 중 타임아웃/오류(무시): {e}")
                    page.wait_for_timeout(3000)

                    cur_val2 = el.input_value(timeout=1000)
                    log(f"  입력창 현재 값(검색 후) 확인: {cur_val2!r}")

                    result_text = page.locator("body").inner_text()
                    with open(f"debug/impfood_v2_{RUN_ID}_result.txt", "w", encoding="utf-8") as f:
                        f.write(result_text[:15000])
                    log("  검색 결과 텍스트 저장함")
                    page.screenshot(path=f"debug/impfood_v2_{RUN_ID}_result.png", full_page=True)
                    log("  검색 결과 스크린샷 저장함")
            except Exception as e:
                log(f"  오류: {e}")

            browser.close()
            browser = None
    except Exception:
        log("=== 최상위 예외 발생 ===")
        log(traceback.format_exc())
    finally:
        try:
            if browser is not None:
                browser.close()
        except Exception:
            pass
        with open(f"debug/impfood_v2_explore_{RUN_ID}.log", "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
        print(f"[로그 저장 완료] debug/impfood_v2_explore_{RUN_ID}.log ({len(log_lines)}줄)")


if __name__ == "__main__":
    main()
