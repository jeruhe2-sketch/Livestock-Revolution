import requests
import time

PARTNERS = {
    "China": 156, "Hong Kong": 344, "Indonesia": 360, "Japan": 392,
    "Philippines": 608, "South Korea": 410, "Taiwan": 490, "Thailand": 764,
    "USA": 842,
}
BASE = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"


def get(period, partner, cmd, tries=5):
    url = f"{BASE}?reporterCode=36&period={period}&partnerCode={partner}&cmdCode={cmd}&flowCode=X"
    for attempt in range(tries):
        try:
            r = requests.get(url, timeout=20)
            if r.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"    (429, {wait}초 대기 후 재시도 {attempt + 1}/{tries})")
                time.sleep(wait)
                continue
            return r.status_code, r.json()
        except Exception as e:
            return None, str(e)
    return 429, None


def net_kg(data):
    if not isinstance(data, dict) or "data" not in data:
        return None
    rows = [d for d in data["data"] if d.get("motCode") == 0]
    if not rows:
        rows = data["data"]
    return sum(d.get("netWgt") or 0 for d in rows) if rows else 0


def main():
    print("=== 2024년 1월 국가별 소고기(0201+0202) 합계(kg) ===")
    for name, code in PARTNERS.items():
        total = 0
        for cmd in ["0201", "0202"]:
            status, data = get("202401", code, cmd)
            kg = net_kg(data) if status == 200 else None
            print(f"  {name} {cmd}: status={status} kg={kg}")
            if kg:
                total += kg
            time.sleep(3)
        print(f"  -> {name} 합계: {total} kg = {total / 1000:.1f} 톤")

    print()
    print("=== 최신 가용 시점 확인 (한국 대상 0201, 최근 달부터 역순) ===")
    for period in ["202608", "202607", "202606"]:
        status, data = get(period, 410, "0201")
        kg = net_kg(data) if status == 200 else None
        print(f"  {period}: status={status} kg={kg}")
        time.sleep(3)


if __name__ == "__main__":
    main()
