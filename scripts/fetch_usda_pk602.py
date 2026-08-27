# -*- coding: utf-8 -*-
"""
USDA AMS LMR(Livestock Mandatory Reporting) Datamart API로 National Daily Pork FOB Plant -
Negotiated Sales - Afternoon (LM_PK602, slug 2498) 리포트에서 국내(미국) 돈육 특정 부위의
일별 가중평균가(Wtd Avg, $/cwt)를 수집한다.

API는 인증키 불필요 (LMPR API는 MyMarketNews API와 달리 API key가 필요 없음).
요청 형식은 R 패키지 usdampr(https://github.com/cbw1243/usdampr)의 실제 구현을 참고해서 확인함:
  https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498?q=report_date=MM/DD/YYYY[:MM/DD/YYYY]&allSections=true
- 날짜 범위는 한 번에 최대 180일 제한.
- 응답은 {"reportSection": [...섹션명...], "results": [...섹션별 행배열...], "message": [...]}
  형태로, results[i]가 reportSection[i]에 대응하는 행(레코드) 배열이다.
- 2498(LM_PK602)의 섹션 구성: Summary, Cutout and Primal Values, Change From Prior Day,
  5-Day Average Cutout and Primal Values, Current Volume, Loin Cuts, Butt Cuts, Picnic Cuts,
  Ham Cuts, Belly Cuts, Sparerib Cuts, Jowl Cuts, Trim Cuts, Variety Cuts, Added Ingredients Cuts
  (usdampr 패키지의 slugInfo 데이터셋에서 확인).

우리가 추적하는 3개 부위는 각각 아래 섹션에 있다:
  - 등심(로인): "Loin Cuts" 섹션의 "Bnls CC Strap-off"
  - 목전지(버트): "Butt Cuts" 섹션의 "1/4 Trim Bnls Butt Vac"
  - 전지(피크닉): "Picnic Cuts" 섹션의 "Picnic Cushion Meat Vac"

각 행의 정확한 필드명(예: 품목명 필드가 "item_description"인지 "cut"인지, 가격 필드가
"wtd_avg_price"인지)은 공식 문서에 명시되어 있지 않아 확정할 수 없었음. 그래서 이 스크립트는
행의 모든 필드를 순회하면서: (1) 문자열 값 중 하나가 목표 품목명과 정규화(영숫자만 남기고 소문자
비교) 일치하면 그 행을 채택하고, (2) 같은 행에서 키에 "wtd"가 들어간 필드를 가격으로,
"pound"/"lbs"가 들어간 필드를 물량으로, "low"/"high" 또는 "range"가 들어간 필드를 가격범위로
휴리스틱하게 추출한다. 값이 "-"이거나 빈 문자열이면 그날 거래 없음으로 보고 건너뛴다.

가격 단위는 $/cwt(파운드 100개당 달러)이므로 $/lb로 쓰려면 100으로 나눠야 한다.

산출: data/usda_pk602.json
  {
    collectedAt, source, cuts: {key: {label_ko, label_en, section}},
    cols: ["date", "cutKey", "pounds", "priceLow", "priceHigh", "wtdAvgCwt"],
    data: [[date, cutKey, pounds, priceLow, priceHigh, wtdAvgCwt], ...]
  }
"""
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta

import requests

BASE = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498"
OUTPUT_PATH = "data/usda_pk602.json"

# 섹션명 -> 그 섹션에서 찾을 품목명(정규화 비교용 원문 그대로 넣으면 됨)
CUTS = {
    "loin_strap_off": {
        "section": "Loin Cuts",
        "match": "Bnls CC Strap-off",
        "label_ko": "등심(Bnls CC Strap-off)",
        "label_en": "Bnls CC Strap-off",
    },
    "butt_14trim_vac": {
        "section": "Butt Cuts",
        "match": "1/4 Trim Bnls Butt Vac",
        "label_ko": "목전지(1/4 Trim Bnls Butt VAC)",
        "label_en": "1/4 Trim Bnls Butt Vac",
    },
    "picnic_cushion_vac": {
        "section": "Picnic Cuts",
        "match": "Picnic Cushion Meat Vac",
        "label_ko": "전지(Picnic Cushion Meat Vac)",
        "label_en": "Picnic Cushion Meat Vac",
    },
}

START_DATE = date(2024, 1, 1)
CHUNK_DAYS = 170  # API 제한 180일보다 여유있게
MAX_RETRIES = 8
RETRY_BACKOFF_SEC = 10
RETRY_BACKOFF_CAP_SEC = 45


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def to_number(v):
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", "-", "N/A", "NA"):
        return None
    s = s.replace(",", "").replace("$", "")
    try:
        return float(s)
    except ValueError:
        return None


