# -*- coding: utf-8 -*-
"""
impfood.mfds.go.kr (수입식품정보마루) 정찰용 임시 스크립트.

목적: "냉장/냉동-부위-국가 검사실적" 화면에 도달하는 방법과, 검색 버튼을 눌렀을 때
실제로 호출되는 XHR 요청(URL/method/payload/응답)을 캡처해서, 이후 자동 스크래핑
스크립트를 설계하기 위한 정보를 얻는다. (WebSquare 프레임워크 기반이라 메뉴 클릭을
직접 시뮬레이션해야 함)
"""
import json
from playwright.sync_api import sync_playwright

BASE_URL = "https://impfood.mfds.go.kr/ifs/websquare/websquare.html?w2xPath=/ifs/ui/index.xml"

captured = []


def log_response(response):
    try:
        url = response.url
        if any(x in url.lower() for x in [".js", ".css", ".png", ".gif", ".jpg", ".woff", ".svg", ".ico"]):
            return
        req = response.request
        entry = {
            "url": url,
            "method": req.method,
            "status": response.status,
            "post_data": req.post_data,
        }
        captured.append(entry)
    except Exception as e:
        captured.append({"error": str(e)})


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("response", log_response)

        print("1) 메인 페이지 접속")
        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)

        print("2) 좌측 메뉴 '수입식품' 클릭해서 펼치기")
        try:
            page.get_by_text("수입식품", exact=True).first.click(timeout=5000)
        except Exception as e:
            print(f"'수입식품' 클릭 실패: {e}")
        page.wait_for_timeout(1500)

        texts2 = page.locator("body").inner_text()
        with open("debug/impfood_page_text2.txt", "w", encoding="utf-8") as f:
            f.write(texts2[:20000])

        print("3) '냉장/냉동-부위-국가' 텍스트 포함 요소 탐색 및 클릭")
        candidates = page.get_by_text("냉장/냉동-부위-국가", exact=False)
        count = candidates.count()
        print(f"'냉장/냉동-부위-국가' 텍스트 포함 요소 개수: {count}")
        clicked = False
        for i in range(count):
            try:
                el = candidates.nth(i)
                txt = el.inner_text(timeout=2000)
                print(f"  [{i}] {txt!r}")
                el.click(timeout=5000)
                clicked = True
                print(f"  -> [{i}] 클릭함")
                break
            except Exception as e:
                print(f"  [{i}] 오류: {e}")
        page.wait_for_timeout(3000)

        if clicked:
            print("3) 품명 입력 시도")
            try:
                inputs = page.locator("input[type='text']")
                icount = inputs.count()
                print(f"input[type=text] 개수: {icount}")
                for i in range(icount):
                    try:
                        box = inputs.nth(i).bounding_box()
                        val = inputs.nth(i).input_value(timeout=1000)
                        print(f"  input[{i}] box={box} value={val!r}")
                    except Exception as e:
                        print(f"  input[{i}] 오류: {e}")

                # '품명' 라벨 근처 입력창을 찾기: 라벨 다음에 오는 input으로 추정 시도
                label = page.get_by_text("품명", exact=True).first
                label_box = label.bounding_box(timeout=3000)
                print(f"'품명' 라벨 위치: {label_box}")
                target_input = None
                best_dist = None
                for i in range(icount):
                    try:
                        box = inputs.nth(i).bounding_box(timeout=1000)
                        if not box or not label_box:
                            continue
                        # 같은 높이(y) 근처에 있고, 라벨보다 오른쪽에 있는 input
                        if abs(box["y"] - label_box["y"]) < 15 and box["x"] > label_box["x"]:
                            dist = box["x"] - label_box["x"]
                            if best_dist is None or dist < best_dist:
                                best_dist = dist
                                target_input = i
                    except Exception:
                        continue
                print(f"'품명' 입력창으로 추정되는 index: {target_input}")

                if target_input is not None:
                    inputs.nth(target_input).click()
                    inputs.nth(target_input).fill("양고기")
                    print("'양고기' 입력 완료")
                    page.wait_for_timeout(500)

                    # '검색' 버튼 클릭
                    search_btn = page.get_by_text("검색", exact=True).first
                    search_btn.click(timeout=5000)
                    print("'검색' 버튼 클릭함")
                    page.wait_for_timeout(4000)

                    result_text = page.locator("body").inner_text()
                    with open("debug/impfood_result_text.txt", "w", encoding="utf-8") as f:
                        f.write(result_text[:20000])
                else:
                    print("품명 입력창을 못 찾음")
            except Exception as e:
                print(f"입력/검색 시도 오류: {e}")

        page.wait_for_timeout(2000)
        page.screenshot(path="debug/impfood_screenshot.png", full_page=True)

        with open("debug/impfood_network_log.json", "w", encoding="utf-8") as f:
            json.dump(captured, f, ensure_ascii=False, indent=2)

        print(f"캡처된 네트워크 요청 수: {len(captured)}")
        browser.close()


if __name__ == "__main__":
    main()
