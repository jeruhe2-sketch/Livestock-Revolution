# -*- coding: utf-8 -*-
"""
호주 축산물(소고기 Beef & Veal) 수출현황 - DAFF 공식 원본 파일 임포터 (v3).

v1(사용자 피벗), v2(사용자가 취합한 로우데이터)를 거쳐, 이번엔 DAFF가 매달
발행하는 원본 "Monthly - 57 Destination Report" 엑셀 파일 그 자체를 여러 개
(여러 연도치) 한꺼번에 받아서 직접 파싱한다. 파일명(예: "2607_m57dest.xlsx")은
신뢰하지 않고, 매 파일 1행("Monthly - 57 Destination Report - July 2026 - ...")
의 월/연도 문구를 직접 읽어서 사용한다 (파일명이 틀리게 붙은 경우가 실제로
있었음: 2109/2110/2111월 파일이 각각 3009/3110/qid96840_2111로 잘못 붙어있었음).

원본 파일 구조 (2019~2026 전체 기간 동일하게 확인됨):
  - 시트 1개, 1행: 제목("... - <Month> <Year> - Tonnes Shipped Weight")
  - 2행: 컬럼 헤더 49개 (Destinations, Chilled Beef & Veal Total, Frozen Total,
    Beef & Veal Total, ..., Total Goat, ..., Total Meats)
  - 3행: 공백
  - 4행부터: 목적지별 데이터 (57개 개별 목적지 + Total EU/Total Asia/
    Total Middle East/Total Aus 같은 소계 행 포함, 소계는 걸러냄)
  - 단위: 톤(Tonnes Shipped Weight) - 기존 데이터와 대조 검증 완료

agriculture.gov.au는 GitHub Actions IP가 차단되어 있고, UN Comtrade는 접속은
되지만 DAFF보다 1개월 더 느려서 자동화를 포기하고, 사용자가 원본 파일을
직접 받아서 업로드하는 방식으로 운영한다.

사용법:
  python scripts/import_aus_trade_manual.py <파일 또는 폴더> [<파일 또는 폴더> ...]
  python scripts/import_aus_trade_manual.py /mnt/user-data/uploads --merge

  인자로 디렉토리를 주면 그 안의 *m57dest*.xlsx 전부를 찾아서 처리한다.
  --merge 없이 실행하면 파싱 결과만 보여주고 data 파일은 안 건드림.

출력: data/aus_meat_export.json
"""
import argparse
import glob
import json
import os
import re
import sys

import pandas as pd

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aus_meat_export.json")

DEST_MATCH = {
    "CN": "china", "HK": "hong kong", "ID": "indonesia", "JP": "japan",
    "PH": "philippines", "KR": "south korea", "TW": "taiwan", "TH": "thailand",
    "US_EAST": "usa east", "US_WEST": "usa west",
}
DEST_LABEL = {
    "CN": "China", "HK": "Hong Kong", "ID": "Indonesia", "JP": "Japan",
    "PH": "Philippines", "KR": "South Korea", "TW": "Taiwan", "TH": "Thailand",
    "US_EAST": "USA East", "US_WEST": "USA West",
}
CODE_BY_LOWER_NAME = {v: k for k, v in DEST_MATCH.items()}

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
TITLE_RE = re.compile(
    r"(" + "|".join(MONTH_NAMES.keys()) + r")\s*(\d{4})", re.IGNORECASE
)

# 원본 파일의 실제 컬럼 헤더 이름 (2019~2026 전체 기간 동일 확인됨)
COL_CHILLED = "Chilled Beef & Veal Total"
COL_FROZEN = "Frozen Total"
COL_TOTAL = "Beef & Veal Total"
COL_GOAT = "Total Goat"
COL_DEST = "Destinations"


