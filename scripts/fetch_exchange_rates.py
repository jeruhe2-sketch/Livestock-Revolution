# -*- coding: utf-8 -*-
"""
USD/EUR/AUD/BRL 대 KRW 환율을 가져온다. (v3: 호주·브라질 추가 + 전주/전월/전년 자체 계산)

축산레이더가 다루는 4개 시장(미국/EU/호주/브라질)에 맞춰 4개 통화 전부 KRW 환산.

1순위: Yahoo Finance 비공식 chart API (query1.finance.yahoo.com, 인증키 불필요)
       - range=1y&interval=1d로 1년치 일별 종가까지 받아서 CME 선물 스크립트와
         동일한 방식으로 전일/전주/전월/전년대비를 직접 계산 (meta.previousClose는
         이전에 이상값을 준 사례가 있어 신뢰 안 하고 history 배열로만 비교).
2순위: Frankfurter(ECB 공식 고시환율, 인증키 불필요) - 야후 실패시 폴백.
       ECB는 과거 이력도 주지만(직전 실패 상황에서 속도가 중요해) 이번엔
       현재가만 받고 전일/전주/전월/전년은 비워둠(기존 값 유지 안 함).

산출: data/exchange_rates.json
  {
    usdKrw, usdKrwPrevClose, usdKrwDod, usdKrwWow, usdKrwMom, usdKrwYoy,
    eurKrw, eurKrwPrevClose, eurKrwDod, eurKrwWow, eurKrwMom, eurKrwYoy,
    audKrw, audKrwPrevClose, audKrwDod, audKrwWow, audKrwMom, audKrwYoy,
    brlKrw, brlKrwPrevClose, brlKrwDod, brlKrwWow, brlKrwMom, brlKrwYoy,
    marketTime, updatedAt, source
  }
  (기존 코드 호환을 위해 usdKrw/eurKrw/usdKrwPrevClose/eurKrwPrevClose 필드명은 그대로 유지)
"""
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

OUTPUT_PATH = "data/exchange_rates.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 8
YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

CURRENCIES = {
    "usd": ("KRW=X", "USD"),
    "eur": ("EURKRW=X", "EUR"),
    "aud": ("AUDKRW=X", "AUD"),
    "brl": ("BRLKRW=X", "BRL"),
}


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
                        history.append({"date": d, "close": round(float(c), 6)})
                    return {
                        "price": float(meta["regularMarketPrice"]),
                        "prevClose": float(meta.get("previousClose") or meta.get("chartPreviousClose")),
                        "marketTime": meta.get("regularMarketTime"),
                        "history": history,
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


def find_at_or_before(history, target_date_iso):
    best = None
    for row in history:
        if row["date"] <= target_date_iso and (best is None or row["date"] > best["date"]):
            best = row
    return best


def pct(a, b):
    return (a - b) / b * 100 if (a is not None and b) else None


def main():
    result = {}
    source = "Yahoo Finance (실시간 시장가, 비공식 API)"
    market_time = None
    yahoo_ok = True
    histories = {}  # 통화별 실제 이력 저장 (BRL 역산에 USD 이력을 재사용)

    for key, (symbol, ecb_base) in CURRENCIES.items():
        try:
            data = fetch_yahoo(symbol)
        except Exception as e:
            print(f"야후 실패({key}), ECB 폴백으로 전환: {e!r}", file=sys.stderr)
            yahoo_ok = False
            price = fetch_ecb_fallback(ecb_base)
            result[f"{key}Krw"] = price
            result[f"{key}KrwPrevClose"] = None
            result[f"{key}KrwDod"] = None
            result[f"{key}KrwWow"] = None
            result[f"{key}KrwMom"] = None
            result[f"{key}KrwYoy"] = None
            continue

        history = data["history"]
        histories[key] = history
        latest_date = history[-1]["date"] if history else None
        dod_pool = history[:-1] if history else []
        anchor = latest_date

        def ref(days, pool=dod_pool, anchor_date=anchor):
            return find_at_or_before(pool, (date.fromisoformat(anchor_date) - timedelta(days=days)).isoformat()) if anchor_date else None

        dod_ref, wow_ref, mom_ref, yoy_ref = ref(1), ref(7), ref(30), ref(365)
        price = data["price"]
        result[f"{key}Krw"] = price
        result[f"{key}KrwPrevClose"] = data["prevClose"]
        result[f"{key}KrwDod"] = pct(price, dod_ref["close"]) if dod_ref else None
        result[f"{key}KrwWow"] = pct(price, wow_ref["close"]) if wow_ref else None
        result[f"{key}KrwMom"] = pct(price, mom_ref["close"]) if mom_ref else None
        result[f"{key}KrwYoy"] = pct(price, yoy_ref["close"]) if yoy_ref else None
        if data.get("marketTime"):
            market_time = data["marketTime"]
        print(f"  {key.upper()}/KRW: {price} (전일 {result[f'{key}KrwDod']}, 전주 {result[f'{key}KrwWow']}, 전월 {result[f'{key}KrwMom']}, 전년 {result[f'{key}KrwYoy']})")
        time.sleep(0.3)

    # BRLKRW=X는 야후가 이력을 거의 안 줘서(당일 1건뿐) 전주/전월/전년이 전부 비어있었음.
    # USDBRL=X(유동성 높은 페어라 이력 풍부)와 이미 받아둔 USD/KRW 이력을 나눠서
    # "USD/KRW ÷ USD/BRL = BRL/KRW" 역산 이력을 합성함. 현재가(brlKrw)는 그대로 유지하고
    # 비교용 과거값만 이 방식으로 보강.
    if histories.get("brl", []).__len__() < 5 and histories.get("usd") and result.get("brlKrw") is not None:
        try:
            usdbrl = fetch_yahoo("USDBRL=X")
            usdbrl_hist = {r["date"]: r["close"] for r in usdbrl["history"]}
            usd_hist = {r["date"]: r["close"] for r in histories["usd"]}
            synth = []
            for d_, usdbrl_close in usdbrl_hist.items():
                usd_close = usd_hist.get(d_)
                if usd_close and usdbrl_close:
                    synth.append({"date": d_, "close": usd_close / usdbrl_close})
            synth.sort(key=lambda r: r["date"])
            if synth:
                brl_price = result["brlKrw"]
                anchor = synth[-1]["date"]
                pool = synth[:-1]

                def bref(days):
                    return find_at_or_before(pool, (date.fromisoformat(anchor) - timedelta(days=days)).isoformat())

                result["brlKrwWow"] = pct(brl_price, bref(7)["close"]) if bref(7) else None
                result["brlKrwMom"] = pct(brl_price, bref(30)["close"]) if bref(30) else None
                result["brlKrwYoy"] = pct(brl_price, bref(365)["close"]) if bref(365) else None
                result["brlKrwDod"] = pct(brl_price, bref(1)["close"]) if bref(1) else None
                print(f"  BRL/KRW 이력 역산 완료({len(synth)}건, USD/KRW ÷ USD/BRL): 전주 {result['brlKrwWow']}, 전월 {result['brlKrwMom']}, 전년 {result['brlKrwYoy']}")
        except Exception as e:
            print(f"BRL 역산 실패(그냥 전일/전주/전월/전년 비움): {e!r}", file=sys.stderr)

    if not yahoo_ok:
        source = "European Central Bank (via frankfurter.dev) - 야후 일부 실패로 폴백"

    result["marketTime"] = datetime.fromtimestamp(market_time, tz=timezone.utc).isoformat() if market_time else None
    result["updatedAt"] = datetime.now(timezone.utc).isoformat()
    result["source"] = source

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
