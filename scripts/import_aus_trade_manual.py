# -*- coding: utf-8 -*-
"""
호주 축산물(소고기 Beef & Veal) 수출현황 - 수동 업로드 파일 임포터.

agriculture.gov.au는 GitHub Actions IP가 차단되어 있고(확인됨), UN Comtrade는
접속은 되지만 DAFF 원본보다 1개월 더 느려서(치명적) 자동화를 포기함.
대신 사용자가 agriculture.gov.au의 "57 Destination Report" 월별 파일들을 직접
엑셀/파워쿼리로 모아서 만든 피벗 테이블(국가별 x 월별 Beef & Veal Total)을
이 스크립트로 병합한다. CEPEA 내수현황과 동일한 수동 업로드 패턴.

기대하는 입력 파일 형식 (사용자가 보통 만드는 피벗 그대로):
  - 시트 아무 이름이나 무방, 첫 시트를 사용
  - 어딘가에 "행 레이블"(또는 "Row Labels") 헤더가 있는 행 = 헤더 행
  - 그 헤더 행에 10개국(China/Hong Kong/Indonesia/Japan/Philippines/
    South Korea/Taiwan/Thailand/USA East/USA West) 열이 존재
    (5개국짜리 축약 피벗이 왼쪽에 같이 있어도 무시하고 10개국 쪽만 사용;
    중복 열 이름은 pandas가 자동으로 ".1" 등을 붙이므로 그것도 처리)
  - 데이터 행의 첫 칸은 "24.01월"처럼 "YY.MM월" 형식의 연월 라벨
  - 값 단위는 톤(t) 기준 (기존 대조 검증 시 Comtrade kg/1000과 일치 확인됨)

사용법:
  python scripts/import_aus_trade_manual.py <업로드된_엑셀_경로>
  python scripts/import_aus_trade_manual.py <경로> --merge   (실제 반영)
  (--merge 없이 실행하면 파싱 결과만 보여주고 data 파일은 안 건드림)

출력: data/aus_meat_export.json
"""
import argparse
import json
import os
import re
import sys

import pandas as pd

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aus_meat_export.json")

# 피벗의 열 이름(한글/영문 혼용 가능성 대비, 소문자 비교) -> 우리 내부 코드
DEST_MATCH = {
    "CN": ["china"],
    "HK": ["hong kong"],
    "ID": ["indonesia"],
    "JP": ["japan"],
    "PH": ["philippines"],
    "KR": ["south korea", "korea"],
    "TW": ["taiwan"],
    "TH": ["thailand"],
    "US_EAST": ["usa east", "us east"],
    "US_WEST": ["usa west", "us west"],
}
DEST_LABEL = {
    "CN": "China", "HK": "Hong Kong", "ID": "Indonesia", "JP": "Japan",
    "PH": "Philippines", "KR": "South Korea", "TW": "Taiwan", "TH": "Thailand",
    "US_EAST": "USA East", "US_WEST": "USA West",
}

YM_RE = re.compile(r"^(\d{2})\.(\d{2})월?$")


def find_header_row(raw: pd.DataFrame):
    """'행 레이블'(또는 Row Labels) 헤더가 있는 행을 찾는다. 같은 헤더가
    두 번(5개국 피벗 + 10개국 피벗) 있을 수 있으므로 전부 반환."""
    hits = []
    for r in range(min(6, len(raw))):
        row_vals = [str(v).strip() for v in raw.iloc[r].tolist()]
        for c, v in enumerate(row_vals):
            if v in ("행 레이블", "Row Labels"):
                hits.append((r, c))
    return hits


