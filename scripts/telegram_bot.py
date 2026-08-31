# -*- coding: utf-8 -*-
"""
텔레그램으로 "/방문자" 명령을 보내면 GoatCounter 방문자 통계를 답장해주는 봇.

완전한 실시간 서버가 없는 정적 사이트 구조라, cron-job.org가 이 워크플로우를
주기적으로(예: 5~10분마다) workflow_dispatch로 깨워서 새 텔레그램 메시지가
있는지 확인(getUpdates)하고, 명령어가 오면 그때 답장하는 폴링 방식이다.
(다른 워크플로우들이 create/update용 API를 주기 호출하는 것과 동일한 패턴)

처리한 메시지는 offset(=update_id)을 data/telegram_bot_state.json에 저장해서
다음 실행 때 같은 메시지를 중복 처리하지 않는다.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

STATE_PATH = "data/telegram_bot_state.json"
GOATCOUNTER_CODE = "livestock-radar"
KST = timezone(timedelta(hours=9))

# 이 문구들 중 하나로 (대소문자/양옆 공백 무시) 정확히 보내면 통계로 답장한다.
TRIGGER_COMMANDS = {"/방문자", "방문자", "/visitors", "/stats", "/통계"}


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_state() -> dict:
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"last_update_id": 0}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def goatcounter_visitors(api_key: str, start: datetime, end: datetime) -> int:
    """주어진 기간(UTC)의 순 방문자 수(중복 새로고침 제외)를 반환."""
    url = (
        f"https://{GOATCOUNTER_CODE}.goatcounter.com/api/v0/stats/total"
        f"?start={start.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        f"&end={end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("total", 0)


def build_stats_message(api_key: str) -> str:
    now_kst = datetime.now(KST)
    today_start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_kst.astimezone(timezone.utc)
    now_utc = datetime.now(timezone.utc)
    week_start_utc = now_utc - timedelta(days=7)
    all_start_utc = datetime(2020, 1, 1, tzinfo=timezone.utc)  # 서비스 시작 훨씬 이전

    today = goatcounter_visitors(api_key, today_start_utc, now_utc)
    week = goatcounter_visitors(api_key, week_start_utc, now_utc)
    total = goatcounter_visitors(api_key, all_start_utc, now_utc)

    return (
        "📊 축산레이더 방문자 현황\n"
        f"오늘: {today:,}명\n"
        f"최근 7일: {week:,}명\n"
        f"전체 누적: {total:,}명\n"
        f"(같은 사람이 짧은 시간 내 새로고침한 건 중복 집계 안 됨)"
    )


def main() -> None:
    bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    api_key = os.environ["GOATCOUNTER_API_KEY"]

    state = load_state()
    offset = state.get("last_update_id", 0) + 1

    updates_url = (
        f"https://api.telegram.org/bot{bot_token}/getUpdates"
        f"?offset={offset}&timeout=0"
    )
    updates = _get(updates_url)
    if not updates.get("ok"):
        print("getUpdates 실패:", updates)
        sys.exit(1)

    results = updates.get("result", [])
    if not results:
        print("새 메시지 없음")
        return

    max_update_id = state.get("last_update_id", 0)
    for upd in results:
        max_update_id = max(max_update_id, upd["update_id"])
        msg = upd.get("message") or upd.get("edited_message")
        if not msg:
            continue

        text = (msg.get("text") or "").strip()
        msg_chat_id = str(msg.get("chat", {}).get("id", ""))

        # 등록된 채팅방(chat_id)에서 온 메시지만 처리 (다른 곳에서 봇을 추가해도 무시)
        if msg_chat_id != str(chat_id):
            continue

        if text.lower() in {c.lower() for c in TRIGGER_COMMANDS}:
            try:
                reply = build_stats_message(api_key)
            except Exception as e:
                reply = f"⚠️ 방문자 통계를 가져오는 중 오류가 발생했습니다: {e}"
            _post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                {"chat_id": chat_id, "text": reply},
            )
            print("응답 전송 완료")

    save_state({"last_update_id": max_update_id})


if __name__ == "__main__":
    main()
