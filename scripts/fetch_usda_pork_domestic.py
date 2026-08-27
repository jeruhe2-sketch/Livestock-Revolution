"""USDA AMS LMR Datamart LM_PK602 (report/slug 2498) 수집기.

기존 버전은 marsapi.ams.usda.gov(MyMarketNews API, API key 필요)를 썼는데
USDA_MMN_API_KEY secret이 없어서(또는 유효하지 않아서) 401 Unauthorized로 계속 실패했음.

대신 인증키가 필요 없는 LMR Datamart API(mpr.datamart.ams.usda.gov)로 전환함.
요청 형식은 공개된 R 패키지 usdampr(https://github.com/cbw1243/usdampr)의 실제 구현으로 확인:
  https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498?q=report_date=MM/DD/YYYY[:MM/DD/YYYY]&allSections=true
- 날짜 범위는 한 번에 최대 180일 제한 (MARS API와 달리 넉넉한 범위 불가 -> 청크 처리 필요).
- 응답 형태: {"reportSection": [...섹션명...], "results": [...섹션별 행배열...]}

출력 JSON 스키마(usda_domestic_app.js가 그대로 소비하므로 절대 변경하지 않음):
  {report, slugId, title, unit, screenUnit, period, refreshWindowDays, collectedAt, source, data}
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
from typing import Any

import requests

BASE = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498"
OUT = "data/usda_pork_domestic.json"
REFRESH_DAYS = 21
CHUNK_DAYS = 170  # API 180일 제한보다 여유있게
MAX_RETRIES = 6
ITEMS = {
    "Bnls CC Strap-off": "등심",
    "Picnic Cushion Meat Vac": "전지",
    "1/4 Trim Butt VAC": "목전지",
}
# 위 3개 품목이 실제로 위치하는 리포트 섹션 (usdampr 패키지 slugInfo로 확인됨)
SECTIONS = {
    "Bnls CC Strap-off": "Loin Cuts",
    "Picnic Cushion Meat Vac": "Picnic Cuts",
    "1/4 Trim Butt VAC": "Butt Cuts",
}


def norm(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(v or "").casefold())


def num(v: Any):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in ("-", "N/A", "NA"):
        return None
    try:
        return float(s.replace(",", "").replace("$", ""))
    except ValueError:
        return None


def parse_date(v: Any):
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s[:19], fmt).date().isoformat()
        except ValueError:
            pass
    try:
        return dt.date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def three_years_ago(day: dt.date) -> dt.date:
    try:
        return day.replace(year=day.year - 3)
    except ValueError:
        return day.replace(year=day.year - 3, month=2, day=28)


def fetch_chunk(section: str, start: dt.date, end: dt.date):
    """특정 섹션(예: 'Loin Cuts')을 지정해서 날짜범위로 조회.
    allSections=true + 날짜범위 조합은 Summary만 반복 반환하는 것으로 확인되어(실제 응답 검증됨),
    공식 가이드 예시처럼 섹션명을 URL 경로에 직접 지정하는 방식으로 전환함:
      https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498/Loin%20Cuts?q=report_date=...
    """
    report_time = f"{start.strftime('%m/%d/%Y')}:{end.strftime('%m/%d/%Y')}"
    url = f"{BASE}/{urllib.parse.quote(section)}"
    params = {"q": f"report_date={report_time}"}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=90)
        except Exception as e:  # 네트워크 에러
            last_err = repr(e)
            time.sleep(min(5 * attempt, 30))
            continue
        if r.status_code == 200:
            try:
                return r.json()
            except Exception as e:
                last_err = f"json parse error: {e!r} body={r.text[:300]}"
        else:
            last_err = f"status={r.status_code} body={r.text[:300]}"
        time.sleep(min(5 * attempt, 30))
    print(f"경고: [{section}] {report_time} 구간 수집 실패, 건너뜀 ({last_err})", file=sys.stderr)
    return None


def _iter_row_dicts(node, inherited_date=None):
    """응답 JSON 구조(dict/list 임의 중첩)를 재귀적으로 순회하며 '행처럼 보이는' dict를
    (row, 상속된 report_date) 쌍으로 전부 yield. 행 자체에 report_date가 없고 상위 dict에만
    있는 경우(예: {report_date:..., results:[{item...}, ...]})를 위해 날짜를 하위로 물려준다."""
    if isinstance(node, dict):
        local_date = None
        for key in ("report_date", "published_date", "date"):
            if node.get(key):
                local_date = parse_date(node[key])
                break
        effective_date = local_date or inherited_date
        yield node, effective_date
        for v in node.values():
            yield from _iter_row_dicts(v, effective_date)
    elif isinstance(node, list):
        for v in node:
            yield from _iter_row_dicts(v, inherited_date)


def extract_records_for_item(payload, item: str):
    """payload(특정 섹션 응답)에서 item과 일치하는 행들을 전부 뽑는다."""
    out = []
    if not payload:
        return out
    tnorm = norm(item)
    for row, inherited_date in _iter_row_dicts(payload):
        is_match = any(isinstance(v, str) and norm(v) == tnorm for v in row.values())
        if not is_match:
            continue
        report_date = None
        for key in ("report_date", "published_date", "date"):
            if row.get(key):
                report_date = parse_date(row[key])
                break
        report_date = report_date or inherited_date
        if not report_date:
            continue
        price = None
        for k, v in row.items():
            kl = k.lower()
            if "wtd" in kl or "weight" in kl:
                price = num(v)
                if price is not None:
                    break
        if price is None:
            continue
        pounds = None
        for k, v in row.items():
            if "pound" in k.lower() or "volume" in k.lower():
                pounds = num(v)
                if pounds is not None:
                    break
        out.append({
            "date": report_date,
            "item": item,
            "label": ITEMS[item],
            "pounds": pounds,
            "wtdAvgCwt": round(price, 4),
            "usdPerLb": round(price / 100.0, 4),
        })
    return out


def fetch_range(start: dt.date, end: dt.date):
    """섹션별로, 180일 제한을 넘는 범위는 청크로 나눠 순차 요청."""
    records = []
    items_by_section = {}
    for item, sec in SECTIONS.items():
        items_by_section.setdefault(sec, []).append(item)

    for section, items in items_by_section.items():
        cur = start
        section_dumped = False
        while cur <= end:
            chunk_end = min(cur + dt.timedelta(days=CHUNK_DAYS - 1), end)
            print(f"수집 중 [{section}]: {cur} ~ {chunk_end}")
            payload = fetch_chunk(section, cur, chunk_end)
            if os.environ.get("PK602_DEBUG_DUMP") and payload and not section_dumped:
                section_dumped = True
                sample = payload if isinstance(payload, dict) else (payload[0] if isinstance(payload, list) else None)
                print(f"DEBUG[{section}] type={type(payload).__name__} sample_keys={list(sample.keys()) if isinstance(sample, dict) else 'N/A'}")
                rows_seen = [r for r, _d in _iter_row_dicts(payload)]
                item_names = sorted({r.get("Item_Description") for r in rows_seen if r.get("Item_Description")})
                print(f"DEBUG[{section}] total row-dicts seen: {len(rows_seen)}, unique Item_Description values ({len(item_names)}): {item_names}")
            chunk_recs = []
            for item in items:
                try:
                    chunk_recs.extend(extract_records_for_item(payload, item))
                except Exception as e:
                    print(f"  경고: [{section}/{item}] {cur}~{chunk_end} 파싱 오류: {e!r}", file=sys.stderr)
            print(f"  -> {len(chunk_recs)}건 매칭")
            records.extend(chunk_recs)
            cur = chunk_end + dt.timedelta(days=1)
            time.sleep(1)
    return records


def load_existing():
    if not os.path.exists(OUT):
        return {}
    try:
        with open(OUT, encoding="utf-8") as f:
            payload = json.load(f)
        out = {}
        for r in payload.get("data", []):
            for item in ITEMS:
                cell = r.get(item)
                if isinstance(cell, dict) and cell.get("usdPerLb") is not None:
                    out[(r["date"], item)] = {"date": r["date"], "item": item, **cell}
        return out
    except Exception:
        return {}


def main():
    end = dt.date.today()
    start = three_years_ago(end)
    refresh_start = end - dt.timedelta(days=REFRESH_DAYS - 1)
    existing = load_existing()
    fetch_start = start if not existing else max(start, refresh_start)

    records = fetch_range(fetch_start, end)

    merged = existing
    for rec in records:
        merged[(rec["date"], rec["item"])] = rec
    merged = {k: v for k, v in merged.items() if start.isoformat() <= v["date"] <= end.isoformat()}

    by_date = {}
    for rec in merged.values():
        by_date.setdefault(rec["date"], {})[rec["item"]] = {
            "label": rec["label"], "pounds": rec.get("pounds"),
            "wtdAvgCwt": rec["wtdAvgCwt"], "usdPerLb": rec["usdPerLb"],
        }
    rows = [{"date": d, **by_date[d]} for d in sorted(by_date)]

    out = {
        "report": "LM_PK602",
        "slugId": 2498,
        "title": "National Daily Pork FOB Plant - Negotiated Sales - Afternoon",
        "unit": "USD/100 lb",
        "screenUnit": "USD/lb",
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "refreshWindowDays": REFRESH_DAYS,
        "collectedAt": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "source": "USDA AMS LMR Datamart (mpr.datamart.ams.usda.gov, slug 2498 / LM_PK602)",
        "data": rows,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: {len(rows)}개 발표일 / {len(merged)}개 품목 레코드 / 조회범위 {fetch_start}~{end}")
    if len(rows) == 0:
        print("::warning::수집된 행이 0건입니다. API 응답 구조가 예상과 다를 수 있습니다.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
