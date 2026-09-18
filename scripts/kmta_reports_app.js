/* 축산레이더 · KMTA(한국육류유통수출협회) 리포트 목록
   주간판매동향/월간시장동향/시장전망칼럼/축산관측(KREI) - data/kmta_reports.json.
   실제 글(칼럼/리포트) 전문은 저작권상 재게시 안 하고, 제목·작성일만 목록으로
   보여주고 "원문 보기"는 해당 게시판 목록 페이지로 링크한다(개별 글 상세는
   POST 전용 네비게이션이라 직접 링크 불가 - 확인해봄). */
window.KmtaReportsApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, fmtUpdatedAt } = window.RadarUI;
  const BOARD_ORDER = ["주간판매동향", "월간시장동향", "시장전망칼럼", "축산관측(KREI)"];

  return function KmtaReportsApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    React.useEffect(() => {
      fetch("./data/kmta_reports.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    const boards = raw?.boards || {};
    const availableTabs = BOARD_ORDER.filter((b) => boards[b]);
    const [activeBoard, setActiveBoard] = useState(null);
    const current = activeBoard || availableTabs[0];
    const [count, setCount] = useState(20);

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const board = boards[current];
    const items = (board?.items || []).slice(0, count);

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 900, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "리포트 · 시황정보"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "한국육류유통수출협회(KMTA) · 제목/작성일만 수집, 원문 전문은 협회 사이트에서 확인 (저작권상 재게시 안 함)"
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" } },
        availableTabs.map((b) => React.createElement(SubTab, {
          key: b, active: current === b, onClick: () => { setActiveBoard(b); setCount(20); }, label: b
        }))
      ),

      board && React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } }, `최근 ${board.items.length}건 수집됨`),
        React.createElement("a", { href: board.listUrl, target: "_blank", rel: "noopener noreferrer", style: { fontSize: 12.5, fontWeight: 700, color: COLORS.amberSoft, textDecoration: "none" } }, "협회 사이트에서 전체보기 \u2197")
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 16 } },
        items.length
          ? items.map((it, i) => React.createElement("a", {
              key: it.no, href: board.listUrl, target: "_blank", rel: "noopener noreferrer",
              style: {
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                padding: "12px 14px", textDecoration: "none",
                borderTop: i === 0 ? "none" : `1px solid ${COLORS.panelBorder}`,
              }
            },
              React.createElement("span", { style: { color: COLORS.cream, fontSize: 14, fontWeight: 600 } }, it.title),
              React.createElement("span", { style: { color: COLORS.mute, fontSize: 12.5, whiteSpace: "nowrap" } }, it.date)
            ))
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 항목이 없습니다.")
      ),

      board && board.items.length > count && React.createElement("button", {
        onClick: () => setCount((c) => c + 20),
        style: { padding: "8px 16px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 20 }
      }, "더 보기"),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginTop: 8 } },
        `수집: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "\u2014"} \u00B7 ${raw.source || ""}`
      )
    );
  };
})();
