/* 축산레이더 · 호주 축산물 수출현황
   EU/USDA 수출현황 탭과 완전히 동일한 UI 패턴. 이번 버전은 축종(소고기/양고기/
   램/산양육/돼지고기)과 형태(냉장/냉동/합계)를 완전히 분리된 선택지로 두고,
   목적지는 16개국(전체 물량의 91.9% 커버) 다중선택 필터로 둔다.
   이 파일은 index.html의 인라인 스크립트보다 먼저 로드되므로 자체 구현. */
window.AusTradeApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };
  const SERIES_PALETTE = ["#b96a2e", "#3f7d64", "#2f6f96", "#8a7d3a", "#7d4f79", "#a34a3f", "#6b5a8f", "#3f8768", "#b8763e", "#5580a8"];

  const DEST_LABEL_KO = {
    CN: "중국", US_EAST: "미국 동부", JP: "일본", KR: "한국", ID: "인도네시아",
    US_WEST: "미국 서부", MY: "말레이시아", SA: "사우디아라비아", TW: "대만",
    PH: "필리핀", SG: "싱가포르", DXB: "두바이", CA_EAST: "캐나다 동부",
    PG: "파푸아뉴기니", HK: "홍콩", TH: "태국"
  };
  const SPECIES_LABEL_KO = { beef: "소고기", mutton: "양고기 (머튼)", lamb: "양고기(램)", goat: "염소", pork: "돼지고기" };
  const SPECIES_ORDER = ["beef", "mutton", "lamb", "goat", "pork"];
  const FORM_LABEL = { total: "합계", chilled: "냉장", frozen: "냉동" };
  const DIM_LABEL = { dest: "목적지", year: "연도", month: "월", yearMonth: "연월" };
  const DIM_OPTIONS = [["dest", "목적지"], ["year", "연도"], ["month", "월"], ["yearMonth", "연월"]];
  const GROUP_DIM_OPTIONS = [["dest", "목적지"], ["year", "연도"], ["month", "월"]]; // 연월은 91개나 돼서 막대비교엔 안 맞음(추이 탭이 담당)

  function n(v) { return v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString(); }
  function fmtShort(v) {
    if (v == null || !isFinite(v)) return "—";
    return Math.abs(v) >= 1e4 ? (v / 1e4).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "만" : Math.round(v).toLocaleString();
  }
  function pct(v) {
    if (v === null) return "—";
    const s = v > 0 ? "+" : "";
    return `${s}${v.toFixed(1)}%`;
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

  function movingAvg(arr, win) {
    const out = new Array(arr.length).fill(null);
    let sum = 0, count = 0, buf = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      buf.push(v);
      if (v != null && isFinite(v)) { sum += v; count++; }
      if (buf.length > win) { const removed = buf.shift(); if (removed != null && isFinite(removed)) { sum -= removed; count--; } }
      out[i] = count ? sum / count : null;
    }
    return out;
  }

  /* ---- EU/USDA 탭과 동일한 공용 위젯들 (자체 구현) ---- */
  function SvgLineChart({ categories, series, height = 260 }) {
    const width = 760;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 46 : 26, left: 46 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const maxVal = Math.max(1, ...series.flatMap((s) => s.data));
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - v / maxVal * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = manyLabels ? Math.ceil(categories.length / 14) : 1;
    const containerRef = useRef(null);
    const [hoverIdx, setHoverIdx] = useState(null);
    const handleMove = (e) => {
      if (!containerRef.current || categories.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setHoverIdx(Math.round(frac * (categories.length - 1)));
    };
    const tooltipLeftPct = hoverIdx !== null && categories.length > 1 ? hoverIdx / (categories.length - 1) * 100 : 50;
    return React.createElement("div", { ref: containerRef, style: { position: "relative" }, onMouseMove: handleMove, onMouseLeave: () => setHoverIdx(null) },
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
            categories.length <= 40 && s.data.map((v, i) => React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v || 0), r: i === hoverIdx ? 4 : 2.4, fill: s.color }))
          );
        })
      ),
      hoverIdx !== null && React.createElement("div", { style: {
        position: "absolute", left: `${tooltipLeftPct}%`, top: 6, transform: "translateX(-50%)",
        background: "#e5e7e2", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 8, padding: "7px 10px",
        fontSize: 13, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.4)"
      } },
        React.createElement("div", { style: { color: COLORS.mute, marginBottom: 4, fontWeight: 700 } }, categories[hoverIdx]),
        series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 6 } },
          React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block", flexShrink: 0 } }),
          series.length > 1 && React.createElement("span", { style: { color: COLORS.cream } }, s.name),
          React.createElement("span", { style: { fontFamily: "ui-monospace,monospace", color: COLORS.amberSoft, marginLeft: "auto" } }, n(s.data[hoverIdx]))
        ))
      )
    );
  }
  function ChartLegend({ series }) {
    if (series.length < 2) return null;
    return React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6, paddingBottom: 10 } },
      series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, color: COLORS.cream } },
        React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" } }), s.name
      ))
    );
  }
  function BarRanking({ items }) {
    const capped = items.length > 40 ? items.slice(0, 40) : items;
    const maxVal = Math.max(1, ...capped.map((i) => i.v));
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } },
        capped.map((it, idx) => React.createElement("div", { key: it.key, style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("div", { style: { width: 90, fontSize: 13.5, color: COLORS.cream, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.key),
          React.createElement("div", { style: { flex: 1, background: "#e5e7e2", borderRadius: 5, height: 20, position: "relative", overflow: "hidden" } },
            React.createElement("div", { style: { width: `${it.v / maxVal * 100}%`, height: "100%", background: SERIES_PALETTE[idx % SERIES_PALETTE.length], borderRadius: 5 } })
          ),
          React.createElement("div", { style: { width: 90, fontSize: 13.5, color: COLORS.amberSoft, fontFamily: "ui-monospace,monospace", flexShrink: 0 } }, fmtShort(it.v))
        ))
      ),
      items.length > 40 && React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginTop: 10, textAlign: "center" } }, `상위 40개만 표시 중 (전체 ${items.length}개)`)
    );
  }
  function SheetTab({ active, onClick, label }) {
    return React.createElement("button", { onClick, style: { padding: "9px 18px", fontSize: 15.5, fontWeight: 700, cursor: "pointer", background: "none", border: "none", borderBottom: active ? `2px solid ${COLORS.amber}` : "2px solid transparent", color: active ? COLORS.amber : COLORS.mute, marginBottom: -1 } }, label);
  }
  function SubTab({ active, onClick, label }) {
    return React.createElement("button", { onClick, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.panelBorder}`, background: active ? "rgba(217,139,63,0.14)" : COLORS.panel, color: active ? COLORS.amber : COLORS.mute } }, label);
  }
  function ToggleBtn({ active, onClick, label }) {
    return React.createElement("button", { onClick, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.panelBorder}`, background: active ? "rgba(217,139,63,0.14)" : COLORS.panel, color: active ? COLORS.amber : COLORS.mute } }, label);
  }
  function HoverAxisPicker({ label, value, onChange, options }) {
    const detailsRef = useRef(null);
    const found = options.find(([v]) => v === value);
    const currentLabel = found ? found[1] : value;
    return React.createElement("details", { ref: detailsRef, style: { position: "relative", display: "inline-block" } },
      React.createElement("summary", { style: { display: "flex", alignItems: "center", gap: 6, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", listStyle: "none" } },
        React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, label),
        React.createElement("span", { style: { fontSize: 14.5, fontWeight: 700, color: COLORS.amber } }, currentLabel),
        React.createElement("span", { style: { fontSize: 12, color: COLORS.mute } }, "▾")
      ),
      React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, zIndex: 20, background: "#eef0ec", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 10, padding: 6, minWidth: 130, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" } },
        options.map(([v, l]) => React.createElement("button", { key: v, onClick: () => { onChange(v); if (detailsRef.current) detailsRef.current.open = false; },
          style: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 6, fontSize: 14.5, cursor: "pointer", border: "none", background: v === value ? "rgba(217,139,63,0.18)" : "transparent", color: v === value ? COLORS.amberSoft : COLORS.cream, whiteSpace: "nowrap" } }, l))
      )
    );
  }
  function HoverMultiPicker({ label, options, selected, onToggle, onSelectAll, onClear }) {
    return React.createElement("details", { style: { position: "relative", display: "inline-block" } },
      React.createElement("summary", { style: { display: "flex", alignItems: "center", gap: 6, background: COLORS.panel, border: `1px solid ${selected.length ? COLORS.amber : COLORS.panelBorder}`, borderRadius: 8, padding: "6px 12px", color: selected.length ? COLORS.amber : COLORS.mute, fontSize: 14.5, fontWeight: 600, cursor: "pointer", listStyle: "none" } },
        label, " ", selected.length ? `(${selected.length})` : "전체", " ", React.createElement("span", { style: { fontSize: 12 } }, "▾")),
      React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, zIndex: 20, background: "#eef0ec", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 10, padding: 10, width: 240, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
          React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, options.length, "개 옵션"),
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("button", { onClick: onSelectAll, style: { fontSize: 13, color: COLORS.sage, background: "none", border: "none", cursor: "pointer", fontWeight: 700 } }, "전체 선택"),
            React.createElement("button", { onClick: onClear, style: { fontSize: 13, color: COLORS.rust, background: "none", border: "none", cursor: "pointer", fontWeight: 700 } }, "초기화")
          )
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
          options.map((o) => React.createElement("button", { key: o, onClick: () => onToggle(o),
            style: { padding: "4px 9px", borderRadius: 6, fontSize: 13.5, cursor: "pointer", border: `1px solid ${selected.includes(o) ? COLORS.amber : COLORS.panelBorder2}`, background: selected.includes(o) ? "rgba(217,139,63,0.18)" : "transparent", color: selected.includes(o) ? COLORS.amberSoft : COLORS.mute } }, o))
        )
      )
    );
  }
  const thStyle = { textAlign: "left", padding: "10px 10px", fontSize: 12.5, color: "#5b615c", fontWeight: 700, borderBottom: "1px solid #d7dad4", whiteSpace: "nowrap" };
  const tdStyle = { padding: "9px 10px", color: "#1f2420" };

  /* ---- 메인 앱 ---- */
  function AusTradeApp() {
    const [db, setDb] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      fetch("./data/aus_meat_export.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("데이터 파일을 불러오지 못했습니다 (" + r.status + "). 아직 업로드된 데이터가 없을 수 있습니다.");
        return r.json();
      }).then(setDb).catch((e) => setErr(e.message));
    }, []);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, padding: 20, textAlign: "center" } }, err);
    if (!db) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 } }, "데이터를 불러오는 중...");
    return React.createElement(Dashboard, { db });
  }

  function Dashboard({ db }) {
    useEffect(() => {
      const onDocClick = (e) => {
        document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
      };
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }, []);

    const ROWS = useMemo(() => (db.data || []).map((r) => ({
      year: r[0], month: r[1], dest: r[2], species: r[3], chilled: r[4] || 0, frozen: r[5] || 0, total: r[6] || 0,
    })), [db]);
    const DEST_LIST = useMemo(() => [...new Set(ROWS.map((r) => r.dest))].sort(), [ROWS]);
    const YEARS_ALL = useMemo(() => [...new Set(ROWS.map((r) => String(r.year)))].sort(), [ROWS]);

    function dimValue(r, dimKey) {
      if (dimKey === "dest") return DEST_LABEL_KO[r.dest] || r.dest;
      if (dimKey === "year") return String(r.year);
      if (dimKey === "yearMonth") return `${r.year}-${String(r.month).padStart(2, "0")}`;
      return `${r.month}월`;
    }
    function monthNum(label) { return parseInt(label, 10); }

    const initParams = useMemo(() => readParams(), []);
    const p = (key, fallback) => { const v = initParams.get(key); return v != null ? v : fallback; };
    const pOneOf = (key, fallback, validValues) => { const v = p(key, fallback); return validValues.includes(v) ? v : fallback; };
    const pList = (key) => { const v = initParams.get(key); return v ? v.split(",").filter(Boolean) : []; };
    const pInt = (key, fallback) => { const v = initParams.get(key); const n2 = parseInt(v, 10); return Number.isFinite(n2) ? n2 : fallback; };

    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "table", ["table", "chart"]));
    const [chartSub, setChartSub] = useState(() => pOneOf("csub", "trend", ["group", "trend", "overlay"]));
    const [species, setSpecies] = useState(() => pOneOf("sp", "beef", SPECIES_ORDER));
    const [form, setForm] = useState(() => pOneOf("fm", "total", ["total", "chilled", "frozen"]));

    const validDestLabels = useMemo(() => new Set(DEST_LIST.map((c) => DEST_LABEL_KO[c] || c)), [DEST_LIST]);
    const [destFilter, setDestFilter] = useState(() => pList("dest").filter((v) => validDestLabels.has(v)));
    const [yearFilter, setYearFilter] = useState(() => pList("yr").filter((v) => YEARS_ALL.includes(v)));
    const speciesRowsForRange = useMemo(() => ROWS.filter((r) => r.species === species), [ROWS, species]);
    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const set = new Set();
      speciesRowsForRange.forEach((r) => set.add(r.year * 100 + r.month));
      const all = [...set].sort((a, b) => a - b);
      return { ALL_YM: all, YM_MIN: all[0], YM_MAX: all[all.length - 1] };
    }, [speciesRowsForRange]);
    const ymLabel = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
    const [ymStart, setYmStart] = useState(() => pInt("ys", YM_MIN));
    const [ymEnd, setYmEnd] = useState(() => pInt("ye", YM_MAX));
    const onYmStart = (v) => { const val = +v; setYmStart(val); if (val > ymEnd) setYmEnd(val); };
    const onYmEnd = (v) => { const val = +v; setYmEnd(val); if (val < ymStart) setYmStart(val); };
    const clampMonth = (v, fallback) => (Number.isFinite(v) && v >= 1 && v <= 12 ? v : fallback);
    const [monthFrom, setMonthFrom] = useState(() => clampMonth(pInt("ms", 1), 1));
    const [monthTo, setMonthTo] = useState(() => clampMonth(pInt("me", 12), 12));
    const onMonthFrom = (v) => { const val = +v; setMonthFrom(val); if (val > monthTo) setMonthTo(val); };
    const onMonthTo = (v) => { const val = +v; setMonthTo(val); if (val < monthFrom) setMonthFrom(val); };

    const [rowDim, setRowDim] = useState(() => pOneOf("rd", "dest", ["dest", "year", "month", "yearMonth"]));
    const [colDim, setColDim] = useState(() => pOneOf("cd", "year", ["dest", "year", "month", "yearMonth"]));
    const [displayMode, setDisplayMode] = useState(() => pOneOf("dm", "abs", ["abs", "yoy"]));
    const [groupBy, setGroupBy] = useState(() => pOneOf("gb", "dest", ["dest", "year", "month"]));
    const [sortDesc, setSortDesc] = useState(true);
    const [smoothed, setSmoothed] = useState(() => p("sm", "0") === "1");

    const unitLabel = "톤";
    // 종별로 축종 먼저 걸러내고, 형태(합계/냉장/냉동)에 맞는 값을 뽑음
    const speciesRows = useMemo(() => ROWS.filter((r) => r.species === species), [ROWS, species]);
    const val = (r) => (form === "total" ? r.total : form === "chilled" ? r.chilled : r.frozen);

    const baseFilteredRows = useMemo(() => speciesRows.filter((r) => {
      if (destFilter.length && !destFilter.includes(DEST_LABEL_KO[r.dest] || r.dest)) return false;
      if (yearFilter.length && !yearFilter.includes(String(r.year))) return false;
      const ym = r.year * 100 + r.month;
      if (ymStart != null && ym < ymStart) return false;
      if (ymEnd != null && ym > ymEnd) return false;
      if (r.month < monthFrom || r.month > monthTo) return false;
      return true;
    }), [speciesRows, destFilter, yearFilter, ymStart, ymEnd, monthFrom, monthTo]);

    const grandTotalAll = useMemo(() => baseFilteredRows.reduce((s, r) => s + val(r), 0), [baseFilteredRows, form]);
    const toggleFilter = (list, setList, value) => setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

    function sortLabels(dimKey, labels, totalsMap) {
      if (dimKey === "year") return [...labels].sort((a, b) => +a - +b);
      if (dimKey === "month") return [...labels].sort((a, b) => monthNum(a) - monthNum(b));
      if (dimKey === "yearMonth") return [...labels].sort((a, b) => a.localeCompare(b));
      return [...labels].sort((a, b) => (totalsMap[b] || 0) - (totalsMap[a] || 0));
    }
    const { rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal } = useMemo(() => {
      const rowTotalsRaw = {}, colTotalsRaw = {};
      const matrix2 = {};
      let grandTotal2 = 0;
      baseFilteredRows.forEach((r) => {
        const rl = dimValue(r, rowDim), cl = dimValue(r, colDim), v = val(r);
        rowTotalsRaw[rl] = (rowTotalsRaw[rl] || 0) + v;
        colTotalsRaw[cl] = (colTotalsRaw[cl] || 0) + v;
        if (!matrix2[rl]) matrix2[rl] = {};
        matrix2[rl][cl] = (matrix2[rl][cl] || 0) + v;
        grandTotal2 += v;
      });
      return {
        rowLabels: sortLabels(rowDim, Object.keys(rowTotalsRaw), rowTotalsRaw),
        colLabels: sortLabels(colDim, Object.keys(colTotalsRaw), colTotalsRaw),
        matrix: matrix2, rowTotals: rowTotalsRaw, colTotals: colTotalsRaw, grandTotal: grandTotal2
      };
    }, [baseFilteredRows, rowDim, colDim, form]);

    function cellDisplay(rowLabel, colLabel, colIdx) {
      const val2 = (matrix[rowLabel] && matrix[rowLabel][colLabel]) || 0;
      if (displayMode === "abs") return { text: val2 ? n(val2) : "-", raw: val2 };
      const prevCol = colLabels[colIdx - 1];
      if (!prevCol) return { text: "—", raw: null };
      const prevVal = (matrix[rowLabel] && matrix[rowLabel][prevCol]) || 0;
      if (prevVal === 0) return { text: val2 > 0 ? "신규" : "—", raw: null };
      return { text: pct((val2 - prevVal) / prevVal * 100), raw: (val2 - prevVal) / prevVal * 100 };
    }
    const onRowDimChange = (v) => { if (v === colDim) setColDim(rowDim); setRowDim(v); };
    const onColDimChange = (v) => { if (v === rowDim) setRowDim(colDim); setColDim(v); };
    function exportTableXlsx() {
      const header = [DIM_LABEL[rowDim], ...colLabels, "총합계"];
      const body = rowLabels.map((rl) => [rl, ...colLabels.map((cl) => Math.round(((matrix[rl] && matrix[rl][cl]) || 0) * 10) / 10), Math.round(rowTotals[rl] * 10) / 10]);
      const footer = ["총합계", ...colLabels.map((cl) => Math.round((colTotals[cl] || 0) * 10) / 10), Math.round(grandTotal * 10) / 10];
      downloadXlsx([header, ...body, footer], `호주축산물_${SPECIES_LABEL_KO[species]}_${FORM_LABEL[form]}_${DIM_LABEL[rowDim]}x${DIM_LABEL[colDim]}.xlsx`, "피벗표");
    }

    const grouped = useMemo(() => {
      const map = new Map();
      baseFilteredRows.forEach((r) => { const key = dimValue(r, groupBy); map.set(key, (map.get(key) || 0) + val(r)); });
      let arr = [...map.entries()].map(([key, v]) => ({ key, v }));
      if (groupBy === "year") arr.sort((a, b) => +a.key - +b.key);
      else if (groupBy === "month") arr.sort((a, b) => monthNum(a.key) - monthNum(b.key));
      else if (groupBy === "yearMonth") arr.sort((a, b) => a.key.localeCompare(b.key));
      else arr.sort((a, b) => sortDesc ? b.v - a.v : a.v - b.v);
      return arr;
    }, [baseFilteredRows, groupBy, sortDesc, form]);
    const isTimeGroup = groupBy === "year" || groupBy === "month" || groupBy === "yearMonth";
    function exportGroupXlsx() {
      const header = [DIM_LABEL[groupBy], `${SPECIES_LABEL_KO[species]} ${FORM_LABEL[form]}(${unitLabel})`];
      const body = grouped.map((g) => [g.key, Math.round(g.v * 10) / 10]);
      downloadXlsx([header, ...body], `호주축산물_${SPECIES_LABEL_KO[species]}_${DIM_LABEL[groupBy]}별.xlsx`, "그룹비교");
    }

    const years = useMemo(() => [...new Set(baseFilteredRows.map((r) => r.year))].sort((a, b) => a - b), [baseFilteredRows]);

    /* ── 추이: 목적지별로 전체 기간을 하나로 이어붙인 연속 시계열 (이동평균 지원) ── */
    const trendCandidates = useMemo(() => {
      const totals = {};
      baseFilteredRows.forEach((r) => { const k = dimValue(r, "dest"); totals[k] = (totals[k] || 0) + val(r); });
      return Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    }, [baseFilteredRows, form]);
    const currentTrendList = trendCandidates.slice(0, 10);
    const trendXLabels = useMemo(() => {
      const labels = [];
      years.forEach((y) => {
        for (let m = monthFrom; m <= monthTo; m++) {
          const ym = y * 100 + m;
          if (ymStart != null && ym < ymStart) continue;
          if (ymEnd != null && ym > ymEnd) continue;
          labels.push(`${y}.${String(m).padStart(2, "0")}`);
        }
      });
      return labels;
    }, [years, monthFrom, monthTo, ymStart, ymEnd]);
    const trendSeries = useMemo(() => currentTrendList.map((v0, idx) => {
      const bucket = {};
      baseFilteredRows.forEach((r) => {
        if (dimValue(r, "dest") !== v0) return;
        const xVal = `${r.year}.${String(r.month).padStart(2, "0")}`;
        bucket[xVal] = (bucket[xVal] || 0) + val(r);
      });
      const raw = trendXLabels.map((x) => Math.round((bucket[x] || 0) * 10) / 10);
      return { name: v0 + (smoothed ? " (3개월 이동평균)" : ""), color: SERIES_PALETTE[idx % SERIES_PALETTE.length], data: smoothed ? movingAvg(raw, 3) : raw };
    }), [baseFilteredRows, currentTrendList, trendXLabels, form, smoothed]);
    function exportTrendXlsx() {
      const header = ["연월", ...currentTrendList];
      const body = trendXLabels.map((x, i) => [x, ...trendSeries.map((s) => s.data[i] != null ? s.data[i] : 0)]);
      downloadXlsx([header, ...body], `호주축산물_${SPECIES_LABEL_KO[species]}_추이${smoothed ? "_3개월이동평균" : ""}.xlsx`, "추이");
    }

    /* ── 겹쳐보기: 연도별로 접어서 1~12월 축 위에 겹쳐그림 (계절성 비교) ── */
    const overlayXLabels = useMemo(() => Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => `${monthFrom + i}월`), [monthFrom, monthTo]);
    const overlaySeries = useMemo(() => years.map((y, idx) => {
      const bucket = {};
      baseFilteredRows.forEach((r) => {
        if (r.year !== y) return;
        bucket[`${r.month}월`] = (bucket[`${r.month}월`] || 0) + val(r);
      });
      return { name: String(y), color: SERIES_PALETTE[idx % SERIES_PALETTE.length], data: overlayXLabels.map((x) => Math.round((bucket[x] || 0) * 10) / 10) };
    }), [baseFilteredRows, years, overlayXLabels, form]);
    function exportOverlayXlsx() {
      const header = ["월", ...years.map(String)];
      const body = overlayXLabels.map((x, i) => [x, ...overlaySeries.map((s) => s.data[i] != null ? s.data[i] : 0)]);
      downloadXlsx([header, ...body], `호주축산물_${SPECIES_LABEL_KO[species]}_연도별겹쳐보기.xlsx`, "겹쳐보기");
    }

    useEffect(() => {
      const sp = new URLSearchParams();
      if (destFilter.length) sp.set("dest", destFilter.join(","));
      if (yearFilter.length) sp.set("yr", yearFilter.join(","));
      if (ymStart != null) sp.set("ys", ymStart);
      if (ymEnd != null) sp.set("ye", ymEnd);
      if (monthFrom !== 1) sp.set("ms", monthFrom);
      if (monthTo !== 12) sp.set("me", monthTo);
      if (species !== "beef") sp.set("sp", species);
      if (form !== "total") sp.set("fm", form);
      sp.set("tab", mainTab);
      if (mainTab === "table") {
        sp.set("rd", rowDim); sp.set("cd", colDim);
        if (displayMode !== "abs") sp.set("dm", displayMode);
      } else {
        sp.set("csub", chartSub);
        if (chartSub === "group") sp.set("gb", groupBy);
        if (chartSub === "trend" && smoothed) sp.set("sm", "1");
      }
      const newSearch = "?" + sp.toString();
      if (newSearch !== window.location.search) window.history.replaceState(null, "", newSearch + window.location.hash);
    }, [destFilter, yearFilter, ymStart, ymEnd, monthFrom, monthTo, species, form, mainTab, rowDim, colDim, displayMode, chartSub, groupBy, smoothed]);

    const [linkCopied, setLinkCopied] = useState(false);
    function copyShareLink() {
      navigator.clipboard.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); }).catch(() => {});
    }

    const destOptions = DEST_LIST.map((c) => DEST_LABEL_KO[c] || c);
    const porkNoBreakdown = species === "pork" && form !== "total";

    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", color: COLORS.cream, fontFamily: "'Pretendard','Malgun Gothic','Noto Sans KR',sans-serif" } },
      React.createElement("div", { style: { maxWidth: 1120, margin: "0 auto" } },
        React.createElement("div", { style: { fontSize: 13.5, letterSpacing: "0.13em", color: COLORS.mute, fontWeight: 700, marginBottom: 4 } }, "호주 → 중국 · 일본 · 한국 · 미국 외 16개국"),
        React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 16px", letterSpacing: "-0.01em" } }, "호주 축산물 수출 현황"),

        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 10, alignItems: "center" } },
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            SPECIES_ORDER.map((sp) => React.createElement("button", {
              key: sp, onClick: () => setSpecies(sp),
              style: { padding: "7px 14px", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${sp === species ? COLORS.amber : COLORS.panelBorder}`,
                background: sp === species ? "rgba(217,139,63,0.14)" : COLORS.panel,
                color: sp === species ? COLORS.amber : COLORS.mute }
            }, SPECIES_LABEL_KO[sp]))
          ),
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            ["total", "chilled", "frozen"].map((k) => React.createElement("button", {
              key: k, onClick: () => setForm(k),
              style: { padding: "7px 14px", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${k === form ? COLORS.sage : COLORS.panelBorder}`,
                background: k === form ? "rgba(111,148,130,0.16)" : COLORS.panel,
                color: k === form ? COLORS.sage : COLORS.mute }
            }, FORM_LABEL[k]))
          )
        ),
        porkNoBreakdown && React.createElement("div", { style: { fontSize: 12.5, color: COLORS.rust, marginBottom: 10 } }, "* 돼지고기는 원본 통계에 냉장/냉동 구분이 없어 항상 0으로 표시됩니다. '합계'를 사용하세요."),

        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 } },
          React.createElement(HoverMultiPicker, { label: "목적지", options: destOptions, selected: destFilter, onToggle: (v) => toggleFilter(destFilter, setDestFilter, v), onSelectAll: () => setDestFilter([...destOptions]), onClear: () => setDestFilter([]) }),
          React.createElement(HoverMultiPicker, { label: "연도", options: [...YEARS_ALL].reverse(), selected: yearFilter, onToggle: (v) => toggleFilter(yearFilter, setYearFilter, v), onSelectAll: () => setYearFilter([...YEARS_ALL]), onClear: () => setYearFilter([]) })
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 } },
          React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, "기간"),
          ymStart != null && React.createElement(HoverAxisPicker, { label: "시작", value: ymStart, onChange: onYmStart, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
          React.createElement("span", { style: { color: COLORS.mute } }, "–"),
          ymEnd != null && React.createElement(HoverAxisPicker, { label: "종료", value: ymEnd, onChange: onYmEnd, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
          React.createElement("span", { style: { fontSize: 13, color: COLORS.mute, marginLeft: 10 } }, "월별"),
          React.createElement(HoverAxisPicker, { label: "시작월", value: monthFrom, onChange: onMonthFrom, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
          React.createElement("span", { style: { color: COLORS.mute } }, "–"),
          React.createElement(HoverAxisPicker, { label: "종료월", value: monthTo, onChange: onMonthTo, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
          (ymStart !== YM_MIN || ymEnd !== YM_MAX || monthFrom !== 1 || monthTo !== 12) && React.createElement("button", { onClick: () => { setYmStart(YM_MIN); setYmEnd(YM_MAX); setMonthFrom(1); setMonthTo(12); },
            style: { fontSize: 13, color: COLORS.mute, background: "none", border: `1px solid ${COLORS.panelBorder}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer" } }, "전체기간")
        ),

        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
          React.createElement("div", { style: { fontSize: 13, color: COLORS.mute } },
            `호주 ${SPECIES_LABEL_KO[species]}(${FORM_LABEL[form]})`,
            destFilter.length ? ` · 목적지 ${destFilter.length}개` : "",
            yearFilter.length ? ` · 연도 ${yearFilter.length}개` : "",
            ymStart != null ? ` · ${ymLabel(ymStart)}~${ymLabel(ymEnd)}` : "",
            (monthFrom !== 1 || monthTo !== 12) ? ` · ${monthFrom}월~${monthTo}월만` : ""
          ),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            React.createElement("button", { onClick: copyShareLink, style: { fontSize: 13, fontWeight: 700, color: linkCopied ? COLORS.sage : COLORS.mute, background: "none", border: `1px solid ${linkCopied ? COLORS.sage : COLORS.panelBorder}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" } }, linkCopied ? "✓ 복사됨" : "🔗 이 화면 링크 복사"),
            React.createElement("div", { style: { fontSize: 20, fontWeight: 800, color: COLORS.amber, fontFamily: "ui-monospace,monospace" } }, "합계 ", n(grandTotalAll), " ", unitLabel)
          )
        ),
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 14, textAlign: "right" } },
          "호주 DAFF Red meat export statistics · 사용자 수동 업로드 · ", db.collectedAt ? fmtUpdatedAt(db.collectedAt) + " 반영" : ""
        ),

        React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
          React.createElement(SheetTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" }),
          React.createElement(SheetTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" })
        ),

        mainTab === "table" && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
            React.createElement(HoverAxisPicker, { label: "행", value: rowDim, onChange: onRowDimChange, options: DIM_OPTIONS }),
            React.createElement(HoverAxisPicker, { label: "열", value: colDim, onChange: onColDimChange, options: DIM_OPTIONS }),
            React.createElement("div", { style: { display: "flex", gap: 4, marginLeft: "auto" } },
              React.createElement(ToggleBtn, { active: displayMode === "abs", onClick: () => setDisplayMode("abs"), label: `실수치(${unitLabel})` }),
              React.createElement(ToggleBtn, { active: displayMode === "yoy", onClick: () => setDisplayMode("yoy"), label: "전 열 대비 증감률" }),
              React.createElement("button", { onClick: exportTableXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "⬇ 엑셀 다운로드")
            )
          ),
          React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, overflow: "hidden" } },
            React.createElement("div", { style: { overflowX: "auto", maxHeight: 560, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 14.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { ...thStyle, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 108 } }, DIM_LABEL[rowDim]),
                  colLabels.map((cl) => React.createElement("th", { key: cl, style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 84 } }, cl)),
                  React.createElement("th", { style: { ...thStyle, position: "sticky", top: 0, right: 0, zIndex: 3, background: "#ede4d8", textAlign: "right", minWidth: 96, color: COLORS.amberSoft } }, "총합계")
                )),
                React.createElement("tbody", null, rowLabels.map((rl) => React.createElement("tr", { key: rl, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700, zIndex: 1 } }, rl),
                  colLabels.map((cl, ci) => {
                    const { text, raw } = cellDisplay(rl, cl, ci);
                    const color = displayMode === "yoy" ? (raw === null ? COLORS.mute : raw > 0 ? COLORS.sage : raw < 0 ? COLORS.rust : COLORS.mute) : COLORS.cream;
                    return React.createElement("td", { key: cl, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", color } }, text);
                  }),
                  React.createElement("td", { style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: COLORS.amberSoft, position: "sticky", right: 0, background: "#ede4d8" } }, n(rowTotals[rl]))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "총합계"),
                  colLabels.map((cl) => React.createElement("td", { key: cl, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amberSoft } }, n(colTotals[cl] || 0))),
                  React.createElement("td", { style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amber, position: "sticky", right: 0, background: "#ede4d8" } }, n(grandTotal))
                ))
              )
            )
          )
        ),

        mainTab === "chart" && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
            React.createElement(SubTab, { active: chartSub === "group", onClick: () => setChartSub("group"), label: "그룹 비교" }),
            React.createElement(SubTab, { active: chartSub === "trend", onClick: () => setChartSub("trend"), label: "추이" }),
            React.createElement(SubTab, { active: chartSub === "overlay", onClick: () => setChartSub("overlay"), label: "겹쳐보기" })
          ),
          chartSub === "group" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 } },
              React.createElement(HoverAxisPicker, { label: "기준", value: groupBy, onChange: setGroupBy, options: GROUP_DIM_OPTIONS }),
              React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } },
                !isTimeGroup && React.createElement("button", { onClick: () => setSortDesc(!sortDesc), style: { fontSize: 13.5, color: COLORS.mute, background: "none", border: "none", cursor: "pointer" } }, "⇅ ", sortDesc ? "내림차순" : "오름차순"),
                React.createElement("button", { onClick: exportGroupXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "⬇ 엑셀 다운로드")
              )
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "각 ", DIM_LABEL[groupBy], "의 총합을 비교합니다."),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(BarRanking, { items: grouped })
            )
          ),
          chartSub === "trend" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(ToggleBtn, { active: !smoothed, onClick: () => setSmoothed(false), label: "월별 원자료" }),
              React.createElement(ToggleBtn, { active: smoothed, onClick: () => setSmoothed(true), label: "3개월 이동평균" }),
              React.createElement("button", { onClick: exportTrendXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } },
              "* 전체 기간을 하나로 이어붙인 시계열입니다. 위쪽 목적지 필터에서 고른 항목이 그대로 표시됩니다", trendCandidates.length > 10 ? ` (상위 10개만 표시 중, 전체 ${trendCandidates.length}개)` : "", "."
            ),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(SvgLineChart, { categories: trendXLabels, series: trendSeries, height: 340 }),
              React.createElement(ChartLegend, { series: trendSeries })
            )
          ),
          chartSub === "overlay" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10, justifyContent: "flex-end" } },
              React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } },
              "* 연도별로 1~12월 축 위에 겹쳐서 계절 패턴을 비교합니다", years.length > 10 ? ` (최근 연도 순 상위 10개 표시)` : "", "."
            ),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(SvgLineChart, { categories: overlayXLabels, series: overlaySeries, height: 340 }),
              React.createElement(ChartLegend, { series: overlaySeries })
            )
          )
        ),
        React.createElement("p", { style: { fontSize: 12.5, color: COLORS.mute, marginTop: 14, lineHeight: 1.6 } }, "자료: 호주 DAFF(농림부) Red meat export statistics · 57 Destination Report. 사용자 수동 업로드로 갱신됩니다.")
      )
    );
  }

  return AusTradeApp;
})();
