import json
import os
import urllib.request

bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
chat_id = os.environ["TELEGRAM_CHAT_ID"]

def get(url):
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

print("=== getMe (봇 자체가 살아있는지) ===")
try:
    me = get(f"https://api.telegram.org/bot{bot_token}/getMe")
    print(me)
except Exception as e:
    print("ERROR", repr(e))

print()
print("=== 현재 저장된 상태(offset) ===")
try:
    with open("data/telegram_bot_state.json", encoding="utf-8") as f:
        print(json.load(f))
except Exception as e:
    print("ERROR", repr(e))

print()
print("=== getUpdates (offset 없이 - 아무것도 소비 안 함, 큐에 남아있는 것만 확인) ===")
try:
    updates = get(f"https://api.telegram.org/bot{bot_token}/getUpdates?timeout=0")
    print("ok:", updates.get("ok"))
    results = updates.get("result", [])
    print("대기 중인 업데이트 개수:", len(results))
    for u in results:
        msg = u.get("message") or u.get("edited_message") or {}
        print("  update_id:", u.get("update_id"),
              "chat_id:", msg.get("chat", {}).get("id"),
              "text repr:", repr(msg.get("text")))
except Exception as e:
    print("ERROR", repr(e))

print()
print("등록된 CHAT_ID:", chat_id)