def pick_dest_columns(raw: pd.DataFrame, header_row: int):
    """헤더 행 전체를 훑어서 10개국 열의 위치를 찾는다. 왼쪽에 5개국
    축약 피벗이 같이 있으면 겹치는 이름(China 등)이 여러 번 나오므로,
    10개국이 전부 모여 있는 '가장 넓은 연속 구간'을 찾는다."""
    row_vals = [str(v).strip().lower() for v in raw.iloc[header_row].tolist()]
    col_for_dest = {}
    for code, hints in DEST_MATCH.items():
        matches = [i for i, v in enumerate(row_vals) for h in hints if v == h]
        if matches:
            col_for_dest[code] = matches  # 여러 후보 열 인덱스

    if not col_for_dest:
        return {}

    # 후보가 여러 개인 코드가 있으면(중복 피벗), 모든 코드가 동시에 존재하는
    # 열 구간을 찾기 위해: 각 코드의 "마지막 등장 열"을 쓰는 방식이 보통
    # 10개국 피벗이 시트 오른쪽에 있으므로 안전함.
    result = {}
    for code, cols in col_for_dest.items():
        result[code] = cols[-1] if len(cols) > 1 else cols[0]
    return result


def parse_file(path: str):
    raw = pd.read_excel(path, sheet_name=0, header=None)
    header_hits = find_header_row(raw)
    if not header_hits:
        raise RuntimeError("'행 레이블'/'Row Labels' 헤더를 찾지 못했습니다. 피벗 형식이 예상과 다릅니다.")
    header_row = header_hits[0][0]
    dest_cols = pick_dest_columns(raw, header_row)
    missing = [DEST_LABEL[c] for c in DEST_LABEL if c not in dest_cols]
    if missing:
        print(f"  경고: 다음 목적지 열을 못 찾음(건너뜀): {missing}", file=sys.stderr)
    if not dest_cols:
        raise RuntimeError("목적지 국가 열을 하나도 찾지 못했습니다.")

    ym_col = None
    for c in range(raw.shape[1]):
        if str(raw.iloc[header_row, c]).strip() in ("행 레이블", "Row Labels"):
            ym_col = c
            break

    records = []
    for r in range(header_row + 1, len(raw)):
        ym_raw = raw.iloc[r, ym_col]
        m = YM_RE.match(str(ym_raw).strip())
        if not m:
            continue  # 총계 행 등 라벨이 없는 행은 건너뜀
        year = 2000 + int(m.group(1))
        month = int(m.group(2))
        for code, col in dest_cols.items():
            val = raw.iloc[r, col]
            if pd.isna(val) or str(val).strip() in ("-", ""):
                continue
            try:
                tons = float(val)
            except (TypeError, ValueError):
                continue
            records.append([year, month, code, tons])
    return records


def merge_into_json(records, do_merge: bool):
    existing = {"data": []}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    by_key = {(r[0], r[1], r[2]): r for r in existing.get("data", [])}
    changed = 0
    added = 0
    for r in records:
        key = (r[0], r[1], r[2])
        if key in by_key and by_key[key] != r:
            changed += 1
        elif key not in by_key:
            added += 1
        by_key[key] = r

    import datetime
    out = {
        "product": "Beef & Veal Total (10개 주요 목적지, 사용자 수동 취합)",
        "sector": "Red meat",
        "sourceNote": "호주 DAFF 'Australian red meat export statistics' 57 Destination Report를 사용자가 직접 취합한 피벗을 수동 업로드",
        "unit": "ton",
        "collectedAt": datetime.datetime.now().astimezone().isoformat(),
        "granularity": "monthly",
        "destNames": DEST_LABEL,
        "cols": ["year", "month", "dest", "totalBeefVealTon"],
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
    ap.add_argument("path", help="업로드된 피벗 엑셀 파일 경로")
    ap.add_argument("--merge", action="store_true", help="실제로 data/aus_meat_export.json에 반영")
    args = ap.parse_args()

    records = parse_file(args.path)
    if not records:
        print("파싱된 레코드가 없습니다. 피벗 형식을 확인해주세요.", file=sys.stderr)
        sys.exit(1)

    years_months = sorted(set((r[0], r[1]) for r in records))
    print(f"기간: {years_months[0][0]}.{years_months[0][1]:02d} ~ {years_months[-1][0]}.{years_months[-1][1]:02d} ({len(years_months)}개월)")
    print(f"목적지: {sorted(set(DEST_LABEL[r[2]] for r in records))}")

    merge_into_json(records, args.merge)


if __name__ == "__main__":
    main()
