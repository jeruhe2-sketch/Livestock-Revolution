# -*- coding: utf-8 -*-
"""EU 돈육 수출현황(data/eu_pigmeat_trade.json)의 각 (연도,ISO주차)마다 그 시점의
실제 EUR/USD, EUR/KRW 환율을 붙여서 data/fx_history.json으로 저장한다.

기존 exchange_rates.json은 "오늘" 환율 하나만 담고 있어서, EU 화면에서 과거 여러 주의
유로 금액을 합산한 뒤 그 총액에 오늘 환율 하나를 곱하는 방식(부정확)으로 쓰이고 있었다.
이 스크립트는 각 주(월요일 기준일)의 실제 ECB 환율을 프랑크푸르터(frankfurter.dev, ECB
공식 데이터, 인증키 불필요) 시계열 API로 받아와서, 주 단위로 정확하게 환산할 수 있게 한다.

산출 스키마:
{
  "base": "EUR",
  "updatedAt": "...",
  "source": "European Central Bank (via frankfurter.dev)",
  "weekly": { "2024-W01": {"date": "2024-01-01", "usd": 1.10, "krw": 1450.2}, ... }
}

ISO 주차의 월요일이 은행 휴일이라 환율이 없으면, 그 주 안에서 실제 값이 있는 날짜로
보정(가까운 날짜 우선)한다.
"""
import datetime as dt
import json
import os
import sys
import time

import requests

TS_URL = "https://api.frankfurter.dev/v1/{start}..{end}"
OUT_PATH = "data/fx_history.json"
EU_DATA_PATH = "data/eu_pigmeat_trade.json"
MAX_RETRIES = 5
RETRY_BACKOFF_SEC = 10


def iso_monday(year: int, week: int) -> dt.date:
    return dt.date.fromisocalendar(year, week, 1)


def weeks_needed():
    with open(EU_DATA_PATH, encoding="utf-8") as f:
        db = json.load(f)
    pairs = sorted({(int(r[0]), int(r[1])) for r in db["data"]})
    return pairs


def fetch_timeseries(start: dt.date, end: dt.date) -> dict:
    url = TS_URL.format(start=start.isoformat(), end=end.isoformat())
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, params={"base": "EUR", "symbols": "USD,KRW"}, timeout=30)
            if r.status_code == 200:
                data = r.json()
                rates = data.get("rates", {})
                print(f"  받은 일자수: {len(rates)} ({start} ~ {end})")
                return rates  # {"2024-01-02": {"USD":.., "KRW":..}, ...}
            last_err = f"status={r.status_code} body={r.text[:200]}"
        except Exception as e:
            last_err = f"exception: {e!r}"
        print(f"  시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"시계열 환율 조회 최종 실패: {last_err}")


def nearest_rate(rates: dict, target: dt.date, max_span_days: int = 7):
    for delta in range(0, max_span_days + 1):
        for d in (target - dt.timedelta(days=delta), target + dt.timedelta(days=delta)):
            key = d.isoformat()
            if key in rates:
                return d.isoformat(), rates[key]
    return None, None


def main():
    pairs = weeks_needed()
    if not pairs:
        raise RuntimeError("EU 데이터에서 (연도,주차) 목록을 찾지 못함")
    mondays = [iso_monday(y, w) for y, w in pairs]
    start, end = min(mondays), min(max(mondays), dt.date.today())
    print(f"필요 주차: {len(pairs)}개, 조회 기간: {start} ~ {end}")

    rates = fetch_timeseries(start, end)

    weekly = {}
    missing = 0
    for (y, w), monday in zip(pairs, mondays):
        key = f"{y}-W{w:02d}"
        used_date, rate = nearest_rate(rates, monday)
        if rate is None:
            missing += 1
            continue
        weekly[key] = {"date": used_date, "usd": rate["USD"], "krw": rate["KRW"]}
    if missing:
        print(f"::warning::환율을 못 찾은 주차 {missing}건 (휴일 보정 범위를 벗어남)")

    out = {
        "base": "EUR",
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "European Central Bank (via frankfurter.dev)",
        "weekly": weekly,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: {len(weekly)}개 주차 저장 ({OUT_PATH})")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
