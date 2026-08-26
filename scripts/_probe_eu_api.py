# -*- coding: utf-8 -*-
"""
일회성 탐색 스크립트. EU agrifood API의 실제 엔드포인트/파라미터/응답 구조를
GitHub Actions 러너에서 직접 찔러보고 결과를 stdout에 찍는다.
작업 끝나면 워크플로우와 함께 삭제할 예정.
"""
import json
import sys
import requests

BASE = "https://api.tech.ec.europa.eu/agrifood"

OUT = []


def show(label, url, params=None):
    OUT.append(f"\n===== {label} =====")
    OUT.append(f"URL: {url} params: {params}")
    try:
        r = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=30)
        OUT.append(f"status: {r.status_code}")
        OUT.append(f"headers subset: {{k: v for k, v in r.headers.items() if k.lower() in ('content-type','www-authenticate')}}")
        text = r.text
        if len(text) > 3000:
            OUT.append("body (truncated to 3000 chars):")
            OUT.append(text[:3000])
        else:
            OUT.append(f"body: {text}")
    except Exception as e:
        OUT.append(f"EXCEPTION: {e!r}")


def main():
    # 1. sectors 메타데이터
    show("sectors", f"{BASE}/api/taxud/weeklyData/sectors")

    # 2. import categories 메타데이터
    show("importCategories", f"{BASE}/api/taxud/weeklyData/importCategories")

    # 3. import products 메타데이터 (sector=Pigs로 필터 시도)
    show("import products (sector=Pigs)", f"{BASE}/api/taxud/weeklyData/import/products", {"sectors": "Pigs"})
    show("import products (no filter, small)", f"{BASE}/api/taxud/weeklyData/import/products")

    # 4. 실제 import 데이터 소량 조회 (existing known-good endpoint from docs)
    show("import weekly data sample", f"{BASE}/api/taxud/weeklyData/import",
         {"sectors": "Pigs", "marketingYears": "2024", "weeks": "1"})

    # 5. export 관련 후보 엔드포인트들
    for path in [
        "api/taxud/weeklyData/export",
        "api/taxud/weeklyData/exports",
        "api/taxud/weeklyData/export/products",
        "api/taxud/weeklyData/exportCategories",
    ]:
        show(f"probe {path}", f"{BASE}/{path}", {"sectors": "Pigs", "marketingYears": "2024", "weeks": "1"})

    # 6. export with cn8/product code guess based on known product name "Frozen pig meat"
    show("export weekly data (sectors=Pigs, memberStateCodes=DK)",
         f"{BASE}/api/taxud/weeklyData/export",
         {"sectors": "Pigs", "marketingYears": "2024", "weeks": "1", "memberStateCodes": "DK"})


if __name__ == "__main__":
    main()
    with open("debug/probe_output.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(OUT))
    print("wrote debug/probe_output.txt")
