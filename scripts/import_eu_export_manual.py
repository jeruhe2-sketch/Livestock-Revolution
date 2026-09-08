# -*- coding: utf-8 -*-
"""
EU Agri-food Data Portal "Weekly Taxud Export" 대시보드
(https://agridata.ec.europa.eu/extensions/DashboardTaxud/TaxudWeeklyExport.html)에서
사람이 직접 다운로드한 엑셀 파일을 data/eu_pigmeat_trade.json에 병합한다.

fetch_eu_taxud.py가 쓰는 API 엔드포인트(api.tech.ec.europa.eu/agrifood/api/taxud/...)가
장애(SUSPENDED)로 안 될 때 임시로 쓰는 수동 경로. 엑셀 컬럼 구조가 API 응답과
동일한 원본이라 필터/스키마를 그대로 맞췄다.

사용법:
  python scripts/import_eu_export_manual.py <엑셀파일...>

여러 주(week)가 섞인 파일도 되고, 여러 파일을 한 번에 넘겨도 됨(연도별로 따로
받은 경우 등). 기존 데이터와 (year,week,partner,ms) 키로 병합 - 겹치면 새 값으로 덮어씀.
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta

import pandas as pd

OUTPUT_PATH = "data/eu_pigmeat_trade.json"
SECTOR = "Pigs"
PRODUCT = "Frozen pig meat"
PARTNER_CODES = ["KR", "US", "GB", "CN", "JP", "PH", "VN", "MY", "CL", "TW"]
PARTNER_NAMES = {
    "KR": "Korea (Republic of)", "US": "United States of America", "GB": "United Kingdom",
    "CN": "China", "JP": "Japan", "PH": "Philippines", "VN": "Vietnam",
    "MY": "Malaysia", "CL": "Chile", "TW": "Taiwan",
}


def _iso_week1_monday(year: int) -> date:
    jan4 = date(year, 1, 4)
    return jan4 - timedelta(days=jan4.isoweekday() - 1)


def week_to_month(year: int, week: int) -> int:
    monday = _iso_week1_monday(year) + timedelta(weeks=week - 1)
    if week == 53:
        return 12
    counts = {}
    for i in range(7):
        d = monday + timedelta(days=i)
        counts[d.month] = counts.get(d.month, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def load_existing():
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {
        "product": PRODUCT, "sector": SECTOR, "granularity": "weekly",
        "msNames": {}, "partnerNames": PARTNER_NAMES,
        "cols": ["year", "week", "month", "partnerCode", "msCode", "kg", "euro"],
        "data": [],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    existing = load_existing()
    merged = {}
    for row in existing["data"]:
        yr, wk, month, partner_code, ms_code, kg, euro = row
        merged[(yr, wk, partner_code, ms_code)] = [yr, wk, month, partner_code, ms_code, kg, euro]
    ms_names = dict(existing.get("msNames", {}))

    added_weeks = set()
    for path in args.files:
        print(f"읽는 중: {path}")
        df = pd.read_excel(path, sheet_name=0, header=0)
        df.columns = [str(c).strip() for c in df.columns]
        df = df[(df["Sector"] == SECTOR) & (df["Product group"] == PRODUCT)]
        df = df[df["Partner Code"].isin(PARTNER_CODES)]
        print(f"  '{PRODUCT}' + 대상국 필터 후 {len(df)}행")

        # 같은 (year,week,partner,ms) 조합이 cn8/procedure 등으로 여러 줄일 수 있어 합산
        agg = df.groupby(["Marketing Year", "Week", "Partner Code", "Member State Code"], as_index=False).agg(
            {"kg": "sum", "Euro Value": "sum"}
        )
        name_map = df.drop_duplicates("Member State Code").set_index("Member State Code")["Member State"].to_dict()
        ms_names.update(name_map)

        for _, r in agg.iterrows():
            yr = int(r["Marketing Year"])
            wk = int(r["Week"])
            month = week_to_month(yr, wk)
            key = (yr, wk, r["Partner Code"], r["Member State Code"])
            merged[key] = [yr, wk, month, r["Partner Code"], r["Member State Code"], float(r["kg"]), float(r["Euro Value"])]
            added_weeks.add((yr, wk))

    final_rows = sorted(merged.values(), key=lambda r: (r[0], r[1], r[3], r[4]))

    now = datetime.now().astimezone()
    last_year, last_week = max((r[0], r[1]) for r in final_rows)
    last_sunday = _iso_week1_monday(last_year) + timedelta(weeks=last_week - 1, days=6)

    output = {
        "product": PRODUCT, "sector": SECTOR,
        "collectedAt": now.isoformat(),
        "sourceLastUpdate": now.date().isoformat(),
        "sourceMostRecentData": last_sunday.isoformat(),
        "sourceNote": "EU API(taxud/weeklyData/export) 장애로 Qlik 대시보드 수동 다운로드 파일 반영",
        "granularity": "weekly",
        "msNames": dict(sorted(ms_names.items(), key=lambda kv: kv[1])),
        "partnerNames": PARTNER_NAMES,
        "cols": ["year", "week", "month", "partnerCode", "msCode", "kg", "euro"],
        "data": final_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(final_rows)}행 (이번에 추가/갱신된 주차: {sorted(added_weeks)})")
    print(f"최신 데이터 기준: {last_sunday.isoformat()}")


if __name__ == "__main__":
    main()
