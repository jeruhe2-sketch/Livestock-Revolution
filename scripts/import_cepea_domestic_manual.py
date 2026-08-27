# -*- coding: utf-8 -*-
"""브라질 CEPEA/ESALQ 돈육·계육 내수 가격 지표 - 수동 업로드 파일 임포터.

CEPEA(cepea.org.br)는 Cloudflare 체크박스 챌린지로 자동 다운로드가 막혀 있어서
(playwright 헤드리스로도 통과 안 됨 - 데이터센터 IP 평판 문제로 추정),
당분간은 사람이 브라우저에서 직접 "가격추이 → 엑셀 다운로드"로 받은 파일을
이 스크립트로 병합하는 수동 방식을 사용한다.

받는 화면(사람이 직접):
  돈육: https://www.cepea.org.br/br/indicador/suino.aspx
        (PREÇOS DA CARCAÇA SUÍNA ESPECIAL 항목의 "Série de preços" → 엑셀 다운로드)
  계육: https://www.cepea.org.br/br/indicador/series/frango.aspx?id=130
        ("Série de preços" → 엑셀 다운로드)

사용 예:
  python scripts/import_cepea_domestic_manual.py --pork data/raw/cepea_suino.xls --chicken data/raw/cepea_frango.xls
  (둘 중 하나만 새로 받았으면 하나만 넘겨도 됨. 기존 데이터의 다른 품목은 그대로 유지됨)

출력: data/cepea_domestic.json (돈육 R$/kg + 계육 R$/kg·US$/kg 통합, 날짜 기준 병합)
"""
import argparse
import datetime as dt
import json
import os
import sys

import xlrd

OUT_PATH = "data/cepea_domestic.json"

META = {
    "indicatorPork": "Carcaça Suína Especial - Grande São Paulo",
    "indicatorChicken": "Frango Resfriado - Estado de São Paulo",
    "unit": "R$/kg",
    "sourcePork": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/suino.aspx?id=124)",
    "sourceChicken": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/frango.aspx?id=130)",
}


def parse_xls_rows(path: str):
    with open(path, "rb") as f:
        content = f.read()
    wb = xlrd.open_workbook(file_contents=content, ignore_workbook_corruption=True)
    sheet = wb.sheet_by_index(0)
    header_row = None
    for r in range(min(6, sheet.nrows)):
        vals = [str(v).strip() for v in sheet.row_values(r)]
        if vals and vals[0] == "Data":
            header_row = r
            break
    if header_row is None:
        raise RuntimeError(f"{path}: 헤더 행('Data')을 찾지 못함")
    rows = []
    for r in range(header_row + 1, sheet.nrows):
        vals = sheet.row_values(r)
        if not vals or not str(vals[0]).strip():
            continue
        rows.append(vals)
    return rows


def parse_date_br(s) -> str:
    s = str(s).strip()
    return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def load_pork(path: str) -> dict:
    rows = parse_xls_rows(path)
    out = {}
    for row in rows:
        d = parse_date_br(row[0])
        v = num(row[1]) if len(row) > 1 else None
        if v is not None:
            out[d] = {"value": v}
    print(f"[돈육] {path}: {len(out)}건 파싱 ({min(out)} ~ {max(out)})" if out else f"[돈육] {path}: 0건")
    return out


def load_chicken(path: str) -> dict:
    rows = parse_xls_rows(path)
    out = {}
    for row in rows:
        d = parse_date_br(row[0])
        brl = num(row[1]) if len(row) > 1 else None
        usd = num(row[2]) if len(row) > 2 else None
        if brl is not None or usd is not None:
            out[d] = {"valueBRL": brl, "valueUSD": usd}
    print(f"[계육] {path}: {len(out)}건 파싱 ({min(out)} ~ {max(out)})" if out else f"[계육] {path}: 0건")
    return out


def load_existing() -> dict:
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            data = json.load(f)
        by_date = {row["date"]: row for row in data.get("data", [])}
        return by_date
    return {}


def apply_pork_usd(by_date: dict) -> int:
    """계육 데이터에 CEPEA가 같이 주는 R$/US$ 비율(=그날의 BRL/USD 환율)을 역산해서
    돈육에도 참고용 US$/kg을 채운다. 날짜가 정확히 안 맞으면 가장 가까운 과거 환율을
    앞으로 그대로 사용(forward-fill)한다."""
    dates = sorted(by_date.keys())
    last_rate = None
    filled = 0
    for d in dates:
        row = by_date[d]
        chicken = row.get("chicken") or {}
        brl, usd = chicken.get("valueBRL"), chicken.get("valueUSD")
        if brl and usd:
            last_rate = brl / usd  # BRL per USD
        pork = row.get("pork")
        if pork and pork.get("value") is not None and last_rate:
            pork["valueUSD"] = round(pork["value"] / last_rate, 4)
            filled += 1
    return filled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pork", help="돈육(carcaça especial) xls 파일 경로")
    ap.add_argument("--chicken", help="계육(frango resfriado) xls 파일 경로")
    args = ap.parse_args()
    if not args.pork and not args.chicken:
        raise SystemExit("--pork 또는 --chicken 중 최소 하나는 지정해야 합니다.")

    by_date = load_existing()

    if args.pork:
        for d, v in load_pork(args.pork).items():
            by_date.setdefault(d, {"date": d})["pork"] = v
    if args.chicken:
        for d, v in load_chicken(args.chicken).items():
            by_date.setdefault(d, {"date": d})["chicken"] = v

    filled = apply_pork_usd(by_date)
    print(f"[돈육] 계육 환율 역산으로 US$/kg {filled}건 채움")

    merged = [by_date[d] for d in sorted(by_date.keys())]
    out = {
        **META,
        "collectedAt": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "updateMode": "manual",
        "count": len(merged),
        "period": {"start": merged[0]["date"] if merged else None, "end": merged[-1]["date"] if merged else None},
        "data": merged,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: 총 {len(merged)}행 저장 ({OUT_PATH}), 기간 {out['period']['start']} ~ {out['period']['end']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
