import requests, json, sys

def get(url, label):
    print("===", label, url)
    try:
        r = requests.get(url, timeout=30)
        print("status", r.status_code)
        if r.status_code == 200:
            data = r.json()
            secs = data.get("reportSection", [])
            print("sections:", secs)
            results = data.get("results", [])
            for i, sec_rows in enumerate(results):
                sec_name = secs[i] if i < len(secs) else f"section{i}"
                if isinstance(sec_rows, list) and sec_rows:
                    print(f"-- section '{sec_name}' sample row keys:", list(sec_rows[0].keys()))
                    # cutout/전체 관련 행만 몇 개 출력
                    for row in sec_rows[:8]:
                        print("   ", row)
        else:
            print(r.text[:300])
    except Exception as e:
        print("ERROR", repr(e))

# 돈육 리포트(2498) 전체 섹션 확인 - cutout 관련 섹션 찾기
get("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498?q=report_date=09/04/2026&allSections=true", "pork 2498 (09/04)")

print()
print("############ BEEF CUTOUT (2461) ############")
get("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date=09/04/2026&allSections=true", "beef 2461 (09/04)")
