# -*- coding: utf-8 -*-
"""
CME 축산 선물(Live Cattle, Feeder Cattle, Lean Hog) 최근월물 시세를 가져온다.
Yahoo Finance 비공식 chart API 사용 (query1.finance.yahoo.com, 인증키 불필요).
환율(fetch_exchange_rates.py)과 같은 방식/같은 API. 공식 파트너십 아니라
예고 없이 막힐 수 있음 - 이 경우 이전 파일 값을 그대로 유지(폴백 없음, 그냥 스킵).

산출: data/cme_futures.json
  {
    liveCattle: {price, prevClose, contract}, feederCattle: {...}, leanHog: {...},
    marketTime, updatedAt, source
  }
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

OUTPUT_PATH = "data/cme_futures.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 8
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

SYMBOLS = {
    "liveCattle": "LE=F",
    "feederCattle": "GF=F",
    "leanHog": "HE=F",
}


def fetch_one(symbol: str):
    last_err = None
    for host in HOSTS:
        url = f"https://{host}/v8/finance/chart/{symbol}"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=15)
                if r.status_code == 200:
                    meta = r.json()["chart"]["result"][0]["meta"]
                    return {
                        "price": float(meta["regularMarketPrice"]),
                        "prevClose": float(meta.get("previousClose") or meta.get("chartPreviousClose")),
                        "contract": meta.get("shortName"),
                        "marketTime": meta.get("regularMarketTime"),
                    }
                last_err = f"status={r.status_code} body={r.text[:200]}"
            except Exception as e:
                last_err = f"exception: {e!r}"
            print(f"  [{symbol}@{host}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"{symbol} 최종 실패: {last_err}")


def main():
    result = {}
    market_time = None
    for key, symbol in SYMBOLS.items():
        data = fetch_one(symbol)
        result[key] = {"price": data["price"], "prevClose": data["prevClose"], "contract": data["contract"]}
        if data.get("marketTime"):
            market_time = data["marketTime"]
        print(f"  {key} ({symbol}): {data['price']} (전일종가 {data['prevClose']}, {data['contract']})")

    result["marketTime"] = datetime.fromtimestamp(market_time, tz=timezone.utc).isoformat() if market_time else None
    result["updatedAt"] = datetime.now(timezone.utc).isoformat()
    result["source"] = "CME via Yahoo Finance (지연 시세, 비공식 API)"

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {result}")


if __name__ == "__main__":
    main()
