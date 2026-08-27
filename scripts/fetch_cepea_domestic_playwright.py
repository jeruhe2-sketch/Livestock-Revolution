"""브라질 CEPEA/ESALQ 돈육·계육 내수 가격 지표 수집기 - Playwright(실제 Chromium) 버전.

requests로 series/*.aspx?id= 엔드포인트를 직접 GET하면 Cloudflare 챌린지(403,
"Just a moment...")에 막히는 것을 확인함(fetch_cepea_domestic.py 첫 시도 실패 로그 참조).
실제 브라우저 엔진으로 페이지를 띄워 챌린지를 통과시킨 뒤 다운로드를 캡처하는 방식으로 우회한다.

사전 준비 (최초 1회, 워크플로우에서 매번 실행):
  pip install playwright
  playwright install --with-deps chromium

출력: data/cepea_pork_domestic.json, data/cepea_chicken_domestic.json
"""
import datetime as dt
import json
import os
import sys
import time

import xlrd
from playwright.sync_api import sync_playwright

BASE = "https://www.cepea.esalq.usp.br/br/indicador/series/"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

TARGETS = [
    {
        "key": "pork",
        "out": "data/cepea_pork_domestic.json",
        "url": BASE + "suino.aspx?id=124",
        "indicator": "Carcaça Suína Especial - Grande São Paulo",
        "label_kr": "돈육 (카르카사 특급, 상파울루)",
        "unit": "R$/kg",
        "source": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/suino.aspx?id=124)",
    },
    {
        "key": "chicken",
        "out": "data/cepea_chicken_domestic.json",
        "url": BASE + "frango.aspx?id=130",
        "indicator": "Frango Resfriado - Estado de São Paulo",
        "label_kr": "계육 (냉장 닭고기, 상파울루주)",
        "unit": "R$/kg e US$/kg",
        "source": "CEPEA/ESALQ (cepea.esalq.usp.br/br/indicador/series/frango.aspx?id=130)",
    },
]


STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = { runtime: {} };
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters)
);
"""


def is_challenge_page(page) -> bool:
    try:
        title = page.title()
    except Exception:
        title = ""
    return "moment" in title.lower() or "attention required" in title.lower()


def wait_out_challenge(page, max_seconds=40):
    waited = 0
    while is_challenge_page(page) and waited < max_seconds:
        time.sleep(3)
        waited += 3
    return not is_challenge_page(page)


def download_xls_bytes(playwright, url: str) -> bytes:
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )
    try:
        context = browser.new_context(
            user_agent=UA,
            locale="pt-BR",
            viewport={"width": 1366, "height": 850},
            accept_downloads=True,
        )
        context.add_init_script(STEALTH_JS)
        page = context.new_page()

        # 1) 홈페이지 먼저 방문해서 Cloudflare 챌린지를 통과하고 쿠키를 확보
        page.goto("https://www.cepea.esalq.usp.br/br/", wait_until="domcontentloaded", timeout=60000)
        passed = wait_out_challenge(page, max_seconds=40)
        print(f"  홈페이지 챌린지 통과 여부: {passed} (title={page.title()!r})")
        if not passed:
            os.makedirs("debug", exist_ok=True)
            try:
                page.screenshot(path="debug/cepea_challenge.png", full_page=True)
                print("  스크린샷 저장: debug/cepea_challenge.png")
            except Exception as e:
                print(f"  스크린샷 실패: {e!r}")
            # 디버그: 모든 프레임 URL 나열 + cloudflare 프레임 HTML 덤프
            try:
                print(f"  전체 프레임 수: {len(page.frames)}")
                for fr in page.frames:
                    print(f"    frame: {fr.url}")
                for fr in page.frames:
                    if "challenges.cloudflare.com" in (fr.url or ""):
                        html = fr.content()
                        with open("debug/cepea_cf_frame.html", "w", encoding="utf-8") as fh:
                            fh.write(html)
                        print(f"  cloudflare 프레임 HTML 저장 ({len(html)} bytes)")
            except Exception as e:
                print(f"  프레임 디버그 실패: {e!r}")

            # 체크박스형 challenge(Turnstile) 클릭 시도: 모든 프레임을 순회하며 직접 시도
            clicked = False
            for fr in page.frames:
                if clicked:
                    break
                for sel in ["input[type='checkbox']", "[role='checkbox']", "label", ".cb-lb", "#challenge-stage", "body"]:
                    try:
                        loc = fr.locator(sel)
                        if loc.count() > 0 and loc.first.is_visible():
                            loc.first.click(timeout=4000, force=True)
                            clicked = True
                            print(f"  체크박스 클릭 성공: frame={fr.url} sel={sel}")
                            break
                    except Exception:
                        continue
            if not clicked:
                try:
                    for fr in page.frames:
                        if "challenges.cloudflare.com" in (fr.url or ""):
                            el = fr.frame_element()
                            box = el.bounding_box() if el else None
                            if box:
                                x = box["x"] + 30
                                y = box["y"] + box["height"] / 2
                                page.mouse.click(x, y)
                                clicked = True
                                print(f"  체크박스 좌표 클릭 시도(frame_element): ({x:.0f},{y:.0f})")
                                break
                except Exception as e:
                    print(f"  좌표 클릭도 실패: {e!r}")
            if clicked:
                wait_out_challenge(page, max_seconds=25)
                print(f"  클릭 후 챌린지 통과 여부: {not is_challenge_page(page)} (title={page.title()!r})")
                if is_challenge_page(page):
                    try:
                        page.screenshot(path="debug/cepea_challenge_after_click.png", full_page=True)
                    except Exception:
                        pass

        # 2) 실제 다운로드 URL로 이동
        try:
            with page.expect_download(timeout=20000) as download_info:
                page.goto(url, timeout=60000)
            download = download_info.value
            path = download.path()
            with open(path, "rb") as f:
                content = f.read()
            print(f"  (download 이벤트로 캡처) bytes={len(content)}")
            return content
        except Exception as e:
            print(f"  expect_download 실패({e!r}), page.goto 응답 바디로 폴백 시도")

        resp = page.goto(url, timeout=60000, wait_until="domcontentloaded")
        # 챌린지가 여기서도 뜨면 좀 더 기다렸다가 재시도(reload)
        if is_challenge_page(page):
            wait_out_challenge(page, max_seconds=40)
            resp = page.reload(timeout=60000, wait_until="domcontentloaded")

        content = resp.body()
        print(f"  (goto 응답 바디) status={resp.status} bytes={len(content)} title={page.title()!r}")
        if resp.status != 200 or len(content) < 1000 or b"Just a moment" in content[:2000]:
            raise RuntimeError(
                f"다운로드 실패: status={resp.status} bytes={len(content)} head={content[:200]!r}"
            )
        return content
    finally:
        browser.close()


def parse_xls(content: bytes):
    wb = xlrd.open_workbook(file_contents=content, ignore_workbook_corruption=True)
    sheet = wb.sheet_by_index(0)
    header_row = None
    for r in range(min(6, sheet.nrows)):
        vals = [str(v).strip() for v in sheet.row_values(r)]
        if vals and vals[0] == "Data":
            header_row = r
            break
    if header_row is None:
        raise RuntimeError("헤더 행('Data')을 찾지 못함")
    rows = []
    for r in range(header_row + 1, sheet.nrows):
        vals = sheet.row_values(r)
        if not vals or not str(vals[0]).strip():
            continue
        rows.append(vals)
    return rows


def parse_date_br(s: str):
    s = str(s).strip()
    try:
        return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def process_target(playwright, target: dict):
    print(f"[{target['key']}] 다운로드: {target['url']}")
    content = download_xls_bytes(playwright, target["url"])
    rows = parse_xls(content)
    print(f"[{target['key']}] 파싱된 행수: {len(rows)}")

    data = []
    if target["key"] == "pork":
        for row in rows:
            date_iso = parse_date_br(row[0])
            value = num(row[1]) if len(row) > 1 else None
            if date_iso and value is not None:
                data.append({"date": date_iso, "value": value})
    else:
        for row in rows:
            date_iso = parse_date_br(row[0])
            brl = num(row[1]) if len(row) > 1 else None
            usd = num(row[2]) if len(row) > 2 else None
            if date_iso and (brl is not None or usd is not None):
                data.append({"date": date_iso, "valueBRL": brl, "valueUSD": usd})

    data.sort(key=lambda d: d["date"])

    out = {
        "indicator": target["indicator"],
        "labelKr": target["label_kr"],
        "unit": target["unit"],
        "url": target["url"],
        "source": target["source"],
        "collectedAt": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "count": len(data),
        "range": {
            "start": data[0]["date"] if data else None,
            "end": data[-1]["date"] if data else None,
        },
        "data": data,
    }
    os.makedirs("data", exist_ok=True)
    with open(target["out"], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[{target['key']}] 완료: {len(data)}건, 기간 {out['range']['start']} ~ {out['range']['end']}")
    if len(data) == 0:
        print(f"::warning::[{target['key']}] 수집된 행이 0건입니다.")
    return out


def main():
    with sync_playwright() as playwright:
        results = []
        for target in TARGETS:
            results.append(process_target(playwright, target))
    total = sum(r["count"] for r in results)
    print(f"전체 완료: {total}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