def find_input_files(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            files.extend(sorted(glob.glob(os.path.join(p, "*m57dest*.xlsx"))))
            files.extend(sorted(glob.glob(os.path.join(p, "*m57dest*.xls"))))
        else:
            files.append(p)
    # 중복 제거, 순서 유지
    seen = set()
    uniq = []
    for f in files:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    return uniq


def parse_title_date(title: str):
    m = TITLE_RE.search(title or "")
    if not m:
        return None
    month = MONTH_NAMES[m.group(1).lower()]
    year = int(m.group(2))
    return year, month


def to_num(val):
    if pd.isna(val):
        return 0.0
    s = str(val).strip()
    if s in ("-", ""):
        return 0.0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def parse_file(path: str):
    raw = pd.read_excel(path, sheet_name=0, header=None)
    title = str(raw.iloc[0, 0])
    ym = parse_title_date(title)
    if ym is None:
        raise RuntimeError(f"제목 행에서 연월을 못 찾음: {title!r}")
    year, month = ym

    header = [str(v).strip() for v in raw.iloc[1].tolist()]
    try:
        col_dest = header.index(COL_DEST)
        col_chilled = header.index(COL_CHILLED)
        col_frozen = header.index(COL_FROZEN)
        col_total = header.index(COL_TOTAL)
        col_goat = header.index(COL_GOAT)
    except ValueError as e:
        raise RuntimeError(f"예상한 컬럼을 못 찾음 ({e}). 헤더: {header}")

    records = []
    for r in range(2, len(raw)):
        dest_name = str(raw.iloc[r, col_dest]).strip().lower()
        code = CODE_BY_LOWER_NAME.get(dest_name)
        if code is None:
            continue
        chilled = to_num(raw.iloc[r, col_chilled]) or 0.0
        frozen = to_num(raw.iloc[r, col_frozen]) or 0.0
        total = to_num(raw.iloc[r, col_total])
        goat = to_num(raw.iloc[r, col_goat]) or 0.0
        if total is None:
            continue
        records.append([year, month, code, chilled, frozen, total, goat])
    return year, month, records


def merge_into_json(records, do_merge: bool):
    existing = {"data": []}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    by_key = {}
    for r in existing.get("data", []):
        if len(r) == 4:  # 옛 v1 스키마(합계만) 호환
            year, month, dest, total = r
            by_key[(year, month, dest)] = [year, month, dest, 0.0, 0.0, total, 0.0]
        else:
            by_key[(r[0], r[1], r[2])] = r

    added = changed = 0
    for r in records:
        key = (r[0], r[1], r[2])
        if key in by_key and by_key[key] != r:
            changed += 1
        elif key not in by_key:
            added += 1
        by_key[key] = r

    import datetime
    out = {
        "product": "Beef & Veal (10개 주요 목적지)",
        "sector": "Red meat",
        "sourceNote": "호주 DAFF 'Australian red meat export statistics' 57 Destination Report 원본 월별 파일을 사용자가 직접 다운로드해 업로드",
        "unit": "ton",
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "granularity": "monthly",
        "destNames": DEST_LABEL,
        "cols": ["year", "month", "dest", "chilledTon", "frozenTon", "totalBeefVealTon", "goatTon"],
        "data": sorted(by_key.values(), key=lambda r: (r[0], r[1], r[2])),
    }

    print(f"병합: 신규 {added}건, 갱신 {changed}건, 최종 총 {len(out['data'])}건")
    if do_merge:
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print(f"저장 완료: {OUT_PATH}")
    else:
        print("(--merge 없이 실행되어 실제 파일은 갱신하지 않음)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+", help="원본 xlsx 파일 경로 또는 폴더 경로 (여러 개 가능)")
    ap.add_argument("--merge", action="store_true", help="실제로 data/aus_meat_export.json에 반영")
    args = ap.parse_args()

    files = find_input_files(args.paths)
    if not files:
        print("처리할 파일을 찾지 못했습니다.", file=sys.stderr)
        sys.exit(1)
    print(f"대상 파일 {len(files)}개")

    all_records = []
    seen_months = set()
    errors = []
    for f in files:
        try:
            year, month, records = parse_file(f)
            key = (year, month)
            if key in seen_months:
                print(f"  경고: {year}.{month:02d} 이 이미 다른 파일에서도 나왔음 (중복 업로드?) - {os.path.basename(f)}", file=sys.stderr)
            seen_months.add(key)
            all_records.extend(records)
            print(f"  {os.path.basename(f):30s} -> {year}.{month:02d}, {len(records)}건")
        except Exception as e:
            errors.append((f, str(e)))
            print(f"  실패: {os.path.basename(f)} - {e}", file=sys.stderr)

    if errors:
        print(f"\n총 {len(errors)}개 파일 파싱 실패", file=sys.stderr)

    months_sorted = sorted(seen_months)
    if months_sorted:
        print(f"\n기간: {months_sorted[0][0]}.{months_sorted[0][1]:02d} ~ {months_sorted[-1][0]}.{months_sorted[-1][1]:02d} ({len(months_sorted)}개월)")
        # 연속성 체크(빠진 달 있는지)
        expected = []
        y, m = months_sorted[0]
        while (y, m) <= months_sorted[-1]:
            expected.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1
        missing = [f"{y}.{m:02d}" for (y, m) in expected if (y, m) not in seen_months]
        if missing:
            print(f"⚠️  빠진 달: {missing}")
        else:
            print("✅ 빠진 달 없음 (연속)")

    if not all_records:
        print("파싱된 레코드가 없습니다.", file=sys.stderr)
        sys.exit(1)

    merge_into_json(all_records, args.merge)


if __name__ == "__main__":
    main()
