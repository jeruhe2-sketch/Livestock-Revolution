# -*- coding: utf-8 -*-
"""
data.mafra.go.kr의 "동축산물 검역실적" 연도별 파일을 자동으로 받아서
면양육(양고기)/산양육(염소고기)의 월별 수입 데이터를 master_flat.json에 병합한다.

이 파일들은 impfood.mfds.go.kr(월별 1개씩만 검색 가능, ~1분 소요, 반복접속시
차단 위험)와 달리, 연도당 파일 하나로 1~12월치가 통째로 들어있어서
한 번에 여러 해를 처리할 수 있다.

사용법: python scripts/fetch_mafra_livestock_history.py
"""
import json
import os
import sys
import traceback
from playwright.sync_api import sync_playwright
import pandas as pd

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")
URL = "https://data.mafra.go.kr/opendata/data/indexOpenDataDetail.do?data_id=20181019000000000968"
DOWNLOAD_DIR = "debug/mafra_downloads"
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "master_flat.json")

# mafra 파일의 품명 -> 기존 master_flat.json 품명 매핑
ITEM_MAP = {
    "면양육": "양고기",
    "산양육": "염소고기",
}

# 받고 싶은 연도들과, 페이지에 표시되는 링크 텍스트에 포함될 힌트
YEARS = {
    2019: "2019",
    2020: "2020",
    2021: "2021",
    2022: "2022",
    2023: "2023",
    2024: "2024",
    2025: "2025",
}

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(str(msg))


def download_all_years():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    saved = {}
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            log("페이지 접속")
            page.goto(URL, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)

            for year, hint in YEARS.items():
                try:
                    link = page.get_by_text(hint, exact=False).filter(has_text="검역실적").first
                    cnt = page.get_by_text(hint, exact=False).filter(has_text="검역실적").count()
                    if cnt == 0:
                        log(f"{year}: 링크 못찾음 (파일이 없을 수 있음)")
                        continue
                    with page.expect_download(timeout=30000) as dl_info:
                        link.click(timeout=10000)
                    download = dl_info.value
                    save_path = os.path.join(DOWNLOAD_DIR, f"{year}.xlsx")
                    download.save_as(save_path)
                    saved[year] = save_path
                    log(f"{year}: 다운로드 성공 ({os.path.getsize(save_path)} bytes)")
                except Exception as e:
                    log(f"{year}: 다운로드 실패: {e}")
            browser.close()
            browser = None
    except Exception:
        log("=== 다운로드 중 최상위 예외 ===")
        log(traceback.format_exc())
    finally:
        try:
            if browser is not None:
                browser.close()
        except Exception:
            pass
    return saved


def parse_year_file(path, year):
    """수입축산물 시트에서 면양육/산양육 행만 뽑아서 (년,월,품명,국가,kg) 리스트로 반환."""
    xl = pd.ExcelFile(path)
    log(f"  {year} 시트 목록: {xl.sheet_names}")
    sheet_name = None
    for cand in ["수입축산물", "수입 축산물", "수입축산물현황", "수입축산물실적"]:
        if cand in xl.sheet_names:
            sheet_name = cand
            break
    if sheet_name is None:
        # 이름이 다르면, "수입"과 "축산"이 둘 다 들어간 시트를 찾는다
        for s in xl.sheet_names:
            if "수입" in s and "축산" in s:
                sheet_name = s
                break
    if sheet_name is None:
        log(f"  {year}: 수입축산물류 시트를 못찾음")
        return []
    log(f"  {year}: 시트 '{sheet_name}' 사용")

    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    col_item_group = df[0].ffill()
    col_item = df[1].ffill()
    col_country = df[2]

    all_items = sorted(set(col_item.dropna().astype(str)))
    matched_items = [x for x in all_items if "면양" in x or "산양" in x]
    log(f"  {year}: 면양/산양 포함된 품명 후보: {matched_items}")

    mask = col_item.isin(ITEM_MAP.keys())
    sub = df[mask].copy()
    sub["품명"] = col_item[mask]
    sub["국가"] = col_country[mask]

    # 헤더 행 위치가 연도마다 다를 수 있어서 "기준년월"이 포함된 행을 직접 찾는다
    header_row_idx = None
    for r_idx in range(min(6, len(df))):
        row_vals = df.iloc[r_idx].astype(str).tolist()
        if any("기준년월" in v for v in row_vals):
            header_row_idx = r_idx
            break
    if header_row_idx is None:
        header_row_idx = 2
        log(f"  {year}: '기준년월' 행을 못찾아서 기본값(2번 행) 사용")
    else:
        log(f"  {year}: 헤더 행 = {header_row_idx}")

    header_row = df.iloc[header_row_idx]
    month_cols = {}  # month_idx(1~12) -> (수량 컬럼 index)
    for col_idx in range(4, df.shape[1]):
        val = header_row[col_idx]
        if pd.isna(val):
            continue
        try:
            s = str(val)
            if "." in s:
                y_part, m_part = s.split(".")
                m = int(m_part)
                if 1 <= m <= 12:
                    # 그 다음 컬럼이 수량(Kg,Ea) 컬럼
                    month_cols[m] = col_idx + 1
        except Exception:
            continue
    log(f"  {year}: month_cols 개수 = {len(month_cols)}")

    records = []
    for _, row in sub.iterrows():
        국가 = row["국가"]
        품명 = ITEM_MAP[row["품명"]]
        if pd.isna(국가) or "계" in str(국가):
            continue
        for m, qty_col in month_cols.items():
            val = row.get(qty_col)
            if pd.isna(val) or val == "-":
                continue
            try:
                kg = float(val)
            except (TypeError, ValueError):
                continue
            if kg == 0:
                continue
            records.append((year, m, 품명, str(국가).strip(), kg))
    return records


