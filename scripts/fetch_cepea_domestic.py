"""브라질 CEPEA/ESALQ 돈육·계육 내수 가격 지표 수집기.

CEPEA(cepea.org.br / cepea.esalq.usp.br)는 화면(indicador/*.aspx)은 봇 차단이 걸려있지만,
'series/*.aspx?id=번호' 다운로드 전용 엔드포인트는 GET 요청 한 번으로 xls 파일을 그대로
응답한다 (공개 스크래퍼 royopa/cepea_scraper로 검증된 방식).

응답 xls는 정상 CFBF(Compound File)이지만 xlrd가 기본적으로는
"CompDocError: Workbook corruption" 을 낸다. xlrd>=2.0의
open_workbook_xls(..., ignore_workbook_corruption=True) 로 우회 가능 (검증 완료).

품목:
- 돈육: PREÇOS DA CARCAÇA SUÍNA ESPECIAL (R$/kg) - id=124
- 계육: PREÇOS DO FRANGO RESFRIADO CEPEA/ESALQ - ESTADO SP (R$/kg, US$/kg) - id=130

출력: data/cepea_pork_domestic.json, data/cepea_chicken_domestic.json
"""
import datetime as dt
import io
import json
import os
import sys
import time

import requests
import xlrd

BASE = "https://www.cepea.esalq.usp.br/br/indicador/series/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}
MAX_RETRIES = 5

TARGETS = [
    {
        "key": "pork",
        "out": "data/cepea_pork_domestic.json",
        "url": BASE + "suino.aspx?id=124",
        "indicator": "Carcaça Suína Especial - Grande São Paulo",
        "label_kr": "돈육 (카르카사 특급, 상파울루)",
        "unit": "R$/kg",
        "source": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/suino.aspx?id=124)",
        "columns": ["Data", "Média"],
    },
    {
        "key": "chicken",
        "out": "data/cepea_chicken_domestic.json",
        "url": BASE + "frango.aspx?id=130",
        "indicator": "Frango Resfriado - Estado de São Paulo",
        "label_kr": "계육 (냉장 닭고기, 상파울루주)",
        "unit": "R$/kg e US$/kg",
        "source": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/frango.aspx?id=130)",
        "columns": ["Data", "À vista R$", "À vista US$"],
    },
]


def download(url: str) -> bytes:
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
        except Exception as e:  # 네트워크 에러
            last_err = repr(e)
            time.sleep(min(5 * attempt, 20))
            continue
        if r.status_code == 200 and len(r.content) > 1000:
            ctype = r.headers.get("Content-Type", "")
            print(f"  status={r.status_code} content-type={ctype} bytes={len(r.content)}")
            return r.content
        last_err = f"status={r.status_code} bytes={len(r.content)} body_head={r.text[:200] if r.text else ''}"
        time.sleep(min(5 * attempt, 20))
    raise RuntimeError(f"다운로드 실패: {url} ({last_err})")


def parse_xls(content: bytes):
    wb = xlrd.open_workbook(file_contents=content, ignore_workbook_corruption=True)
    sheet = wb.sheet_by_index(0)
    # 상단 3줄(제목/공백/출처)은 스킵, 4번째 줄이 헤더
    header_row = None
    for r in range(min(6, sheet.nrows)):
        vals = [str(v).strip() for v in sheet.row_values(r)]
        if vals and vals[0] == "Data":
            header_row = r
            break
    if header_row is None:
        raise RuntimeError("헤더 행('Data')을 찾지 못함")
    rows = []
    for r in range(header_row + 1, sheet.nrows):
        vals = sheet.row_values(r)
        if not vals or not str(vals[0]).strip():
            continue
        rows.append(vals)
    return rows


def parse_date_br(s: str):
    s = str(s).strip()
    try:
        return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def process_target(target: dict):
    print(f"[{target['key']}] 다운로드: {target['url']}")
    content = download(target["url"])
    rows = parse_xls(content)
    print(f"[{target['key']}] 파싱된 행수: {len(rows)}")

    data = []
    if target["key"] == "pork":
        for row in rows:
            date_iso = parse_date_br(row[0])
            value = num(row[1]) if len(row) > 1 else None
            if date_iso and value is not None:
                data.append({"date": date_iso, "value": value})
    else:  # chicken
        for row in rows:
            date_iso = parse_date_br(row[0])
            brl = num(row[1]) if len(row) > 1 else None
            usd = num(row[2]) if len(row) > 2 else None
            if date_iso and (brl is not None or usd is not None):
                data.append({"date": date_iso, "valueBRL": brl, "valueUSD": usd})

    data.sort(key=lambda d: d["date"])

    out = {
        "indicator": target["indicator"],
        "labelKr": target["label_kr"],
        "unit": target["unit"],
        "url": target["url"],
        "source": target["source"],
        "collectedAt": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "count": len(data),
        "range": {
            "start": data[0]["date"] if data else None,
            "end": data[-1]["date"] if data else None,
        },
        "data": data,
    }
    os.makedirs("data", exist_ok=True)
    with open(target["out"], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[{target['key']}] 완료: {len(data)}건, 기간 {out['range']['start']} ~ {out['range']['end']}")
    if len(data) == 0:
        print(f"::warning::[{target['key']}] 수집된 행이 0건입니다.")
    return out


def main():
    results = []
    for target in TARGETS:
        results.append(process_target(target))
    total = sum(r["count"] for r in results)
    print(f"전체 완료: {total}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
