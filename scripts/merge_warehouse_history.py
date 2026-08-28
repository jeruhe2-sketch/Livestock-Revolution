# -*- coding: utf-8 -*-
"""data/warehouse_history.json은 매 실행마다 통째로 다시 쓰는 스냅샷 파일이라,
여러 워크플로우가 같은 main 브랜치에 자주 커밋하면서 push 충돌 -> 재시도가
잦으면 다른 실행이 이미 추가해둔 다른 날짜의 기록을 실수로 덮어써 버릴 수 있다.

이 스크립트는 커밋 재시도 직전마다(=origin을 새로 fetch한 직후) 호출해서,
"origin의 최신 history.json" 위에 "이번 실행에서 계산한 오늘 레코드"만
다시 병합해 넣는다. 이렇게 하면 재시도를 몇 번을 해도 다른 날짜 데이터가
절대 사라지지 않는다.

사용법: python scripts/merge_warehouse_history.py
  - debug/history_today_rows.json (이번 실행이 계산한 오늘 레코드)을 읽어서
  - data/warehouse_history.json (git reset 직후 = origin의 최신 상태)에 병합
"""
import json
import os
import sys

HISTORY_PATH = "data/warehouse_history.json"
TODAY_ROWS_PATH = "debug/history_today_rows.json"


def main():
    if not os.path.exists(TODAY_ROWS_PATH):
        print("오늘 레코드 파일이 없어 병합할 게 없습니다 (스킵).")
        return

    with open(TODAY_ROWS_PATH, encoding="utf-8") as f:
        today_data = json.load(f)
    today = today_data["날짜"]
    today_records = today_data["레코드"]

    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, encoding="utf-8") as f:
            history = json.load(f)
    else:
        history = {"기록": []}

    before_dates = sorted({h.get("날짜") for h in history.get("기록", [])})
    history["기록"] = [h for h in history.get("기록", []) if h.get("날짜") != today]
    history["기록"].extend(today_records)

    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

    after_dates = sorted({h.get("날짜") for h in history.get("기록", [])})
    print(f"병합 완료: 오늘({today}) {len(today_records)}건 적용. 날짜 {before_dates} -> {after_dates}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
