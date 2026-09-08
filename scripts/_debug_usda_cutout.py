import requests, json, sys

def get_section(url, label, idx):
    print("===", label, "idx", idx, url)
    try:
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and len(data) > idx:
                el = data[idx]
                print("reportSection:", el.get("reportSection"))
                results = el.get("results", [])
                print("row count:", len(results))
                for row in results[:5]:
                    print("  ", row)
        else:
            print("status", r.status_code, r.text[:200])
    except Exception as e:
        print("ERROR", repr(e))

get_section("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date=09/04/2026&allSections=true", "beef 2461 Weekly Summary Cutout Values", 2)
get_section("https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date=09/04/2026&allSections=true", "beef 2461 Weekly Average Cutout Values", 3)

