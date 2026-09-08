# -*- coding: utf-8 -*-
"""
CME 축산 선물(Live Cattle, Feeder Cattle, Lean Hog) 최근월물 시세 + 1년치 일별 종가.
Yahoo Finance 비공식 chart API 사용 (query1.finance.yahoo.com, 인증키 불필요).
환율(fetch_exchange_rates.py)과 같은 방식/같은 API.

v1에서는 현재가 스냅샷만 받아서 전일대비만 됐는데, range=1y&interval=1d로
1년치 일별 종가를 통째로 받아오면 전주/전년대비도 로컬에서 계산 가능해서 전환함.

산출: data/cme_futures.json
  {
    liveCattle: {price, prevClose, contract, dod, wow, yoy, history: [{date, close}, ...]},
    feederCattle: {...}, leanHog: {...},
    marketTime, updatedAt, source
  }
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

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
        params = {"range": "1y", "interval": "1d"}
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=20)
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
                        history.append({"date": d, "close": round(float(c), 4)})
                    return {
                        "price": float(meta["regularMarketPrice"]),
                        "prevClose": float(meta.get("previousClose") or meta.get("chartPreviousClose")),
                        "contract": meta.get("shortName"),
                        "marketTime": meta.get("regularMarketTime"),
                        "history": history,
                    }
                last_err = f"status={r.status_code} body={r.text[:200]}"
            except Exception as e:
                last_err = f"exception: {e!r}"
            print(f"  [{symbol}@{host}] 시도 {attempt}/{MAX_RETRIES} 실패: {last_err}", file=sys.stderr)
            time.sleep(RETRY_BACKOFF_SEC)
    raise RuntimeError(f"{symbol} 최종 실패: {last_err}")


def find_at_or_before(history, target_date_iso):
    """target 이하 날짜 중 가장 최근 종가 (주말/휴장일 있어도 안전하게 직전 거래일 값)."""
    best = None
    for row in history:
        if row["date"] <= target_date_iso and (best is None or row["date"] > best["date"]):
            best = row
    return best


def pct(a, b):
    return (a - b) / b * 100 if (a is not None and b) else None


def main():
    result = {}
    market_time = None
    for key, symbol in SYMBOLS.items():
        data = fetch_one(symbol)
        history = data["history"]
        # meta.previousClose가 이 상품(연속선물 티커)에서는 신뢰할 수 없는 걸 확인함
        # (실제로는 212~215대인데 235.8 같은 완전히 다른 값을 준 사례 있음).
        # 그래서 전일/전주/전년 전부 우리가 받은 history 배열 안에서만 비교함.
        market_date = (
            datetime.fromtimestamp(data["marketTime"], tz=timezone.utc).date().isoformat()
            if data.get("marketTime") else None
        )
        latest_hist_date = history[-1]["date"] if history else None
        # price(실시간 시세)의 날짜가 history 마지막 봉과 같은 날이면 그 봉은 "오늘"이니
        # 전일 비교 기준에서 제외하고 그 이전 봉과 비교. 다르면(즉 history가 며칠 밀려
        # 있으면) history 마지막 봉 자체를 "전일"로 씀.
        if market_date and latest_hist_date and market_date == latest_hist_date:
            dod_pool = history[:-1]
        else:
            dod_pool = history
        dod_ref = dod_pool[-1] if dod_pool else None

        anchor_date = market_date or latest_hist_date
        wow_ref = find_at_or_before(dod_pool, (date.fromisoformat(anchor_date) - timedelta(days=7)).isoformat()) if anchor_date else None
        yoy_ref = find_at_or_before(dod_pool, (date.fromisoformat(anchor_date) - timedelta(days=365)).isoformat()) if anchor_date else None

        result[key] = {
            "price": data["price"],
            "contract": data["contract"],
            "dod": pct(data["price"], dod_ref["close"]) if dod_ref else None,
            "wow": pct(data["price"], wow_ref["close"]) if wow_ref else None,
            "yoy": pct(data["price"], yoy_ref["close"]) if yoy_ref else None,
            "latestHistoryDate": latest_hist_date,
            "isStale": bool(market_date and latest_hist_date and market_date != latest_hist_date and (date.fromisoformat(market_date) - date.fromisoformat(latest_hist_date)).days > 4),
        }
        if data.get("marketTime"):
            market_time = data["marketTime"]
        print(f"  {key} ({symbol}): {data['price']} (전일 {result[key]['dod']}, 전주 {result[key]['wow']}, 전년 {result[key]['yoy']}) 이력 {len(history)}건, 최신봉 {latest_hist_date}")
        time.sleep(0.5)

    result["marketTime"] = datetime.fromtimestamp(market_time, tz=timezone.utc).isoformat() if market_time else None
    result["updatedAt"] = datetime.now(timezone.utc).isoformat()
    result["source"] = "CME via Yahoo Finance (지연 시세, 비공식 API)"

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    print(f"저장 완료: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
