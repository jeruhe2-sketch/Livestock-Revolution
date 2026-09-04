import os
import sys
from playwright.sync_api import sync_playwright

CONFIGS = [
    {
        "name": "강동냉장(kd1)",
        "base_url": "http://211.239.173.90/kd1dst",
        "id": os.environ.get("NWILL_GANGDONG_ID"),
        "pw": os.environ.get("NWILL_GANGDONG_PW"),
    },
    {
        "name": "강동2냉장(kd2)",
        "base_url": "http://211.239.173.90/kd2dst",
        "id": os.environ.get("NWILL_GANGDONG2_ID"),
        "pw": os.environ.get("NWILL_GANGDONG2_PW"),
    },
]


def fetch_one(playwright, cfg):
    print(f"\n--- {cfg['name']} 시작 ---")
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page.goto(cfg["base_url"] + "/", wait_until="networkidle", timeout=90000)
        page.fill("input[name='id']", cfg["id"])
        page.fill("input[name='pw']", cfg["pw"])
        with page.expect_navigation(wait_until="networkidle", timeout=90000):
            page.click("button[type='submit']")
        success = "logout.do" in page.content()
        print(f"   로그인 성공: {success}, URL: {page.url}")
        if not success:
            return

        page.goto(f"{cfg['base_url']}/rtv_stock02.do?nav_num=0107", wait_until="networkidle", timeout=90000)
        page.select_option("select[name='pass_fg']", "*")
        date_input = page.locator("input[name='dt']")
        is_readonly = date_input.get_attribute("readonly") is not None
        if not is_readonly:
            import datetime
            today = datetime.datetime.now().strftime("%Y%m%d")
            date_input.fill("")
            date_input.fill(today)
        with page.expect_navigation(wait_until="networkidle", timeout=90000):
            page.click("button[type='submit']:has-text('조회')")

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
        page.wait_for_timeout(1500)
        row_count = page.locator(".dataTables-example tbody tr").count()
        print(f"   행 개수: {row_count}")
    except Exception as e:
        print(f"   [오류] {type(e).__name__}: {e}")
    finally:
        browser.close()


with sync_playwright() as p:
    for cfg in CONFIGS:
        fetch_one(p, cfg)
