# -*- coding: utf-8 -*-
"""
Frankfurter API(유럽중앙은행 ECB 공식 환율, 인증키 불필요)로 USD/KRW, EUR/KRW 환율을 가져온다.
산출: data/exchange_rates.json
  { "usdKrw": 1380.5, "eurKrw": 1490.2, "updatedAt": "...", "source": "ECB via frankfurter.dev" }

index.html의 EU/USDA 탭에서 이 파일을 읽어서 유로/달러 금액을 원화로 환산 표시하는 데 쓴다.
"""
import json
import sys
import time
from datetime import datetime, timezone

import requests

BASE = "https://api.frankfurter.dev/v1/latest"
OUTPUT_PATH = "data/exchange_rates.json"
MAX_RETRIES = 5
RETRY_BACKOFF_SEC = 10


def fetch_rate(base_currency: str) -> float:
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(BASE, params={"base": base_currency, "symbols": "KRW"}, timeout=20)
            if r.status_code == 200:
                data = r.json()
                rate = data["rates"]["KRW"]
                print(f"  {base_currency}/KRW = {rate} (기준일 {data.get('date')})")
                return float(rate)
            last_err = f"status={r.status_code} body={r.text[:200]}"
        except Exception as e:
            last_err = f"exception: {e!r}"
        print(f"  [{base_currency}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
        time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"{base_currency}/KRW 환율 조회 최종 실패: {last_err}")


def main():
    usd_krw = fetch_rate("USD")
    eur_krw = fetch_rate("EUR")

    output = {
        "usdKrw": usd_krw,
        "eurKrw": eur_krw,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "European Central Bank (via frankfurter.dev)",
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"완료: {output}")


if __name__ == "__main__":
    main()
