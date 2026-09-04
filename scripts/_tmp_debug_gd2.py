import os
import sys
from playwright.sync_api import sync_playwright

BASE_URL = "http://211.239.173.90/kd2dst"
LOGIN_ID = os.environ.get("NWILL_GANGDONG2_ID")
LOGIN_PW = os.environ.get("NWILL_GANGDONG2_PW")

print(f"ID 설정됨: {bool(LOGIN_ID)}, PW 설정됨: {bool(LOGIN_PW)}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    )
    try:
        print(f"1) 접속 시도: {BASE_URL}/")
        resp = page.goto(BASE_URL + "/", wait_until="networkidle", timeout=60000)
        print(f"   응답 상태: {resp.status if resp else 'None'}")
        print(f"   최종 URL: {page.url}")
        page.screenshot(path="debug/gd2_step1_loaded.png")
        with open("debug/gd2_step1.html", "w", encoding="utf-8") as f:
            f.write(page.content())

        has_id_field = page.locator("input[name='id']").count() > 0
        has_pw_field = page.locator("input[name='pw']").count() > 0
        print(f"   id 필드 존재: {has_id_field}, pw 필드 존재: {has_pw_field}")

        if has_id_field and has_pw_field:
            page.fill("input[name='id']", LOGIN_ID)
            page.fill("input[name='pw']", LOGIN_PW)
            print("2) 로그인 폼 제출 시도")
            try:
                with page.expect_navigation(wait_until="networkidle", timeout=60000):
                    page.click("button[type='submit']")
            except Exception as e:
                print(f"   네비게이션 대기 중 예외(제출 버튼 못 찾았을 수도): {e}")
            print(f"   로그인 후 URL: {page.url}")
            page.screenshot(path="debug/gd2_step2_after_login.png")
            with open("debug/gd2_step2.html", "w", encoding="utf-8") as f:
                f.write(page.content())
            success = "logout.do" in page.content()
            print(f"   로그인 성공 여부(logout.do 존재): {success}")
        else:
            print("   로그인 폼 필드를 못 찾음 - 페이지 구조가 다른 것 같음")
    except Exception as e:
        print(f"오류 발생: {type(e).__name__}: {e}", file=sys.stderr)
        try:
            page.screenshot(path="debug/gd2_error.png")
            with open("debug/gd2_error.html", "w", encoding="utf-8") as f:
                f.write(page.content())
        except Exception:
            pass
    finally:
        browser.close()
