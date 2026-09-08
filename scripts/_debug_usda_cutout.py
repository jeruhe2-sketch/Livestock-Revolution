import requests, json, sys

def get(url, label):
    print("===", label, url)
    try:
        r = requests.get(url, timeout=30)
        print("status", r.status_code)
        if r.status_code == 200:
            data = r.json()
            print("top-level type:", type(data))
            if isinstance(data, list):
                print("list length:", len(data))
                print("first element type:", type(data[0]) if data else None)
                print("first element (truncated):", json.dumps(data[0], ensure_ascii=False)[:2000] if data else None)
                if len(data) > 1:
                    print("second element (truncated):", json.dumps(data[1], ensure_ascii=False)[:1500])
            else:
                print(json.dumps(data, ensure_ascii=False)[:3000])
        else:
            print(r.text[:300])
    except Exception as e:
        print("ERROR", repr(e))

# 돈육 리포트(2498) 전체 섹션 확인 - cutout 관련 섹션 찾기
get("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498?q=report_date=09/04/2026&allSections=true", "pork 2498 (09/04)")

print()
print("############ BEEF CUTOUT (2461) ############")
get("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date=09/04/2026&allSections=true", "beef 2461 (09/04)")