def merge_into_master(all_records):
    with open(DATA_PATH, encoding="utf-8") as f:
        payload = json.load(f)
    meta = payload["meta"]
    year_base = meta["yearBase"]
    flat = payload["flat"]

    records = {}
    for idx in range(0, len(flat), 7):
        y = flat[idx] + year_base
        m = flat[idx + 1]
        p = meta["품명"][flat[idx + 2]]
        i = meta["구분"][flat[idx + 3]]
        r = meta["부위"][flat[idx + 4]]
        n = meta["국가"][flat[idx + 5]]
        ton = flat[idx + 6] / 10
        records[(y, m, p, i, r, n)] = ton

    added = 0
    updated = 0
    for (y, m, p, n, kg) in all_records:
        key = (y, m, p, "합계", "전체육", n)
        ton = kg / 1000
        if key in records:
            updated += 1
        else:
            added += 1
        records[key] = ton

    품명s = sorted(set(k[2] for k in records))
    구분s = sorted(set(k[3] for k in records))
    부위s = sorted(set(k[4] for k in records))
    국가s = sorted(set(k[5] for k in records))
    p_idx = {v: i for i, v in enumerate(품명s)}
    i_idx = {v: i for i, v in enumerate(구분s)}
    r_idx = {v: i for i, v in enumerate(부위s)}
    n_idx = {v: i for i, v in enumerate(국가s)}

    min_year = min(k[0] for k in records)
    new_flat = []
    for (y, m, p, i, r, n), ton in records.items():
        new_flat.extend([y - min_year, m, p_idx[p], i_idx[i], r_idx[r], n_idx[n], round(ton * 10)])

    new_payload = {
        "meta": {"품명": 품명s, "구분": 구분s, "부위": 부위s, "국가": 국가s, "yearBase": min_year},
        "flat": new_flat,
        "updatedAt": payload.get("updatedAt"),
    }
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(new_payload, f, ensure_ascii=False, separators=(",", ":"))

    log(f"병합 완료: 신규 {added}건, 갱신 {updated}건, 최종 레코드 {len(records)}건")


def main():
    saved = download_all_years()
    all_records = []
    for year, path in saved.items():
        try:
            recs = parse_year_file(path, year)
            log(f"{year}: 면양육/산양육 레코드 {len(recs)}건 파싱")
            all_records.extend(recs)
        except Exception as e:
            log(f"{year}: 파싱 실패: {e}")
            log(traceback.format_exc())

    # 검증 단계: 실제 병합 전에 파싱 결과만 먼저 저장해서 확인한다.
    with open(f"debug/mafra_parsed_{RUN_ID}.json", "w", encoding="utf-8") as f:
        json.dump(all_records, f, ensure_ascii=False, indent=2)
    log(f"파싱 결과 저장함: debug/mafra_parsed_{RUN_ID}.json (총 {len(all_records)}건)")

    if "--merge" in sys.argv:
        if all_records:
            merge_into_master(all_records)
        else:
            log("병합할 레코드가 없음 (다운로드/파싱 전부 실패했을 가능성)")
    else:
        log("--merge 옵션 없어서 실제 병합은 건너뜀 (검증 모드)")

    with open(f"debug/mafra_merge_{RUN_ID}.log", "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


if __name__ == "__main__":
    main()
