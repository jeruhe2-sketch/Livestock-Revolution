/* 축산레이더 · 호주 축산물(소고기 Beef & Veal) 수출현황
   DAFF "57 Destination Report" 월별 데이터 중 10개 주요 목적지만 추림.
   EU/USDA 탭과 동일한 디자인 시스템(색상, SvgLineChart, 스티키 표) 재사용. */
window.AusTradeApp = (function () {
  const { useState, useEffect, useMemo } = React;

  const COLORS = {
    bg: "#151312", panel: "#1d1a19", panelBorder: "#2b2624", panelBorder2: "#332c29",
    amber: "#d98b3f", amberSoft: "#e8b877", cream: "#f2ead9", mute: "#8f857a",
    sage: "#6f9482", rust: "#c2695f", head: "#141211"
  };
  const SERIES_PALETTE = ["#d98b3f", "#5c8f7a", "#4f8fb8", "#b0a25c", "#a06a9c", "#c2695f", "#8b7bb0", "#5fa88a", "#e0985a", "#7ea0c4"];
  const DEST_ORDER = ["CN", "HK", "ID", "JP", "PH", "KR", "TW", "TH", "US_EAST", "US_WEST"];
  const DEST_LABEL_KO = {
    CN: "중국", HK: "홍콩", ID: "인도네시아", JP: "일본", PH: "필리핀",
    KR: "한국", TW: "대만", TH: "태국", US_EAST: "미국 동부", US_WEST: "미국 서부"
  };

  function n(v) { return v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString(); }
  function fmtShort(v) {
    if (v == null || !isFinite(v)) return "—";
    return Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "M" : Math.round(v).toLocaleString();
  }
  function readParams() { return new URLSearchParams(window.location.search); }
  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }
  function downloadXlsx(aoa, filename, sheetName) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    XLSX.writeFile(wb, filename);
  }

  /* EU/USDA 앱과 동일한 라인차트(호버 툴팁 포함) */
  function SvgLineChart({ categories, series, height = 300 }) {
    const width = 900;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 46 : 26, left: 52 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) * 1.08 : 1;
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v / maxVal) * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = manyLabels ? Math.ceil(categories.length / 14) : 1;
    const [hoverIdx, setHoverIdx] = useState(null);
    const handleMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setHoverIdx(categories.length ? Math.round(frac * (categories.length - 1)) : null);
    };
    const tooltipLeftPct = hoverIdx !== null && categories.length > 1 ? hoverIdx / (categories.length - 1) * 100 : 50;
    return React.createElement("div", { style: { position: "relative" }, onMouseMove: handleMove, onMouseLeave: () => setHoverIdx(null) },
      React.createElement("svg", { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", height, display: "block", cursor: "crosshair" }, preserveAspectRatio: "none" },
        Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padding.top + innerH / gridLines * i;
          const val = Math.round(maxVal - maxVal / gridLines * i);
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 6, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, fmtShort(val))
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - 8, textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
        hoverIdx !== null && React.createElement("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: COLORS.amberSoft, strokeWidth: "1", strokeDasharray: "2 2" }),
        series.map((s) => {
          const points = s.data.map((v, i) => `${xFor(i)},${yFor(v || 0)}`).join(" ");
          return React.createElement("g", { key: s.name },
            React.createElement("polyline", { points, fill: "none", stroke: s.color, strokeWidth: "2.2" }),
            categories.length <= 40 && s.data.map((v, i) => React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v || 0), r: i === hoverIdx ? 4 : 2.2, fill: s.color }))
          );
        })
      ),
      hoverIdx !== null && React.createElement("div", { style: {
        position: "absolute", left: `${tooltipLeftPct}%`, top: 6, transform: "translateX(-50%)",
        background: "#0f0d0c", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 8, padding: "7px 10px",
        fontSize: 11, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.4)"
      } },
        React.createElement("div", { style: { color: COLORS.mute, marginBottom: 4, fontWeight: 700 } }, categories[hoverIdx]),
        series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 6 } },
          React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block", flexShrink: 0 } }),
          React.createElement("span", { style: { color: COLORS.cream } }, s.name),
          React.createElement("span", { style: { fontFamily: "ui-monospace,monospace", color: COLORS.amberSoft, marginLeft: "auto" } }, n(s.data[hoverIdx]))
        ))
      )
    );
  }

  function AusTradeApp() {
    const [db, setDb] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      fetch("./data/aus_meat_export.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("데이터 파일을 불러오지 못했습니다 (" + r.status + "). 아직 최초 수집 전일 수 있습니다.");
        return r.json();
      }).then(setDb).catch((e) => setErr(e.message));
    }, []);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, padding: 20, textAlign: "center" } }, err);
    if (!db) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, "데이터를 불러오는 중...");
    return React.createElement(Dashboard, { db });
  }

  function Dashboard({ db }) {
    const initParams = useMemo(() => readParams(), []);
    const pList = (key, fallback) => { const v = initParams.get(key); return v ? v.split(",").filter(Boolean) : fallback; };
    const [selectedDest, setSelectedDest] = useState(() => pList("dest", DEST_ORDER.slice()));
    const [sortKey, setSortKey] = useState("ym");
    const [sortDir, setSortDir] = useState("desc");

    useEffect(() => {
      const usp = new URLSearchParams(window.location.search);
      usp.set("dest", selectedDest.join(","));
      window.history.replaceState(null, "", "?" + usp.toString() + window.location.hash);
    }, [selectedDest]);

    const rows = useMemo(() => (db.data || []).map((r) => ({
      year: r[0], month: r[1], dest: r[2], total: r[3],
      ym: `${r[0]}.${String(r[1]).padStart(2, "0")}`
    })), [db]);

    const months = useMemo(() => [...new Set(rows.map((r) => r.ym))].sort(), [rows]);

    const series = useMemo(() => selectedDest.map((code, idx) => ({
      name: DEST_LABEL_KO[code] || code,
      color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
      data: months.map((ym) => {
        const row = rows.find((r) => r.ym === ym && r.dest === code);
        return row ? row.total : 0;
      })
    })), [rows, months, selectedDest]);

    const tableRows = useMemo(() => {
      let filtered = rows.filter((r) => selectedDest.includes(r.dest));
      filtered.sort((a, b) => {
        let av, bv;
        if (sortKey === "ym") { av = a.ym; bv = b.ym; }
        else if (sortKey === "dest") { av = DEST_LABEL_KO[a.dest] || a.dest; bv = DEST_LABEL_KO[b.dest] || b.dest; }
        else { av = a[sortKey] || 0; bv = b[sortKey] || 0; }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
      return filtered;
    }, [rows, selectedDest, sortKey, sortDir]);

    const toggleSort = (key) => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortKey(key); setSortDir("desc"); }
    };
    const sortArrow = (key) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

    const toggleDest = (code) => {
      setSelectedDest((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
    };

    const handleExport = () => {
      const header = ["연월", "목적지", "소고기 합계(톤)"];
      const aoa = [header, ...tableRows.map((r) => [r.ym, DEST_LABEL_KO[r.dest] || r.dest, r.total])];
      downloadXlsx(aoa, `호주_축산물_수출현황_${Date.now()}.xlsx`, "호주수출현황");
    };

    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "22px 24px", color: COLORS.cream, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 } },
        React.createElement("h1", { style: { fontSize: 18, fontWeight: 800, margin: 0 } }, "🇦🇺 호주 축산물(소고기) 수출현황"),
        db.collectedAt && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute } }, "수집: " + fmtUpdatedAt(db.collectedAt))
      ),
      React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginBottom: 16 } }, "출처: 호주 DAFF Red meat export statistics · 57 Destination Report (사용자가 직접 취합해 수동 업로드 — 자동 갱신 안 됨, 새 데이터는 파일 업로드 시 반영)"),

      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 } },
        DEST_ORDER.map((code) => React.createElement("button", {
          key: code,
          onClick: () => toggleDest(code),
          style: {
            padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
            border: `1px solid ${selectedDest.includes(code) ? COLORS.amber : COLORS.panelBorder2}`,
            background: selectedDest.includes(code) ? "rgba(217,139,63,0.15)" : "transparent",
            color: selectedDest.includes(code) ? COLORS.amberSoft : COLORS.mute
          }
        }, DEST_LABEL_KO[code]))
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16, marginBottom: 20 } },
        React.createElement("div", { style: { fontSize: 12.5, fontWeight: 700, marginBottom: 10, color: COLORS.cream } }, "소고기(Beef & Veal) 총 수출량 추이 — 목적지별 (톤)"),
        months.length ? React.createElement(SvgLineChart, { categories: months, series }) :
          React.createElement("div", { style: { color: COLORS.mute, fontSize: 12, padding: 30, textAlign: "center" } }, "아직 데이터가 없습니다. 자동 수집이 아직 실행되지 않았을 수 있습니다.")
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16 } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
          React.createElement("div", { style: { fontSize: 12.5, fontWeight: 700 } }, "월별 상세 데이터 (" + tableRows.length + "행)"),
          React.createElement("button", { onClick: handleExport, style: { fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${COLORS.panelBorder2}`, background: "transparent", color: COLORS.amberSoft, cursor: "pointer" } }, "⬇ 엑셀 다운로드")
        ),
        React.createElement("div", { style: { overflowX: "auto" } },
          React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
            React.createElement("thead", null,
              React.createElement("tr", null,
                [["ym", "연월"], ["dest", "목적지"], ["total", "소고기 합계(톤)"]].map(([key, label]) =>
                  React.createElement("th", {
                    key,
                    onClick: () => toggleSort(key),
                    style: { textAlign: key === "dest" || key === "ym" ? "left" : "right", padding: "8px 10px", borderBottom: `1px solid ${COLORS.panelBorder2}`, color: COLORS.mute, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }
                  }, label + sortArrow(key))
                )
              )
            ),
            React.createElement("tbody", null,
              tableRows.slice(0, 500).map((r, i) => React.createElement("tr", { key: i, style: { borderBottom: `1px solid ${COLORS.panelBorder}` } },
                React.createElement("td", { style: { padding: "6px 10px" } }, r.ym),
                React.createElement("td", { style: { padding: "6px 10px" } }, DEST_LABEL_KO[r.dest] || r.dest),
                React.createElement("td", { style: { padding: "6px 10px", textAlign: "right", fontFamily: "ui-monospace,monospace", color: COLORS.amberSoft } }, n(r.total))
              ))
            )
          )
        ),
        tableRows.length > 500 && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 8, textAlign: "center" } }, "500행까지만 표시됩니다. 전체 데이터는 엑셀 다운로드를 이용하세요.")
      )
    );
  }

  return AusTradeApp;
})();
