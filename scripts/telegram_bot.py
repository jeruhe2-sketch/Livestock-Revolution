# -*- coding: utf-8 -*-
"""
텔레그램으로 "/기록" 명령을 보내면 GoatCounter 방문자 통계를 답장해주는 봇.
레이더/라이브러리 두 사이트를 한 번에 - 오늘/어제/7일/30일/누적 숫자,
7일 일별 추이, 유입경로까지 전부 한 메시지에 담아서 명령어 하나로 끝낸다.

완전한 실시간 서버가 없는 정적 사이트 구조라, cron-job.org가 이 워크플로우를
주기적으로(예: 10분마다) workflow_dispatch로 깨워서 새 텔레그램 메시지가
있는지 확인(getUpdates)하고, 명령어가 오면 그때 답장하는 폴링 방식이다.

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
# 등록된 사이트들 (표시 이름 -> GoatCounter 사이트 코드)
SITES = {
    "축산레이더": "livestock-radar",
    "축산라이브러리": "livestock-library",
}
KST = timezone(timedelta(hours=9))

# 이 문구들 중 하나로 (대소문자/양옆 공백 무시) 정확히 보내면 통계로 답장한다.
TRIGGER_COMMANDS = {"/기록", "기록", "/방문자", "방문자", "/visitors", "/stats", "/통계"}


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


def _api_get(api_key: str, goatcounter_code: str, path: str, params: dict) -> dict:
    query = urllib.parse.urlencode(params)
    url = f"https://{goatcounter_code}.goatcounter.com/api/v0/{path}?{query}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def stats_total(api_key: str, goatcounter_code: str, start: datetime, end: datetime) -> dict:
    """기간 내 방문자수(total) + 일자별 상세(stats)를 함께 반환."""
    return _api_get(
        api_key, goatcounter_code, "stats/total", {"start": _iso(start), "end": _iso(end)}
    )


def top_referrers(api_key: str, goatcounter_code: str, start: datetime, end: datetime, limit: int = 3) -> list:
    """기간 내 유입경로 상위 N개. [{name, count}, ...]"""
    data = _api_get(
        api_key,
        goatcounter_code,
        "stats/toprefs",
        {"start": _iso(start), "end": _iso(end), "limit": limit},
    )
    return data.get("stats", [])


def _pct_change(now: int, before: int) -> str:
    if before == 0:
        return "(신규)" if now > 0 else ""
    diff = (now - before) / before * 100
    arrow = "▲" if diff > 0 else ("▼" if diff < 0 else "-")
    return f"({arrow}{abs(diff):.0f}%)"


def build_site_section(api_key: str, goatcounter_code: str, site_label: str) -> str:
    """사이트 한 곳의 리포트 문단 (숫자 + 7일 추이 + 유입경로)."""
    now_kst = datetime.now(KST)
    today_start_utc = now_kst.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    yesterday_start_utc = today_start_utc - timedelta(days=1)
    now_utc = datetime.now(timezone.utc)
    week_start_utc = now_utc - timedelta(days=7)
    prev_week_start_utc = now_utc - timedelta(days=14)
    month_start_utc = now_utc - timedelta(days=30)
    all_start_utc = datetime(2020, 1, 1, tzinfo=timezone.utc)  # 서비스 시작 훨씬 이전

    today_n = stats_total(api_key, goatcounter_code, today_start_utc, now_utc).get("total", 0)
    yesterday_data = stats_total(api_key, goatcounter_code, yesterday_start_utc, today_start_utc)
    yesterday_n = yesterday_data.get("total", 0)
    week_data = stats_total(api_key, goatcounter_code, week_start_utc, now_utc)
    week_n = week_data.get("total", 0)
    prev_week_n = stats_total(api_key, goatcounter_code, prev_week_start_utc, week_start_utc).get("total", 0)
    month_n = stats_total(api_key, goatcounter_code, month_start_utc, now_utc).get("total", 0)
    total_n = stats_total(api_key, goatcounter_code, all_start_utc, now_utc).get("total", 0)

    # 최근 7일 일별 추이
    daily_lines = []
    for day_stat in week_data.get("stats", []):
        day = day_stat.get("day", "")
        count = day_stat.get("daily", 0)
        try:
            day_label = datetime.strptime(day, "%Y-%m-%d").strftime("%m/%d")
        except ValueError:
            day_label = day
        daily_lines.append(f"    {day_label}  {count:,}명")

    refs = top_referrers(api_key, goatcounter_code, week_start_utc, now_utc, limit=3)
    if refs:
        ref_text = ", ".join(f"{r.get('name') or '직접접속'} {r.get('count', 0)}명" for r in refs)
    else:
        ref_text = "직접 접속/북마크 위주"

    lines = [
        f"■ {site_label}",
        f"  오늘 {today_n:,}명 {_pct_change(today_n, yesterday_n)} · 어제 {yesterday_n:,}명",
        f"  7일 {week_n:,}명 {_pct_change(week_n, prev_week_n)} · 30일 {month_n:,}명 · 누적 {total_n:,}명",
        "  최근 7일 추이:",
    ]
    lines.extend(daily_lines)
    lines.append(f"  유입경로: {ref_text}")
    return "\n".join(lines)


def build_record_message(api_key: str) -> str:
    """등록된 모든 사이트를 한 메시지에 담는다 (명령어는 "/기록" 하나로 통일)."""
    lines = ["📊 방문자 기록", ""]
    for label, code in SITES.items():
        try:
            lines.append(build_site_section(api_key, code, label))
        except Exception as e:
            lines.append(f"■ {label}\n  ⚠️ 조회 실패: {e}")
        lines.append("")
    lines.append("※ 같은 사람이 짧은 시간 내 새로고침한 건 중복 집계 안 됨")
    return "\n".join(lines)


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
        # 그룹채팅에서는 텔레그램이 슬래시 명령에 "@봇이름"을 자동으로 붙여줌
        # (예: "/기록@livest123ock_bot") - 이걸 안 떼면 TRIGGER_COMMANDS와
        # 절대 정확히 일치하지 않아서 조용히 무시되던 버그.
        text_normalized = text.split("@")[0].strip() if text.startswith("/") else text
        msg_chat_id = str(msg.get("chat", {}).get("id", ""))

        # 등록된 채팅방(chat_id)에서 온 메시지만 처리 (다른 곳에서 봇을 추가해도 무시)
        if msg_chat_id != str(chat_id):
            continue

        if text_normalized.lower() in {c.lower() for c in TRIGGER_COMMANDS}:
            try:
                reply = build_record_message(api_key)
            except Exception as e:
                reply = f"⚠️ 방문자 기록을 가져오는 중 오류가 발생했습니다: {e}"
            _post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                {"chat_id": chat_id, "text": reply},
            )
            print("응답 전송 완료")
        elif text:
            # 매칭 안 된 메시지도 로그에 남겨서 "왜 답장 안 왔지" 디버깅 쉽게
            print(f"명령어 불일치, 무시함: {text!r} (정규화: {text_normalized!r})")

    save_state({"last_update_id": max_update_id})


if __name__ == "__main__":
    main()