def fetch_range(start_d, end_d):
    report_time = f"{start_d.strftime('%m/%d/%Y')}:{end_d.strftime('%m/%d/%Y')}"
    params = {"q": f"report_date={report_time}", "allSections": "true"}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(BASE, params=params, headers={"Accept": "application/json"}, timeout=60)
        except Exception as e:
            last_err = f"exception: {e!r}"
            print(f"  [{report_time}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
            continue
        if r.status_code == 200:
            try:
                return r.json()
            except Exception as e:
                last_err = f"json parse error: {e!r} body={r.text[:300]}"
        else:
            last_err = f"status={r.status_code} body={r.text[:300]}"
        print(f"  [{report_time}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(min(RETRY_BACKOFF_SEC * attempt, RETRY_BACKOFF_CAP_SEC))
    print(f"  [{report_time}] 최종 실패, 이 구간은 건너뜀: {last_err}", file=sys.stderr)
    return None


def extract_rows(payload):
    """응답 JSON에서 (섹션명, 행딕셔너리) 쌍을 전부 뽑아낸다."""
    if not payload:
        return
    sections = payload.get("reportSection") or []
    results = payload.get("results") or []
    for i, sec_rows in enumerate(results):
        sec_name = sections[i] if i < len(sections) else None
        if not sec_rows:
            continue
        for row in sec_rows:
            if isinstance(row, dict):
                yield sec_name, row


def find_field_containing(row, *needles):
    for k, v in row.items():
        kl = k.lower()
        if any(needle in kl for needle in needles):
            yield k, v


def parse_row_for_cut(row):
    """행에서 가격/물량/가격범위를 휴리스틱하게 추출."""
    price = None
    for k, v in find_field_containing(row, "wtd"):
        n = to_number(v)
        if n is not None:
            price = n
            break
    if price is None:
        for k, v in find_field_containing(row, "avg"):
            n = to_number(v)
            if n is not None:
                price = n
                break
    pounds = None
    for k, v in find_field_containing(row, "pound", "lbs", "volume"):
        n = to_number(v)
        if n is not None:
            pounds = n
            break
    price_low, price_high = None, None
    for k, v in find_field_containing(row, "low"):
        price_low = to_number(v)
        break
    for k, v in find_field_containing(row, "high"):
        price_high = to_number(v)
        break
    if price_low is None and price_high is None:
        for k, v in find_field_containing(row, "range"):
            m = re.match(r"\s*([\d.,]+)\s*-\s*([\d.,]+)\s*", str(v))
            if m:
                price_low = to_number(m.group(1))
                price_high = to_number(m.group(2))
            break
    report_date = None
    for key in ("report_date", "published_date", "date"):
        if key in row and row[key]:
            report_date = row[key]
            break
    return report_date, pounds, price_low, price_high, price


def main():
    all_rows = []  # (date_iso, cutKey, pounds, priceLow, priceHigh, wtdAvgCwt)
    end = datetime.now().date()
    cur = START_DATE
    debug_dumped = False
    while cur <= end:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), end)
        print(f"수집 중: {cur} ~ {chunk_end}")
        payload = fetch_range(cur, chunk_end)
        if payload is not None and not debug_dumped:
            # 최초 1회, 실제 응답 구조를 로그에 남겨서(필드명이 예상과 다를 경우) 디버깅 가능하게 함
            print("DEBUG reportSection:", payload.get("reportSection"))
            debug_dumped = True
        matched_count = 0
        for sec_name, row in extract_rows(payload):
            for cut_key, cfg in CUTS.items():
                if sec_name != cfg["section"]:
                    continue
                # 행의 문자열 값 중 하나가 목표 품목명과 일치하는지 확인
                target_norm = norm(cfg["match"])
                is_match = any(
                    isinstance(v, str) and norm(v) == target_norm for v in row.values()
                )
                if not is_match:
                    continue
                report_date, pounds, price_low, price_high, price = parse_row_for_cut(row)
                if not report_date:
                    continue
                # 날짜 포맷 통일 (mm/dd/yyyy 또는 이미 iso일 수 있음)
                d = None
                raw_date_str = str(report_date).strip()
                for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%Y-%m-%d"):
                    try:
                        d = datetime.strptime(raw_date_str, fmt)
                        break
                    except ValueError:
                        continue
                if d is None:
                    try:
                        d = datetime.fromisoformat(raw_date_str[:10])
                    except ValueError:
                        print(f"  날짜 파싱 실패, 건너뜀: {report_date!r}", file=sys.stderr)
                        continue
                all_rows.append([d.date().isoformat(), cut_key, pounds, price_low, price_high, price])
                matched_count += 1
        print(f"  -> 이 구간에서 매칭된 행: {matched_count}건")
        cur = chunk_end + timedelta(days=1)
        time.sleep(1)

    # 같은 (date, cutKey) 중복이 있으면 마지막 값으로 덮어씀 (정정 반영)
    merged = {}
    for row in all_rows:
        key = (row[0], row[1])
        merged[key] = row
    final_rows = sorted(merged.values(), key=lambda r: (r[0], r[1]))

    output = {
        "collectedAt": datetime.now().astimezone().isoformat(),
        "source": "USDA AMS LMR Datamart - National Daily Pork FOB Plant, Negotiated Sales, Afternoon (LM_PK602 / slug 2498)",
        "cuts": {k: {"label_ko": v["label_ko"], "label_en": v["label_en"], "section": v["section"]} for k, v in CUTS.items()},
        "cols": ["date", "cutKey", "pounds", "priceLow", "priceHigh", "wtdAvgCwt"],
        "data": final_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"완료: 총 {len(final_rows)}행 저장 -> {OUTPUT_PATH}")
    if len(final_rows) == 0:
        print("::warning::수집된 행이 0건입니다. API 응답 구조가 예상과 다를 수 있습니다. 위 DEBUG 로그를 확인하세요.")


if __name__ == "__main__":
    main()
