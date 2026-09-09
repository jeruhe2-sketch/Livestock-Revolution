# -*- coding: utf-8 -*-
"""
대한제당(KRX 001790) 주가를 가져온다.
환율 스크립트(fetch_exchange_rates.py)와 동일한 방식: Yahoo Finance 비공식
chart API(query1/2.finance.yahoo.com, 인증키 불필요)에서 1년치 일별 종가를
받아 전일/전주/전월/전년대비를 자체 계산한다. 티커는 "001790.KS"
(KRX 코스피 상장종목의 야후 파이낸스 표기).

산출: data/daehan_jetang_stock.json
  { price, prevClose, dod, wow, mom, yoy, marketTime, updatedAt, source }
"""
import sys
import time
import json
from datetime import date, datetime, timedelta, timezone

import requests

OUTPUT_PATH = "data/daehan_jetang_stock.json"
SYMBOL = "001790.KS"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 8
YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def fetch_yahoo(symbol: str):
    last_err = None
    for host in YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{symbol}"
        params = {"range": "1y", "interval": "1d"}
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=15)
                if r.status_code == 200:
                    result = r.json()["chart"]["result"][0]
                    meta = result["meta"]
                    timestamps = result.get("timestamp") or []
                    closes = result["indicators"]["quote"][0].get("close") or []
                    history = []
                    for ts, c in zip(timestamps, closes):
                        if c is None:
                            continue
                        d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
                        history.append({"date": d, "close": round(float(c), 2)})
                    return {
                        "price": float(meta["regularMarketPrice"]),
                        "prevClose": float(meta.get("previousClose") or meta.get("chartPreviousClose")),
                        "marketTime": meta.get("regularMarketTime"),
                        "currency": meta.get("currency"),
                        "history": history,
                    }
                last_err = f"status={r.status_code} body={r.text[:200]}"
            except Exception as e:
                last_err = f"exception: {e!r}"
            print(f"  [yahoo {symbol}@{host}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"Yahoo {symbol} 최종 실패: {last_err}")


def find_at_or_before(history, target_date_iso):
    best = None
    for row in history:
        if row["date"] <= target_date_iso and (best is None or row["date"] > best["date"]):
            best = row
    return best


def pct(a, b):
    return (a - b) / b * 100 if (a is not None and b) else None


def main():
    data = fetch_yahoo(SYMBOL)
    history = data["history"]
    latest_date = history[-1]["date"] if history else None
    dod_pool = history[:-1] if history else []

    def ref(days):
        if not latest_date:
            return None
        return find_at_or_before(dod_pool, (date.fromisoformat(latest_date) - timedelta(days=days)).isoformat())

    dod_ref, wow_ref, mom_ref, yoy_ref = ref(1), ref(7), ref(30), ref(365)
    price = data["price"]

    result = {
        "name": "대한제당",
        "symbol": SYMBOL,
        "price": price,
        "prevClose": data["prevClose"],
        "currency": data.get("currency") or "KRW",
        "dod": pct(price, dod_ref["close"]) if dod_ref else None,
        "wow": pct(price, wow_ref["close"]) if wow_ref else None,
        "mom": pct(price, mom_ref["close"]) if mom_ref else None,
        "yoy": pct(price, yoy_ref["close"]) if yoy_ref else None,
        "marketTime": data.get("marketTime"),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance (실시간 시장가, 비공식 API)",
    }
    print(f"  대한제당(001790): {price}원 (전일 {result['dod']}, 전주 {result['wow']}, 전월 {result['mom']}, 전년 {result['yoy']})")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: {OUTPUT_PATH} 저장")


if __name__ == "__main__":
    main()
