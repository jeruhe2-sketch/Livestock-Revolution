"""USDA AMS MyMarketNews LM_PK602 (report 2498) 수집기.

목표 품목:
- Bnls CC Strap-off
- Picnic Cushion Meat Vac
- 1/4 Trim Bnls Butt VAC

USDA 원자료의 weighted average는 $/100 lb(cwt) 기준이므로
화면용 usdPerLb = weighted_average / 100 으로 저장한다.
"""
import datetime as dt
import json
import os
import re
import sys
from typing import Any

import requests

BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports/2498"
OUT = "data/usda_pork_domestic.json"
DAYS = 180
ITEMS = {
    "Bnls CC Strap-off": "등심",
    "Picnic Cushion Meat Vac": "전지",
    "1/4 Trim Bnls Butt VAC": "목전지",
}


def norm(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip()).casefold()


def num(v: Any):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("$", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def first_num(d: dict, keys):
    for k in keys:
        if k in d:
            x = num(d.get(k))
            if x is not None:
                return x
    return None


def parse_date(v: Any):
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(s[:19], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def walk(obj: Any, inherited_date=None, out=None):
    if out is None:
        out = []
    if isinstance(obj, dict):
        local_date = parse_date(obj.get("report_date") or obj.get("reportDate") or obj.get("report_begin_date") or obj.get("report_begin_date")) or inherited_date
        item = obj.get("Item_Description") or obj.get("item_description") or obj.get("itemDescription") or obj.get("item")
        if item:
            key = next((k for k in ITEMS if norm(k) == norm(item)), None)
            if key:
                wtd = first_num(obj, ["weighted_average", "weightedAverage", "wtd_avg", "wtdAvg", "weighted_avg"])
                pounds = first_num(obj, ["total_pounds", "totalPounds", "pounds", "volume", "total_volume"])
                if local_date and wtd is not None:
                    out.append({
                        "date": local_date,
                        "item": key,
                        "label": ITEMS[key],
                        "pounds": pounds,
                        "wtdAvgCwt": round(wtd, 4),
                        "usdPerLb": round(wtd / 100.0, 4),
                    })
        for v in obj.values():
            walk(v, local_date, out)
    elif isinstance(obj, list):
        for v in obj:
            walk(v, inherited_date, out)
    return out


def fetch(start: dt.date, end: dt.date):
    key = os.environ.get("USDA_MMN_API_KEY") or os.environ.get("USDA_API_KEY")
    if not key:
        raise RuntimeError("USDA_MMN_API_KEY 또는 USDA_API_KEY secret이 필요합니다.")
    q = f"report_date={start.isoformat()}:{end.isoformat()}"
    r = requests.get(BASE, params={"q": q, "all": "true"}, auth=(key, ""), timeout=90)
    r.raise_for_status()
    return r.json()


def main():
    end = dt.date.today()
    start = end - dt.timedelta(days=DAYS - 1)
    payload = fetch(start, end)
    records = walk(payload)

    # 날짜/품목별 중복은 가장 완전한 레코드로 유지한다.
    dedup = {}
    for rec in records:
        k = (rec["date"], rec["item"])
        old = dedup.get(k)
        if old is None or (rec.get("pounds") is not None and old.get("pounds") is None):
            dedup[k] = rec

    by_date = {}
    for rec in dedup.values():
        by_date.setdefault(rec["date"], {})[rec["item"]] = {
            "label": rec["label"],
            "pounds": rec["pounds"],
            "wtdAvgCwt": rec["wtdAvgCwt"],
            "usdPerLb": rec["usdPerLb"],
        }

    rows = [{"date": d, **by_date[d]} for d in sorted(by_date)]
    out = {
        "report": "LM_PK602",
        "slugId": 2498,
        "title": "National Daily Pork FOB Plant - Negotiated Sales - Afternoon",
        "unit": "USD/100 lb",
        "screenUnit": "USD/lb",
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "collectedAt": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "source": "USDA AMS MyMarketNews",
        "data": rows,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: {len(rows)}개 발표일 / {len(dedup)}개 품목 레코드 -> {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
