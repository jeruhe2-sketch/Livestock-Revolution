# -*- coding: utf-8 -*-
"""
호주 축산물(소고기 Beef & Veal) 수출현황 - 수동 업로드 파일 임포터 (v2, 로우데이터용).

v1은 사용자가 만든 피벗(국가별 열)을 파싱했으나, 국가별 냉장/냉동/산양육
분해가 없었음. v2는 DAFF "57 Destination Report"를 그대로 취합한 로우데이터
(Month, Destinations, Chilled Beef & Veal Total, Frozen Total,
Beef & Veal Total, Total Goat) 형식을 직접 파싱한다.

agriculture.gov.au는 GitHub Actions IP가 차단되어 있고, UN Comtrade는 접속은
되지만 DAFF보다 1개월 더 느려서 자동화를 포기하고, 사용자가 직접 취합해서
업로드하는 방식(CEPEA 내수현황과 동일 패턴)으로 운영한다.

기대하는 입력 파일 형식:
  - 헤더: Month, Destinations, Chilled Beef & Veal Total, Frozen Total,
    Beef & Veal Total, Total Goat  (열 순서는 바뀌어도 이름으로 찾음)
  - Month: "24.01월" 같은 "YY.MM월" 형식
  - Destinations: 57개 개별 목적지 + "Total Asia"/"Total EU"/"Total Aus"/
    "Total Middle East" 같은 소계 행 포함 (소계는 자동으로 걸러냄)
  - 값이 없으면 "-"로 표기됨 -> 0으로 처리
  - 단위: 톤(t) (기존 데이터와 대조 검증 완료)

사용법:
  python scripts/import_aus_trade_manual.py <업로드된_엑셀_경로>          # 검증만
  python scripts/import_aus_trade_manual.py <업로드된_엑셀_경로> --merge  # 실제 반영

출력: data/aus_meat_export.json
"""
import argparse
import json
import os
import re
import sys

import pandas as pd

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aus_meat_export.json")

# 목적지 표시명(소문자 비교) -> 우리 내부 코드. 10개국만 우선 취급하지만
# 원본 데이터엔 57개 전체가 있으므로 나중에 쉽게 확장 가능.
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

YM_RE = re.compile(r"^(\d{2})\.(\d{2})월?$")

COL_ALIASES = {
    "month": ["month", "연월", "월"],
    "dest": ["destinations", "destination", "목적지"],
    "chilled": ["chilled beef & veal total", "chilled"],
    "frozen": ["frozen total", "frozen"],
    "total": ["beef & veal total", "total"],
    "goat": ["total goat", "goat"],
}


def find_columns(df: pd.DataFrame):
    lower_cols = {str(c).strip().lower(): c for c in df.columns}
    found = {}
    for key, aliases in COL_ALIASES.items():
        for a in aliases:
            if a in lower_cols:
                found[key] = lower_cols[a]
                break
    missing = [k for k in ("month", "dest", "total") if k not in found]
    if missing:
        raise RuntimeError(f"필수 열을 찾지 못함: {missing} (실제 열: {list(df.columns)})")
    return found


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
    df = pd.read_excel(path, sheet_name=0, header=0)
    cols = find_columns(df)

    records = []
    skipped_dest = set()
    for _, row in df.iterrows():
        m = YM_RE.match(str(row[cols["month"]]).strip())
        if not m:
            continue
        year = 2000 + int(m.group(1))
        month = int(m.group(2))

        dest_name = str(row[cols["dest"]]).strip().lower()
        code = CODE_BY_LOWER_NAME.get(dest_name)
        if code is None:
            skipped_dest.add(str(row[cols["dest"]]).strip())
            continue

        chilled = to_num(row[cols["chilled"]]) if "chilled" in cols else 0.0
        frozen = to_num(row[cols["frozen"]]) if "frozen" in cols else 0.0
        total = to_num(row[cols["total"]])
        goat = to_num(row[cols["goat"]]) if "goat" in cols else 0.0
        if total is None:
            continue
        records.append([year, month, code, chilled or 0.0, frozen or 0.0, total, goat or 0.0])

    print(f"  (참고) 목적지 매칭 안 돼서 건너뛴 이름들 일부: {sorted(skipped_dest)[:10]}"
          f"{'...' if len(skipped_dest) > 10 else ''} (소계행 포함이라 정상)", file=sys.stderr)
    return records


def merge_into_json(records, do_merge: bool):
    existing = {"data": []}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    by_key = {}
    # 기존 데이터가 v1 스키마(4개 필드: year,month,dest,total)일 수도 있으니
    # 길이를 보고 안전하게 처리 (v1 레코드는 chilled/frozen/goat를 0으로 채움)
    for r in existing.get("data", []):
        if len(r) == 4:
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
        "product": "Beef & Veal (10개 주요 목적지, 사용자 수동 취합)",
        "sector": "Red meat",
        "sourceNote": "호주 DAFF 'Australian red meat export statistics' 57 Destination Report를 사용자가 직접 취합한 로우데이터를 수동 업로드",
        "unit": "ton",
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "granularity": "monthly",
        "destNames": DEST_LABEL,
        "cols": ["year", "month", "dest", "chilledTon", "frozenTon", "totalBeefVealTon", "goatTon"],
        "data": sorted(by_key.values(), key=lambda r: (r[0], r[1], r[2])),
    }

    print(f"파싱: {len(records)}건 (신규 {added}건, 갱신 {changed}건), 최종 총 {len(out['data'])}건")
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
    ap.add_argument("path", help="업로드된 로우데이터 엑셀 파일 경로")
    ap.add_argument("--merge", action="store_true", help="실제로 data/aus_meat_export.json에 반영")
    args = ap.parse_args()

    records = parse_file(args.path)
    if not records:
        print("파싱된 레코드가 없습니다. 파일 형식을 확인해주세요.", file=sys.stderr)
        sys.exit(1)

    years_months = sorted(set((r[0], r[1]) for r in records))
    print(f"기간: {years_months[0][0]}.{years_months[0][1]:02d} ~ {years_months[-1][0]}.{years_months[-1][1]:02d} ({len(years_months)}개월)")
    print(f"목적지: {sorted(set(DEST_LABEL[r[2]] for r in records))}")

    merge_into_json(records, args.merge)


if __name__ == "__main__":
    main()
