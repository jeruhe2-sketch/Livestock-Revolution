# -*- coding: utf-8 -*-
"""
mafra 소고기(쇠고기) 데이터를 기존 master_flat.json의 소고기 데이터와 교차검증.
"""
import json
import os
from playwright.sync_api import sync_playwright
import pandas as pd

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
URL = "https://data.mafra.go.kr/opendata/data/indexOpenDataDetail.do?data_id=20181019000000000968"

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def download(year):
    os.makedirs("debug/verify_downloads", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)
        link = page.get_by_text(str(year), exact=False).filter(has_text="검역실적").first
        with page.expect_download(timeout=30000) as dl:
            link.click(timeout=10000)
        path = f"debug/verify_downloads/{year}.xlsx"
        dl.value.save_as(path)
        browser.close()
        return path


def parse_beef(path, year):
    xl = pd.ExcelFile(path)
    sheet_name = next((s for s in xl.sheet_names if "수입" in s and "축산" in s), None)
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)

    label_row_idx = col_group_idx = col_item_idx = col_country_idx = None
    for r_idx in range(min(8, len(df))):
        row_vals = [str(v).strip() for v in df.iloc[r_idx].tolist()]
        if "품목명" in row_vals and "품명" in row_vals and "국가명" in row_vals:
            label_row_idx = r_idx
            col_group_idx = row_vals.index("품목명")
            col_item_idx = row_vals.index("품명")
            col_country_idx = row_vals.index("국가명")
            break

    col_item = df[col_item_idx].ffill()
    col_country = df[col_country_idx]
    mask = col_item.astype(str) == "쇠고기"
    sub = df[mask].copy()
    sub["국가"] = col_country[mask]

    header_row = df.iloc[label_row_idx]
    month_cols = {}
    for col_idx in range(col_country_idx + 1, df.shape[1]):
        val = header_row[col_idx]
        if pd.isna(val):
            continue
        s = str(val)
        if "." in s:
            try:
                m = int(s.split(".")[1])
                if 1 <= m <= 12:
                    month_cols[m] = col_idx + 1
            except Exception:
                pass

    monthly_total = {m: 0.0 for m in range(1, 13)}
    for _, row in sub.iterrows():
        국가 = row["국가"]
        if pd.isna(국가) or "계" in str(국가):
            continue
        for m, qty_col in month_cols.items():
            val = row.get(qty_col)
            if pd.isna(val) or val == "-":
                continue
            try:
                monthly_total[m] += float(val)
            except (TypeError, ValueError):
                continue
    return monthly_total


def existing_beef_totals(year):
    with open("data/master_flat.json", encoding="utf-8") as f:
        payload = json.load(f)
    meta = payload["meta"]
    year_base = meta["yearBase"]
    flat = payload["flat"]
    totals = {m: 0.0 for m in range(1, 13)}
    for idx in range(0, len(flat), 7):
        y = flat[idx] + year_base
        m = flat[idx + 1]
        p = meta["품명"][flat[idx + 2]]
        ton10 = flat[idx + 6]
        if y == year and p == "소고기":
            totals[m] += ton10 / 10 * 1000  # kg
    return totals


def main():
    for year in [2019, 2023, 2025]:
        try:
            path = download(year)
            mafra_totals = parse_beef(path, year)
            existing_totals = existing_beef_totals(year)
            log(f"=== {year}년 소고기(쇠고기) 월별 비교 (kg) ===")
            for m in range(1, 13):
                mv = mafra_totals[m]
                ev = existing_totals[m]
                diff_pct = (mv - ev) / ev * 100 if ev else None
                log(f"  {m:2d}월: mafra={mv:,.1f}  기존={ev:,.1f}  차이={diff_pct}%" if diff_pct is not None else f"  {m:2d}월: mafra={mv:,.1f}  기존={ev:,.1f}")
        except Exception as e:
            log(f"{year} 검증 실패: {e}")

    with open(f"debug/verify_beef_{RUN_ID}.log", "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


if __name__ == "__main__":
    main()
