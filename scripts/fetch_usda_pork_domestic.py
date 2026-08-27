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
    "1/4 Trim Bnls Butt VAC": "목전지",
}
# 위 3개 품목이 실제로 위치하는 리포트 섹션 (usdampr 패키지 slugInfo로 확인됨)
SECTIONS = {
    "Bnls CC Strap-off": "Loin Cuts",
    "Picnic Cushion Meat Vac": "Picnic Cuts",
    "1/4 Trim Bnls Butt VAC": "Butt Cuts",
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


def fetch_chunk(start: dt.date, end: dt.date):
    report_time = f"{start.strftime('%m/%d/%Y')}:{end.strftime('%m/%d/%Y')}"
    params = {"q": f"report_date={report_time}", "allSections": "true"}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(BASE, params=params, headers={"Accept": "application/json"}, timeout=90)
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
    print(f"경고: {report_time} 구간 수집 실패, 건너뜀 ({last_err})", file=sys.stderr)
    return None


def extract_records(payload):
    """payload에서 우리가 추적하는 3개 품목의 (date, item, pounds, wtdAvgCwt) 레코드를 뽑는다.

    보통 payload는 {"reportSection": [...], "results": [...]} 형태의 dict이지만,
    일부 좁은 날짜범위/응답에서는 여러 날짜의 그런 dict들이 담긴 list로 오는 경우가
    실제로 확인되어(list.get 오류) 두 형태 모두 처리하도록 방어적으로 작성함.
    """
    out = []
    if not payload:
        return out
    payloads = payload if isinstance(payload, list) else [payload]
    target_norms = {item: norm(item) for item in ITEMS}
    for p in payloads:
        if not isinstance(p, dict):
            continue
        sections = p.get("reportSection") or []
        results = p.get("results") or []
        for i, rows in enumerate(results):
            sec_name = sections[i] if i < len(sections) else None
            if not rows or not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                for item, tnorm in target_norms.items():
                    if sec_name != SECTIONS[item]:
                        continue
                    is_match = any(isinstance(v, str) and norm(v) == tnorm for v in row.values())
                    if not is_match:
                        continue
                    report_date = None
                    for key in ("report_date", "published_date", "date"):
                        if row.get(key):
                            report_date = parse_date(row[key])
                            break
                    if not report_date:
                        continue
                    price = None
                    for k, v in row.items():
                        if "wtd" in k.lower():
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
    """180일 제한을 넘는 범위는 청크로 나눠 순차 요청."""
    records = []
    cur = start
    dumped = False
    while cur <= end:
        chunk_end = min(cur + dt.timedelta(days=CHUNK_DAYS - 1), end)
        print(f"수집 중: {cur} ~ {chunk_end}")
        payload = fetch_chunk(cur, chunk_end)
        if os.environ.get("PK602_DEBUG_DUMP") and not dumped and payload:
            dumped = True
            p0 = payload[0] if isinstance(payload, list) else payload
            print("DEBUG type:", type(payload).__name__)
            print("DEBUG top-level keys:", list(p0.keys()) if isinstance(p0, dict) else "N/A")
            secs = p0.get("reportSection") if isinstance(p0, dict) else None
            print("DEBUG reportSection:", secs)
            results = p0.get("results") if isinstance(p0, dict) else None
            if isinstance(results, list):
                for i, rows in enumerate(results):
                    sec_name = secs[i] if secs and i < len(secs) else None
                    print(f"DEBUG section[{i}]={sec_name!r} rows={len(rows) if isinstance(rows, list) else rows}")
                    if isinstance(rows, list) and rows:
                        print(f"  sample row: {json.dumps(rows[0], ensure_ascii=False)[:500]}")
                        if len(rows) > 1:
                            print(f"  sample row[1]: {json.dumps(rows[1], ensure_ascii=False)[:500]}")
        try:
            recs = extract_records(payload)
        except Exception as e:
            print(f"  경고: {cur}~{chunk_end} 파싱 중 오류, 이 구간 건너뜀: {e!r}", file=sys.stderr)
            recs = []
        print(f"  -> {len(recs)}건 매칭")
        records.extend(recs)
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
