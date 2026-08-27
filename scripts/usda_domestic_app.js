/* 축산레이더 · 미국 축산물 내수 현황
 * USDA AMS MyMarketNews LM_PK602 / report 2498
 * index.html과 분리해 기존 4개 IIFE의 스코프를 건드리지 않는다.
 */
window.UsdaDomesticApp = (function () {
  const { useState, useEffect, useMemo } = React;
  const COLORS = {
    bg: "#151312", panel: "#1d1a19", panelBorder: "#2b2624", panelBorder2: "#332c29",
    amber: "#d98b3f", amberSoft: "#e8b877", cream: "#f2ead9", mute: "#8f857a",
    sage: "#6f9482", rust: "#c2695f", head: "#141211"
  };
  const ITEMS = [
    { key: "Bnls CC Strap-off", label: "등심", color: COLORS.amber },
    { key: "Picnic Cushion Meat Vac", label: "전지", color: COLORS.sage },
    { key: "1/4 Trim Bnls Butt VAC", label: "목전지", color: "#4f8fb8" }
  ];
  const n = (v, digits = 2) => Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtDate = (s) => {
    if (!s) return "—";
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  };
  const pct = (v) => v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  function LineChart({ rows, height = 310 }) {
    const width = 820, pad = { top: 22, right: 18, bottom: 42, left: 58 };
    const iw = width - pad.left - pad.right, ih = height - pad.top - pad.bottom;
    const vals = rows.flatMap(r => ITEMS.map(i => Number(r[i.key]?.usdPerLb)).filter(Number.isFinite));
    const min = Math.min(...vals, 0), max = Math.max(...vals, 1), range = Math.max(0.01, max - min);
    const x = i => pad.left + (rows.length <= 1 ? iw / 2 : i * iw / (rows.length - 1));
    const y = v => pad.top + ih - ((v - min) / range) * ih;
    const labelsEvery = Math.max(1, Math.ceil(rows.length / 10));
    const path = item => rows.map((r, i) => {
      const v = Number(r[item.key]?.usdPerLb);
      return Number.isFinite(v) ? `${i ? "L" : "M"}${x(i)},${y(v)}` : "";
    }).filter(Boolean).join(" ");
    return React.createElement("div", { style: { overflowX: "auto" } },
      React.createElement("svg", { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", minWidth: 620, height, display: "block" }, preserveAspectRatio: "none" },
        Array.from({ length: 5 }).map((_, i) => {
          const v = min + range * (4 - i) / 4, yy = y(v);
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: pad.left - 8, y: yy + 4, textAnchor: "end", fontSize: 10, fill: COLORS.mute }, `$${v.toFixed(2)}`)
          );
        }),
        rows.map((r, i) => i % labelsEvery === 0 && React.createElement("text", { key: r.date, x: x(i), y: height - 12, textAnchor: "middle", fontSize: 9, fill: COLORS.mute }, r.date.slice(5))),
        ITEMS.map(item => React.createElement("g", { key: item.key },
          React.createElement("path", { d: path(item), fill: "none", stroke: item.color, strokeWidth: 2.3 }),
          rows.length <= 90 && rows.map((r, i) => {
            const v = Number(r[item.key]?.usdPerLb);
            return Number.isFinite(v) ? React.createElement("circle", { key: i, cx: x(i), cy: y(v), r: 2.4, fill: item.color }) : null;
          })
        ))
      ),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 4 } }, ITEMS.map(item => React.createElement("div", { key: item.key, style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.cream } }, React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: item.color } }), item.label, ` · ${item.key}`)))
    );
  }

  function DomesticCard({ item, latest, previous, weekAgo }) {
    const cur = latest?.[item.key]?.usdPerLb;
    const prev = previous?.[item.key]?.usdPerLb;
    const wow = weekAgo?.[item.key]?.usdPerLb;
    const dod = Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur - prev) / prev * 100 : null;
    const w = Number.isFinite(cur) && Number.isFinite(wow) && wow !== 0 ? (cur - wow) / wow * 100 : null;
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "14px 16px", minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginBottom: 5 } }, item.label),
      React.createElement("div", { style: { fontSize: "clamp(21px,5vw,28px)", fontWeight: 800, color: COLORS.amberSoft, fontFamily: "ui-monospace,monospace" } }, cur == null ? "—" : `$${n(cur)}/lb`),
      React.createElement("div", { style: { fontSize: 10.5, color: COLORS.mute, marginTop: 4 } }, cur == null ? "데이터 없음" : `$${n(cur * 100)}/100 lb (USDA 원자료)`),
      React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 9, fontSize: 10.5 } },
        React.createElement("span", { style: { color: dod == null ? COLORS.mute : dod >= 0 ? COLORS.sage : COLORS.rust } }, `전일 ${pct(dod)}`),
        React.createElement("span", { style: { color: w == null ? COLORS.mute : w >= 0 ? COLORS.sage : COLORS.rust } }, `전주 ${pct(w)}`)
      )
    );
  }

  function App() {
    const [db, setDb] = useState(null), [err, setErr] = useState(null), [days, setDays] = useState(90), [tab, setTab] = useState("chart"), [copied, setCopied] = useState(false);
    useEffect(() => {
      fetch("./data/usda_pork_domestic.json", { cache: "no-store" })
        .then(r => { if (!r.ok) throw new Error(`데이터 파일을 불러오지 못했습니다 (${r.status})`); return r.json(); })
        .then(setDb).catch(e => setErr(e.message));
    }, []);
    const rows = useMemo(() => {
      if (!db?.data) return [];
      return [...db.data].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
    }, [db, days]);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, err);
    if (!db) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" } }, "데이터를 불러오는 중...");
    const latest = rows[rows.length - 1] || null;
    const prev = rows[rows.length - 2] || null;
    const weekAgo = rows[Math.max(0, rows.length - 6)] || null;
    const copy = () => navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
    const tableRows = [...rows].reverse();
    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", color: COLORS.cream } },
      React.createElement("div", { style: { maxWidth: 1120, margin: "0 auto" } },
        React.createElement("div", { style: { fontSize: 11.5, letterSpacing: "0.13em", color: COLORS.mute, fontWeight: 700 } }, "USDA AMS · LM_PK602 · NATIONAL DAILY PORK FOB PLANT"),
        React.createElement("h1", { style: { fontSize: "clamp(20px,5.5vw,25px)", fontWeight: 800, margin: "5px 0 4px" } }, "미국 축산물 내수 현황"),
        React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginBottom: 14 } }, "돼지고기 주요 부위 · Negotiated Sales · Wtd Avg · USD/100 lb → USD/lb"),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginBottom: 10 } }, ITEMS.map(item => React.createElement(DomesticCard, { key: item.key, item, latest: latest, previous: prev, weekAgo }))),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "11px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" } },
          React.createElement("div", { style: { fontSize: 11, color: COLORS.mute } }, latest ? `최근 발표 ${fmtDate(latest.date)} · ${latest.source || "USDA AMS"}` : "최근 발표 데이터 없음"),
          React.createElement("button", { onClick: copy, style: { fontSize: 11, fontWeight: 700, color: copied ? COLORS.sage : COLORS.mute, background: "none", border: `1px solid ${copied ? COLORS.sage : COLORS.panelBorder}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" } }, copied ? "✓ 복사됨" : "🔗 이 화면 링크 복사")
        ),
        React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 12, borderBottom: `1px solid ${COLORS.panelBorder}` } },
          ["chart", "table"].map(v => React.createElement("button", { key: v, onClick: () => setTab(v), style: { padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", background: "none", border: "none", borderBottom: `2px solid ${tab === v ? COLORS.amber : "transparent"}`, color: tab === v ? COLORS.amber : COLORS.mute, marginBottom: -1 } }, v === "chart" ? "차트" : "표"))
        ),
        tab === "chart" && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", gap: 5, justifyContent: "flex-end", marginBottom: 8 } }, [30, 90, 180].map(d => React.createElement("button", { key: d, onClick: () => setDays(d), style: { padding: "5px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${days === d ? COLORS.amber : COLORS.panelBorder}`, background: days === d ? "rgba(217,139,63,0.14)" : COLORS.panel, color: days === d ? COLORS.amber : COLORS.mute } }, `${d}일`))),
          React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } }, rows.length ? React.createElement(LineChart, { rows }) : React.createElement("div", { style: { color: COLORS.mute, padding: 40, textAlign: "center" } }, "차트 데이터가 없습니다.")),
          React.createElement("div", { style: { marginTop: 12, fontSize: 10.5, color: COLORS.mute, lineHeight: 1.6 } }, "※ USDA 원자료의 Wtd Avg는 $/100 lb 기준입니다. 화면에서는 이를 100으로 나눠 $/lb로 표시합니다. 예: $145.00/100 lb = $1.45/lb." )
        ),
        tab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, overflow: "hidden" } },
          React.createElement("div", { style: { overflowX: "auto", maxHeight: 560, overflowY: "auto" } },
            React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 12, width: "100%" } },
              React.createElement("thead", null, React.createElement("tr", null, ["발표일", ...ITEMS.map(i => `${i.label} Wtd Avg`)].map((h, i) => React.createElement("th", { key: h, style: { padding: "8px 9px", textAlign: i ? "right" : "left", color: COLORS.mute, background: COLORS.head, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, whiteSpace: "nowrap" } }, h)))),
              React.createElement("tbody", null, tableRows.map(r => React.createElement("tr", { key: r.date, style: { borderTop: `1px solid ${COLORS.panelBorder}` } }, React.createElement("td", { style: { padding: "7px 9px", color: COLORS.cream, whiteSpace: "nowrap" } }, fmtDate(r.date)), ITEMS.map(i => React.createElement("td", { key: i.key, style: { padding: "7px 9px", textAlign: "right", color: i.color, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap" } }, r[i.key]?.usdPerLb == null ? "—" : `$${n(r[i.key].usdPerLb)}`))))))
            )
          )
        ),
        React.createElement("div", { style: { marginTop: 16, paddingTop: 10, borderTop: `1px solid ${COLORS.panelBorder}`, fontSize: 10.5, color: COLORS.mute, lineHeight: 1.7 } },
          React.createElement("div", null, "자료: USDA Agricultural Marketing Service · MyMarketNews · LM_PK602 (Slug ID 2498)"),
          React.createElement("div", null, latest ? `데이터 갱신: ${fmtDate(latest.date)} · 수집 시각 ${db.collectedAt ? new Date(db.collectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—"}` : "데이터 갱신 정보 없음"),
          React.createElement("div", null, "품목 매핑: Bnls CC Strap-off = 등심 · Picnic Cushion Meat Vac = 전지 · 1/4 Trim Bnls Butt VAC = 목전지")
        )
      )
    );
  }
  return App;
})();
