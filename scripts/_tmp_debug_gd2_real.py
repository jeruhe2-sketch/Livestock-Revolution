import os
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from playwright.sync_api import sync_playwright
from fetch_all_warehouses_playwright import fetch_one_with_browser
from fetch_all_warehouses import apply_default_customs_status, WAREHOUSE_CONFIGS

cfg = next(c for c in WAREHOUSE_CONFIGS if c["base_url"].endswith("kd2dst"))
print("사용할 설정:", cfg)

with sync_playwright() as p:
    try:
        rows = fetch_one_with_browser(p, cfg)
        print(f"수집된 행 개수: {len(rows)}")
        apply_default_customs_status(rows, cfg)
        for r in rows:
            print(r.get("품목명"), r.get("재고수량"), r.get("통관상태"), r.get("창고명"))
    except Exception as e:
        print(f"예외 발생: {type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc()
