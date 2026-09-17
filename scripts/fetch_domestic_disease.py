# -*- coding: utf-8 -*-
"""
국내 가축전염병(ASF/AI 등) 발생현황 수집 - 농림축산검역본부 자체 Open API.

⚠️ 표준 data.go.kr 서비스키 방식이 아니라, 이 기관 자체 포털의 API 형식임
   (요청주소에 API_KEY가 경로 파라미터로 들어감).
⚠️ 현재 환경에서 7080 포트가 막혀 있어 실제 응답을 확인하지 못한 상태 -
   API_KEY 발급받은 후 실제로 돌려보고 파싱 부분(parse_rows) 보정 필요.

요청 URL 패턴:
  http://211.237.50.150:7080/openapi/{API_KEY}/{TYPE}/{API_URL}/{START_INDEX}/{END_INDEX}
  - API_KEY: 발급받은 키 (테스트는 'sample')
  - TYPE: xml 또는 json
  - API_URL: Grid_20151204000000000316_1 (이 데이터셋 고정 식별자)
  - START_INDEX/END_INDEX: 페이징

선택 필터 파라미터(쿼리스트링으로 추가 가능, 스펙상 확실친 않아 TODO 표시):
  ICTSD_OCCRRNC_NO(전염병발생번호), LKNTS_NM(가축전염병명), OCCRRNC_DE(발생일자),
  DGNSS_ENGN_CODE/NM(진단기관)

응답 필드:
  ICTSD_OCCRRNC_NO, LKNTS_NM, FARM_NM, FARM_LOCPLC_LEGALDONG_CODE, FARM_LOCPLC,
  OCCRRNC_DE, LVSTCKSPC_CODE, LVSTCKSPC_NM, OCCRRNC_LVSTCKCNT,
  DGNSS_ENGN_CODE, DGNSS_ENGN_NM, CESSATION_DE(종식일)

산출: data/domestic_disease.json
"""
import json
import os
import sys
import urllib.request

API_KEY = os.environ.get("QIA_API_KEY", "sample")  # 실제 키 발급 전까지 sample로 테스트
BASE_URL = "http://211.237.50.150:7080/openapi"
API_URL_ID = "Grid_20151204000000000316_1"
OUTPUT_PATH = "data/domestic_disease.json"

# 회사가 실제 취급하는 축종만 관심 (돈육/우육/계육) - 나머지는 참고용
WATCH_SPECIES_KEYWORDS = ["돼지", "돈", "소", "牛", "닭", "가금"]


def fetch_page(start: int, end: int) -> str:
    url = f"{BASE_URL}/{API_KEY}/json/{API_URL_ID}/{start}/{end}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def parse_rows(raw_json: str) -> list:
    """TODO: 실제 응답 감싸는 구조(예: {"Grid_...": {"row": [...]}})를 확인 후 경로 수정."""
    data = json.loads(raw_json)
    # 흔한 공공 API 패턴 몇 가지를 순서대로 시도
    for path in [
        lambda d: d[API_URL_ID]["row"],
        lambda d: d["row"],
        lambda d: d["result"],
        lambda d: d,
    ]:
        try:
            rows = path(data)
            if isinstance(rows, list):
                return rows
        except (KeyError, TypeError):
            continue
    print("경고: 알려진 응답 구조와 다름, 원본 구조 확인 필요", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False, indent=2)[:1000], file=sys.stderr)
    return []


def is_watch_species(row: dict) -> bool:
    name = row.get("LVSTCKSPC_NM", "") or ""
    return any(k in name for k in WATCH_SPECIES_KEYWORDS)


def main():
    all_rows = []
    start, page_size = 1, 100
    for _ in range(20):  # 최대 2000건까지 페이징 (안전장치)
        raw = fetch_page(start, start + page_size - 1)
        rows = parse_rows(raw)
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size

    watch_rows = [r for r in all_rows if is_watch_species(r)]
    active_rows = [r for r in watch_rows if not r.get("CESSATION_DE")]  # 종식일 없음 = 진행중

    result = {
        "total_count": len(all_rows),
        "watch_species_count": len(watch_rows),
        "active_count": len(active_rows),
        "active_cases": active_rows,
        "all_watch_cases": watch_rows,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {OUTPUT_PATH} (전체 {len(all_rows)}건 / 관심축종 {len(watch_rows)}건 / 진행중 {len(active_rows)}건)")


if __name__ == "__main__":
    main()
