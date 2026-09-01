# -*- coding: utf-8 -*-
"""
eminwon.qia.go.kr (농림축산검역본부 동축산물검역통계) 정찰 스크립트.
requests로 원본 HTML을 받아서 검색 폼의 실제 input/select name 속성을 파악한다.
"""
import os
import re
import requests

RUN_ID = os.environ.get("GITHUB_RUN_ID", "local")

URLS = {
    "No1": "https://eminwon.qia.go.kr/statistics/statistics_No1.do",
    "No3": "https://eminwon.qia.go.kr/statistics/statistics_No3.do",
}


def main():
    os.makedirs("debug", exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})

    out_lines = [f"[RUN_ID] {RUN_ID}"]

    for name, url in URLS.items():
        try:
            resp = session.get(url, timeout=20)
            out_lines.append(f"\n=== {name} ({url}) status={resp.status_code} ===")
            html = resp.text
            # form 태그, input/select 태그만 추려서 확인
            forms = re.findall(r"<form[^>]*>", html)
            inputs = re.findall(r"<input[^>]*>", html)
            selects = re.findall(r"<select[^>]*name=[\"']([^\"']+)[\"']", html)
            buttons = re.findall(r"<(?:button|a)[^>]*(?:onclick|href)=[\"']([^\"']*(?:search|excel|Search|Excel)[^\"']*)[\"']", html)

            out_lines.append(f"form 개수: {len(forms)}")
            for f in forms[:5]:
                out_lines.append(f"  FORM: {f}")
            out_lines.append(f"input 개수: {len(inputs)}")
            for i in inputs[:30]:
                out_lines.append(f"  INPUT: {i}")
            out_lines.append(f"select name 목록: {selects}")
            out_lines.append(f"검색/엑셀 관련 onclick/href 후보: {buttons[:20]}")

            # 원본 HTML 저장 (분석용)
            with open(f"debug/eminwon_{name}_{RUN_ID}.html", "w", encoding="utf-8") as f:
                f.write(html)
        except Exception as e:
            out_lines.append(f"{name} 오류: {e}")

    log_path = f"debug/eminwon_explore_{RUN_ID}.log"
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))

    print("\n".join(out_lines))


if __name__ == "__main__":
    main()
