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

        print("2) 좌측 메뉴에서 '통계정보' 관련 텍스트 탐색")
        # 좌측 메뉴 트리의 텍스트를 모두 덤프해서 실제 구조 파악
        texts = page.locator("body").inner_text()
        with open("debug/impfood_page_text.txt", "w", encoding="utf-8") as f:
            f.write(texts[:20000])

        # '냉장' 또는 '검사실적' 텍스트가 포함된 클릭 가능 요소 찾기
        candidates = page.get_by_text("냉장", exact=False)
        count = candidates.count()
        print(f"'냉장' 텍스트 포함 요소 개수: {count}")

        clicked = False
        for i in range(min(count, 10)):
            try:
                el = candidates.nth(i)
                txt = el.inner_text(timeout=2000)
                print(f"  [{i}] {txt!r}")
                if "검사실적" in txt or "부위" in txt:
                    el.click(timeout=5000)
                    clicked = True
                    print(f"  -> [{i}] 클릭 시도함")
                    break
            except Exception as e:
                print(f"  [{i}] 오류: {e}")

        page.wait_for_timeout(3000)

        if clicked:
            print("3) 품명 입력 시도")
            try:
                # placeholder나 근처 라벨로 입력창 찾기 시도
                inputs = page.locator("input[type='text']")
                icount = inputs.count()
                print(f"input[type=text] 개수: {icount}")
                for i in range(icount):
                    try:
                        box = inputs.nth(i).bounding_box()
                        print(f"  input[{i}] box={box}")
                    except Exception:
                        pass
            except Exception as e:
                print(f"입력창 탐색 오류: {e}")

        page.wait_for_timeout(2000)
        page.screenshot(path="debug/impfood_screenshot.png", full_page=True)

        with open("debug/impfood_network_log.json", "w", encoding="utf-8") as f:
            json.dump(captured, f, ensure_ascii=False, indent=2)

        print(f"캡처된 네트워크 요청 수: {len(captured)}")
        browser.close()


if __name__ == "__main__":
    main()
