# -*- coding: utf-8 -*-
"""
호주 축산물 수출현황 - DAFF 공식 원본 파일 임포터 (v4).

v3까지는 "소고기"로 품목을 고정하고 냉장/냉동/산양육을 뒤섞은 버튼으로
처리했으나, 이번엔 EU/USDA 탭과 동일하게:
  - 축종(소고기/양고기/램/산양육/돼지고기)을 완전히 분리된 선택지로,
  - 형태(냉장/냉동/합계)도 분리된 선택지로,
  - 목적지는 다중선택 필터로
둘 수 있도록 데이터를 정규화된 롱포맷으로 저장한다.
행 1개 = (연, 월, 목적지, 축종) 조합 하나, 그 안에 냉장/냉동/합계 3개 값.

목적지는 원래 10개국에서, 91개월 전체 데이터 기준 "Total Meats"(전체
축종 합계) 물량 순위로 상위 16개국(전체 물량의 91.9% 커버)까지 확장함:
  기존 10개국: China, Hong Kong, Indonesia, Japan, Philippines,
    South Korea, Taiwan, Thailand, USA East, USA West
  추가 6개국: Malaysia, Saudi Arabia, Singapore, Dubai, Canada East,
    Papua New Guinea

원본 파일 구조는 v3와 동일 (1행 제목에서 연월 파싱, 2행 헤더, 4행부터
데이터, 단위 톤).

사용법:
  python scripts/import_aus_trade_manual.py <파일 또는 폴더> [...]
  python scripts/import_aus_trade_manual.py /mnt/user-data/uploads --merge

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

# 목적지 16개 (91.9% 커버). 표시명(소문자) -> 내부 코드.
DEST_MATCH = {
    "CN": "china", "US_EAST": "usa east", "JP": "japan", "KR": "south korea",
    "ID": "indonesia", "US_WEST": "usa west", "MY": "malaysia", "SA": "saudi arabia",
    "TW": "taiwan", "PH": "philippines", "SG": "singapore", "DXB": "dubai",
    "CA_EAST": "canada east", "PG": "papua new guinea", "HK": "hong kong", "TH": "thailand",
}
DEST_LABEL = {
    "CN": "China", "US_EAST": "USA East", "JP": "Japan", "KR": "South Korea",
    "ID": "Indonesia", "US_WEST": "USA West", "MY": "Malaysia", "SA": "Saudi Arabia",
    "TW": "Taiwan", "PH": "Philippines", "SG": "Singapore", "DXB": "Dubai",
    "CA_EAST": "Canada East", "PG": "Papua New Guinea", "HK": "Hong Kong", "TH": "Thailand",
}
CODE_BY_LOWER_NAME = {v: k for k, v in DEST_MATCH.items()}

SPECIES_LABEL = {"beef": "Beef & Veal", "mutton": "Mutton", "lamb": "Lamb", "goat": "Goat", "pork": "Pork"}
# 축종별 (냉장 컬럼, 냉동 컬럼, 합계 컬럼). 돼지고기는 냉장/냉동 구분이 없고
# CS/B-In/B-Out(선적형태) 구분만 있어서 합계만 사용(냉장/냉동은 0으로 채움).
SPECIES_COLS = {
    "beef": ("Chilled Beef & Veal Total", "Frozen Total", "Beef & Veal Total"),
    "mutton": ("Chilled Mutton Total", "Frozen Mutton Total", "Total  Mutton"),
    "lamb": ("Chilled Lamb Total", "Frozen Lamb Total", "Total Lamb"),
    "goat": ("Chilled Goat Total", "Frozen Goat Total", "Total Goat"),
    "pork": (None, None, "Pork Total"),
}

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
TITLE_RE = re.compile(r"(" + "|".join(MONTH_NAMES.keys()) + r")\s*(\d{4})", re.IGNORECASE)
COL_DEST = "Destinations"


def find_input_files(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            files.extend(sorted(glob.glob(os.path.join(p, "*m57dest*.xlsx"))))
            files.extend(sorted(glob.glob(os.path.join(p, "*m57dest*.xls"))))
        else:
            files.append(p)
    seen, uniq = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    return uniq


def parse_title_date(title: str):
    m = TITLE_RE.search(title or "")
    if not m:
        return None
    return int(m.group(2)), MONTH_NAMES[m.group(1).lower()]


def to_num(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0.0
    s = str(val).strip()
    if s in ("-", "", "nan"):
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
    col_dest = header.index(COL_DEST)
    species_cols = {}
    for sp, (c_chilled, c_frozen, c_total) in SPECIES_COLS.items():
        idx_chilled = header.index(c_chilled) if c_chilled else None
        idx_frozen = header.index(c_frozen) if c_frozen else None
        idx_total = header.index(c_total)
        species_cols[sp] = (idx_chilled, idx_frozen, idx_total)

    records = []
    for r in range(2, len(raw)):
        dest_name = str(raw.iloc[r, col_dest]).strip().lower()
        code = CODE_BY_LOWER_NAME.get(dest_name)
        if code is None:
            continue
        for sp, (ic, ifz, it) in species_cols.items():
            chilled = to_num(raw.iloc[r, ic]) if ic is not None else 0.0
            frozen = to_num(raw.iloc[r, ifz]) if ifz is not None else 0.0
            total = to_num(raw.iloc[r, it])
            if total is None:
                continue
            if (chilled or 0) == 0 and (frozen or 0) == 0 and total == 0:
                continue  # 전부 0인 행은 굳이 안 쌓음 (용량 절약)
            records.append([year, month, code, sp, chilled or 0.0, frozen or 0.0, total])
    return year, month, records


def merge_into_json(records, do_merge: bool):
    existing = {"data": []}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
    # v1~v3 스키마(5~7개 필드, species 없음)는 형식이 완전히 달라서 호환 불가 ->
    # 새 스키마(연,월,목적지,축종,냉장,냉동,합계)로 전면 교체.
    by_key = {}
    if existing.get("cols") == ["year", "month", "dest", "species", "chilledTon", "frozenTon", "totalTon"]:
        for r in existing.get("data", []):
            by_key[(r[0], r[1], r[2], r[3])] = r

    added = changed = 0
    for r in records:
        key = (r[0], r[1], r[2], r[3])
        if key in by_key and by_key[key] != r:
            changed += 1
        elif key not in by_key:
            added += 1
        by_key[key] = r

    import datetime
    out = {
        "product": "축산물(소고기·양고기·램·산양육·돼지고기), 16개 주요 목적지",
        "sector": "Red meat & pork",
        "sourceNote": "호주 DAFF 'Australian red meat export statistics' 57 Destination Report 원본 월별 파일을 사용자가 직접 다운로드해 업로드",
        "unit": "ton",
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "granularity": "monthly",
        "destNames": DEST_LABEL,
        "speciesNames": SPECIES_LABEL,
        "cols": ["year", "month", "dest", "species", "chilledTon", "frozenTon", "totalTon"],
        "data": sorted(by_key.values(), key=lambda r: (r[0], r[1], r[2], r[3])),
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
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--merge", action="store_true")
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
            seen_months.add((year, month))
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
        expected = []
        y, m = months_sorted[0]
        while (y, m) <= months_sorted[-1]:
            expected.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1
        missing = [f"{y}.{m:02d}" for (y, m) in expected if (y, m) not in seen_months]
        print("⚠️  빠진 달:" if missing else "✅ 빠진 달 없음", missing or "")

    if not all_records:
        print("파싱된 레코드가 없습니다.", file=sys.stderr)
        sys.exit(1)
    merge_into_json(all_records, args.merge)


if __name__ == "__main__":
    main()
