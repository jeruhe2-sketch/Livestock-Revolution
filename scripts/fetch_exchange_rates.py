# -*- coding: utf-8 -*-
"""
USD/KRW, EUR/KRW 환율을 가져온다. (v2: 실시간 시장가로 전환)

1순위: Yahoo Finance 비공식 chart API (query1.finance.yahoo.com, 인증키 불필요)
       - 실제 시장에서 거래되는 실시간(1분 단위) 시세. ECB 고시환율(하루 1회)보다
         실제 거래 가능 환율에 훨씬 가까움.
       - 공식 파트너십이 아닌 비공식 엔드포인트라 예고 없이 막힐 수 있어서,
         실패하면 2순위로 자동 폴백.
2순위: Frankfurter(ECB 공식 고시환율, 인증키 불필요) - 예전 방식, 안정성 높음.

산출: data/exchange_rates.json
  {
    usdKrw, eurKrw, usdKrwPrevClose, eurKrwPrevClose,
    marketTime (야후 기준 시세 시각, ISO), updatedAt (수집 시각),
    source, sourceDetail
  }
index.html의 EU/USDA 탭, 주요지표 배너에서 이 파일을 읽어서 원화 환산에 씀.
"""
import json
import sys
import time
from datetime import datetime, timezone

import requests

OUTPUT_PATH = "data/exchange_rates.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 8

YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
YAHOO_SYMBOLS = {"usdKrw": "KRW=X", "eurKrw": "EURKRW=X"}


def fetch_yahoo(symbol: str):
    last_err = None
    for host in YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{symbol}"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=15)
                if r.status_code == 200:
                    meta = r.json()["chart"]["result"][0]["meta"]
                    return {
                        "price": float(meta["regularMarketPrice"]),
                        "prevClose": float(meta.get("previousClose") or meta.get("chartPreviousClose")),
                        "marketTime": meta.get("regularMarketTime"),
                    }
                last_err = f"status={r.status_code} body={r.text[:200]}"
            except Exception as e:
                last_err = f"exception: {e!r}"
            print(f"  [yahoo {symbol}@{host}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"Yahoo {symbol} 최종 실패: {last_err}")


def fetch_ecb_fallback(base_currency: str) -> float:
    r = requests.get("https://api.frankfurter.dev/v1/latest", params={"base": base_currency, "symbols": "KRW"}, timeout=20)
    r.raise_for_status()
    return float(r.json()["rates"]["KRW"])


def main():
    result = {}
    source = "Yahoo Finance (실시간 시장가, 비공식 API)"
    try:
        usd = fetch_yahoo(YAHOO_SYMBOLS["usdKrw"])
        eur = fetch_yahoo(YAHOO_SYMBOLS["eurKrw"])
        result = {
            "usdKrw": usd["price"], "usdKrwPrevClose": usd["prevClose"],
            "eurKrw": eur["price"], "eurKrwPrevClose": eur["prevClose"],
            "marketTime": datetime.fromtimestamp(usd["marketTime"], tz=timezone.utc).isoformat() if usd.get("marketTime") else None,
        }
        print(f"완료(야후): USD/KRW={usd['price']}, EUR/KRW={eur['price']}")
    except Exception as e:
        print(f"야후 실패, ECB 폴백으로 전환: {e!r}", file=sys.stderr)
        source = "European Central Bank (via frankfurter.dev) - 야후 실패로 폴백"
        result = {
            "usdKrw": fetch_ecb_fallback("USD"), "usdKrwPrevClose": None,
            "eurKrw": fetch_ecb_fallback("EUR"), "eurKrwPrevClose": None,
            "marketTime": None,
        }
        print(f"완료(ECB 폴백): {result}")

    result["updatedAt"] = datetime.now(timezone.utc).isoformat()
    result["source"] = source

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {result}")


if __name__ == "__main__":
    main()
