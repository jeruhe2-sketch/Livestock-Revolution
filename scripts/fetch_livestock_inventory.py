# -*- coding: utf-8 -*-
"""
국내 축산물 재고동향(소/돼지 부위별 냉동·냉장 재고 추정치) - 축산물품질평가원(KAPE) 공식 API.
data.go.kr에 등록된 "축산물품질평가원_축산물유통정보" 중 "축산물 재고동향" 서비스.

조사업체 표본 기준 추정치이며, 실제 집계 시차가 2~3개월 정도 있음(예: 9월에 6월치가 최신).
매달 새 자료가 갱신되므로, 최근 N개월치를 매번 다시 받아 history를 갱신하는 방식으로 동작
(중간에 수정 발표되는 경우가 있어 캐시 누적이 아니라 매번 재수집).

산출: data/livestock_inventory.json
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

SERVICE_KEY = os.environ.get("KAPE_SERVICE_KEY")  # 디코딩 키 그대로 사용 (아래서 직접 인코딩)
ENDPOINT = "http://data.ekape.or.kr/openapi-data/service/user/grade/LPStock"
OUTPUT_PATH = "data/livestock_inventory.json"

SPECIES = {"4301": "소", "4304": "돼지"}
MONTHS_BACK = 100  # 최초 시딩(파일 없을 때)용 - 이 경우에만 전체 수집
RECENT_MONTHS = 3  # 파일이 이미 있으면 최근 3개월만 재수집(과거분은 그대로 유지)

PART_LABELS_COW = {
    "livestockPart_1": "안심", "livestockPart_2": "등심", "livestockPart_3": "채끝",
    "livestockPart_4": "목심", "livestockPart_5": "앞다리", "livestockPart_6": "우둔",
    "livestockPart_7": "설도", "livestockPart_8": "사태", "livestockPart_9": "갈비",
    "livestockPart_10": "양지", "livestockPart_11": "특수부위", "livestockPart_12": "잡육",
}
PART_LABELS_PIG = {
    "livestockPart_1": "안심", "livestockPart_2": "등심", "livestockPart_3": "전지",
    "livestockPart_4": "후지", "livestockPart_5": "삼겹살", "livestockPart_6": "목심",
    "livestockPart_7": "갈비", "livestockPart_8": "특수부위", "livestockPart_9": "잡육",
}


def fetch_month(yyyy: str, mm: str, judge_kind: str):
    if not SERVICE_KEY:
        print("ERROR: KAPE_SERVICE_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)
    params = {
        "serviceKey": SERVICE_KEY,
        "standYyyy": yyyy,
        "standMm": mm,
        "judgeKind": judge_kind,
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")

    root = ET.fromstring(raw)
    result_code = root.findtext(".//resultCode")
    if result_code != "00":
        return None  # 정상이 아니면(해당 월 자료 없음 등) 스킵

    item = root.find(".//item")
    if item is None:
        return None

    parts = {}
    for child in item:
        if child.tag.startswith("livestockPart_"):
            parts[child.tag] = float(child.text) if child.text else None

    return {
        "totStock": float(item.findtext("totStock")) if item.findtext("totStock") else None,
        "unit": item.findtext("unit"),
        "parts": parts,
    }


def month_iter_back(n_months: int):
    today = date.today()
    y, m = today.year, today.month
    for _ in range(n_months):
        yield f"{y:04d}", f"{m:02d}"
        m -= 1
        if m == 0:
            m = 12
            y -= 1


def main():
    existing = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f).get("species", {})
        except Exception:
            existing = {}

    result = {"species": {}}
    for judge_kind, species_name in SPECIES.items():
        labels = PART_LABELS_COW if judge_kind == "4301" else PART_LABELS_PIG
        prev_history = existing.get(species_name, {}).get("history", [])
        months_back = RECENT_MONTHS if prev_history else MONTHS_BACK

        new_history = {}
        for yyyy, mm in month_iter_back(months_back):
            data = fetch_month(yyyy, mm, judge_kind)
            time.sleep(0.3)
            if data is None:
                continue
            ym = f"{yyyy}-{mm}"
            new_history[ym] = {
                "yearMonth": ym,
                "totStock": data["totStock"],
                "unit": data["unit"],
                "parts": {labels.get(k, k): v for k, v in data["parts"].items()},
            }

        merged = {h["yearMonth"]: h for h in prev_history}
        merged.update(new_history)  # 최근 개월은 새 값으로 덮어씀 (수정발표 대응)
        history = sorted(merged.values(), key=lambda r: r["yearMonth"])

        result["species"][species_name] = {"judgeKind": judge_kind, "history": history}
        print(f"  {species_name}: 이번에 {len(new_history)}개월 갱신, 누적 {len(history)}개월 (최신: {history[-1]['yearMonth'] if history else '없음'})")

    result["source"] = "축산물품질평가원(KAPE) 축산물유통정보 - 조사업체 표본 기준 추정치"
    result["updatedAt"] = date.today().isoformat()

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    print(f"저장 완료: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
