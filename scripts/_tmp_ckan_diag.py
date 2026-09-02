import requests
import json

BASE = "https://data.gov.au/data/api/3/action"


def main():
    print("=== status_show ===")
    r = requests.get(f"{BASE}/status_show", timeout=20)
    print("status:", r.status_code)
    print(r.text[:500])

    print()
    print("=== package_search: red meat export ===")
    r = requests.get(f"{BASE}/package_search", params={"q": "red meat export statistics", "rows": 5}, timeout=20)
    print("status:", r.status_code)
    data = r.json()
    results = data.get("result", {}).get("results", [])
    print(f"count: {data.get('result', {}).get('count')}, returned: {len(results)}")
    for pkg in results:
        print(f"- id={pkg.get('id')} name={pkg.get('name')} title={pkg.get('title')}")
        for res in pkg.get("resources", []):
            print(f"    resource: format={res.get('format')} datastore_active={res.get('datastore_active')} url={res.get('url')}")

    print()
    print("=== package_search: broader 'meat export' (in case exact title differs) ===")
    r = requests.get(f"{BASE}/package_search", params={"q": "meat export", "rows": 10}, timeout=20)
    data = r.json()
    results = data.get("result", {}).get("results", [])
    print(f"count: {data.get('result', {}).get('count')}, returned: {len(results)}")
    for pkg in results:
        print(f"- id={pkg.get('id')} name={pkg.get('name')} title={pkg.get('title')} org={pkg.get('organization', {}).get('title')}")


if __name__ == "__main__":
    main()
