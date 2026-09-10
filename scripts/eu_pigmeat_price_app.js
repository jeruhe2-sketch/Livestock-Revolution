/* 축산레이더 · EU 돈가(도체) 현황 (v3)
   기존 "유럽산 돈육 수출 현황"(EuTradeApp/Dashboard, index.html 560~1322행)과
   완전히 동일한 컴포넌트/구조를 그대로 이식함:
     - SheetTab(표/차트) · SubTab(그룹비교/추이/겹쳐보기)
     - HoverAxisPicker(단일선택 드롭다운) · HoverMultiPicker(다중선택 드롭다운)
     - 호버 툴팁 SvgLineChart · BarRanking · ChartLegend
     - 피벗표(행×열 차원 선택, 실수치/증감률 토글, 엑셀 다운로드)
     - URL 상태동기화 + 링크복사
   차이점(가격 데이터라 구조상 안 맞는 부분만 뺌):
     - kg/유로/단가 3종 값 대신 "가격(€/100kg)" 단일값 (모든 집계는 합계가 아니라 평균)
     - 수입국(partner) 없음 → "재배분" 탭 없음, "수출국" 자리는 EU 27개국+EU평균("국가")
     - 등급(S/E) 선택이 새로 추가됨

   데이터: data/eu_pigmeat_price.json (매주 GitHub Actions가 집행위 공개 API로 자동 수집,
   LLM/수동작업 없음. scripts/fetch_eu_pigmeat_price.py 참고) */
window.EuPigmeatPriceApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const { COLORS, SheetTab, SubTab, ToggleBtn, HoverAxisPicker, HoverMultiPicker, SvgLineChart, ChartLegend, BarRanking, fmtUpdatedAt, downloadXlsx } = window.RadarUI;
  const pct = window.RadarUI.pctFmt;
  const SERIES_PALETTE = ["#b96a2e", "#3f7d64", "#2f6f96", "#8a7d3a", "#7d4f79", "#a34a3f", "#6b5a8f", "#3f8768", "#b8763e", "#5580a8"];
  const DIM_LABEL = { ms: "국가", cls: "등급", year: "연도", month: "월", yearMonth: "연월", week: "주차" };
  const DIM_OPTIONS = [["ms", "국가"], ["cls", "등급"], ["year", "연도"], ["month", "월"], ["yearMonth", "연월"], ["week", "주차"]];
  const GROUP_DIM_OPTIONS = [["ms", "국가"], ["year", "연도"], ["month", "월"]]; // 연월/주차/등급은 막대비교엔 항목이 안 맞아서 제외

  function n2(v) { return v == null || !isFinite(v) ? "—" : Math.round(v * 100) / 100; }
  function fmtEur(v) { return v == null || !isFinite(v) ? "—" : `€${Number(v).toFixed(2)}`; }
  function fmtShort(v) { return v == null || !isFinite(v) ? "—" : `€${Math.round(v)}`; }
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
  function addYm(ym, delta) {
    let y = Math.floor(ym / 100), m = ym % 100;
    m += delta;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y * 100 + m;
  }
  function readParams() { return new URLSearchParams(window.location.search); }
  function isoWeek1Monday(year) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    jan4.setUTCDate(jan4.getUTCDate() - (dow - 1));
    return jan4;
  }
  function weekMonday(year, week) { return new Date(isoWeek1Monday(year).getTime() + (week - 1) * 7 * 86400000); }
  function weekToMonth(year, week) {
    const monday = weekMonday(year, week);
    const counts = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      const k = d.getUTCMonth() + 1;
      counts[k] = (counts[k] || 0) + 1;
    }
    return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /* ── EU 수출현황과 동일한 호버 툴팁 라인차트 ── */

  const thStyle = { textAlign: "left", padding: "10px 10px", fontSize: 12.5, color: "#5b615c", fontWeight: 700, borderBottom: "1px solid #d7dad4", whiteSpace: "nowrap" };
  const tdStyle = { padding: "9px 10px", color: "#1f2420" };

  function Dashboard({ raw }) {
    useEffect(() => {
      const onDocClick = (e) => {
        document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
      };
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }, []);

    const msNames = raw.msNames || {};
    const MS_LIST = useMemo(() => Object.keys(msNames).sort((a, b) => (a === "EU" ? -1 : b === "EU" ? 1 : msNames[a].localeCompare(msNames[b]))), [msNames]);

    const ROWS = useMemo(() => raw.data.map(([year, week, cls, msCode, price]) => ({
      year, week, month: weekToMonth(year, week), cls, msCode, price
    })), [raw]);

    function dimValue(r, dimKey) {
      if (dimKey === "ms") return msNames[r.msCode] || r.msCode;
      if (dimKey === "cls") return r.cls === "S" ? "S(최상급)" : "E(우수)";
      if (dimKey === "year") return String(r.year);
      if (dimKey === "yearMonth") return `${r.year}-${String(r.month).padStart(2, "0")}`;
      if (dimKey === "week") return `${r.year}-W${String(r.week).padStart(2, "0")}(${r.month}월)`;
      return `${r.month}월`;
    }
    function monthNum(label) { return parseInt(label, 10); }
    function aggregateGroup(rows) {
      // 가격 데이터는 항상 평균 (물량처럼 합산하면 의미가 없음)
      if (!rows.length) return 0;
      return rows.reduce((s, r) => s + r.price, 0) / rows.length;
    }

    const initParams = useMemo(() => readParams(), []);
    const p = (key, fallback) => { const v = initParams.get(key); return v != null ? v : fallback; };
    const pOneOf = (key, fallback, validValues) => { const v = p(key, fallback); return validValues.includes(v) ? v : fallback; };
    const pList = (key) => { const v = initParams.get(key); return v ? v.split(",").filter(Boolean) : []; };
    const pInt = (key, fallback) => { const v = initParams.get(key); const n3 = parseInt(v, 10); return Number.isFinite(n3) ? n3 : fallback; };

    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "table", ["table", "chart"]));
    const [chartSub, setChartSub] = useState(() => pOneOf("csub", "trend", ["group", "trend", "overlay"]));
    const [msFilter, setMsFilter] = useState(() => pList("ms"));
    const [clsFilter, setClsFilter] = useState(() => pOneOf("cls", "ALL", ["ALL", "S", "E"]));
    const [yearFilter, setYearFilter] = useState(() => pList("yr"));

    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const set = new Set();
      ROWS.forEach((r) => set.add(r.year * 100 + r.month));
      const all = [...set].sort((a, b) => a - b);
      return { ALL_YM: all, YM_MIN: all[0], YM_MAX: all[all.length - 1] };
    }, [ROWS]);
    const ymLabel = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
    const [ymStart, setYmStart] = useState(() => pInt("ys", YM_MIN));
    const [ymEnd, setYmEnd] = useState(() => pInt("ye", YM_MAX));
    const onYmStart = (v) => { const val = +v; setYmStart(val); if (val > ymEnd) setYmEnd(val); };
    const onYmEnd = (v) => { const val = +v; setYmEnd(val); if (val < ymStart) setYmStart(val); };
    const [monthFrom, setMonthFrom] = useState(() => pInt("mf", 1));
    const [monthTo, setMonthTo] = useState(() => pInt("mt", 12));
    const onMonthFrom = (v) => { const val = +v; setMonthFrom(val); if (val > monthTo) setMonthTo(val); };
    const onMonthTo = (v) => { const val = +v; setMonthTo(val); if (val < monthFrom) setMonthFrom(val); };

    const [rowDim, setRowDim] = useState(() => pOneOf("rd", "ms", ["ms", "cls", "year", "month", "yearMonth", "week"]));
    const [colDim, setColDim] = useState(() => pOneOf("cd", "year", ["ms", "cls", "year", "month", "yearMonth", "week"]));
    const [displayMode, setDisplayMode] = useState(() => pOneOf("dm", "abs", ["abs", "yoy"]));
    const [groupBy, setGroupBy] = useState(() => pOneOf("gb", "ms", ["ms", "year", "month"]));
    const [sortDesc, setSortDesc] = useState(true);
    const [smoothed, setSmoothed] = useState(() => p("sm", "0") === "1");

    const baseFilteredRows = useMemo(() => ROWS.filter((r) => {
      if (msFilter.length && !msFilter.includes(msNames[r.msCode])) return false;
      if (clsFilter !== "ALL" && r.cls !== clsFilter) return false;
      if (yearFilter.length && !yearFilter.includes(String(r.year))) return false;
      const ym = r.year * 100 + r.month;
      if (ymStart != null && ym < ymStart) return false;
      if (ymEnd != null && ym > ymEnd) return false;
      if (r.month < monthFrom || r.month > monthTo) return false;
      return true;
    }), [ROWS, msFilter, clsFilter, yearFilter, ymStart, ymEnd, monthFrom, monthTo, msNames]);

    const years = useMemo(() => [...new Set(baseFilteredRows.map((r) => r.year))].sort((a, b) => a - b), [baseFilteredRows]);
    const grandAvgAll = useMemo(() => aggregateGroup(baseFilteredRows), [baseFilteredRows]);
    const toggleFilter = (list, setList, value) => setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

    function sortLabels(dimKey, labels, totalsMap) {
      if (dimKey === "year") return [...labels].sort((a, b) => +a - +b);
      if (dimKey === "month") return [...labels].sort((a, b) => monthNum(a) - monthNum(b));
      if (dimKey === "yearMonth" || dimKey === "week") return [...labels].sort((a, b) => a.localeCompare(b));
      if (dimKey === "cls") return [...labels].sort((a, b) => a.localeCompare(b));
      return [...labels].sort((a, b) => (totalsMap[b] || 0) - (totalsMap[a] || 0));
    }
    const { rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal } = useMemo(() => {
      const rowBuckets = {}, colBuckets = {}, cellBuckets = {};
      baseFilteredRows.forEach((r) => {
        const rl = dimValue(r, rowDim), cl = dimValue(r, colDim);
        (rowBuckets[rl] || (rowBuckets[rl] = [])).push(r);
        (colBuckets[cl] || (colBuckets[cl] = [])).push(r);
        if (!cellBuckets[rl]) cellBuckets[rl] = {};
        (cellBuckets[rl][cl] || (cellBuckets[rl][cl] = [])).push(r);
      });
      const rowTotalsRaw = {}, colTotalsRaw = {}, matrix2 = {};
      Object.keys(rowBuckets).forEach((rl) => { rowTotalsRaw[rl] = aggregateGroup(rowBuckets[rl]); });
      Object.keys(colBuckets).forEach((cl) => { colTotalsRaw[cl] = aggregateGroup(colBuckets[cl]); });
      Object.keys(cellBuckets).forEach((rl) => {
        matrix2[rl] = {};
        Object.keys(cellBuckets[rl]).forEach((cl) => { matrix2[rl][cl] = aggregateGroup(cellBuckets[rl][cl]); });
      });
      const grandTotal2 = aggregateGroup(baseFilteredRows);
      return {
        rowLabels: sortLabels(rowDim, Object.keys(rowTotalsRaw), rowTotalsRaw),
        colLabels: sortLabels(colDim, Object.keys(colTotalsRaw), colTotalsRaw),
        matrix: matrix2, rowTotals: rowTotalsRaw, colTotals: colTotalsRaw, grandTotal: grandTotal2
      };
    }, [baseFilteredRows, rowDim, colDim]);

    function cellDisplay(rowLabel, colLabel, colIdx) {
      const val2 = (matrix[rowLabel] && matrix[rowLabel][colLabel]) || 0;
      if (displayMode === "abs") return { text: val2 ? fmtEur(val2) : "—", raw: val2 };
      const prevCol = colLabels[colIdx - 1];
      if (!prevCol) return { text: "—", raw: null };
      const prevVal = (matrix[rowLabel] && matrix[rowLabel][prevCol]) || 0;
      if (prevVal === 0) return { text: val2 > 0 ? "신규" : "—", raw: null };
      return { text: pct((val2 - prevVal) / prevVal * 100), raw: (val2 - prevVal) / prevVal * 100 };
    }
    const onRowDimChange = (v) => { if (v === colDim) setColDim(rowDim); setRowDim(v); };
    const onColDimChange = (v) => { if (v === rowDim) setRowDim(colDim); setColDim(v); };
    function exportTableXlsx() {
      const header = [DIM_LABEL[rowDim], ...colLabels, "평균"];
      const body = rowLabels.map((rl) => [rl, ...colLabels.map((cl) => n2((matrix[rl] && matrix[rl][cl]) || 0)), n2(rowTotals[rl])]);
      const footer = ["전체 평균", ...colLabels.map((cl) => n2(colTotals[cl] || 0)), n2(grandTotal)];
      downloadXlsx([header, ...body, footer], `EU돈가_${DIM_LABEL[rowDim]}x${DIM_LABEL[colDim]}.xlsx`, "피벗표");
    }

    const grouped = useMemo(() => {
      const map = new Map();
      baseFilteredRows.forEach((r) => {
        const key = dimValue(r, groupBy);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      });
      let arr = [...map.entries()].map(([key, rows]) => ({ key, v: aggregateGroup(rows) }));
      if (groupBy === "year") arr.sort((a, b) => +a.key - +b.key);
      else if (groupBy === "month") arr.sort((a, b) => monthNum(a.key) - monthNum(b.key));
      else arr.sort((a, b) => sortDesc ? b.v - a.v : a.v - b.v);
      return arr;
    }, [baseFilteredRows, groupBy, sortDesc]);
    const isTimeGroup = groupBy === "year" || groupBy === "month";
    function exportGroupXlsx() {
      const header = [DIM_LABEL[groupBy], "평균가격(€/100kg)"];
      downloadXlsx([header, ...grouped.map((g) => [g.key, n2(g.v)])], `EU돈가_${DIM_LABEL[groupBy]}별.xlsx`, "그룹비교");
    }

    /* ── 추이 ── */
    const [trendDim, setTrendDim] = useState(() => pOneOf("td", "ms", ["ms", "cls"]));
    const trendCandidates = useMemo(() => {
      const totals = {};
      baseFilteredRows.forEach((r) => { const k = dimValue(r, trendDim); (totals[k] = totals[k] || []).push(r.price); });
      return Object.keys(totals).sort((a, b) => {
        const avgB = totals[b].reduce((s, v) => s + v, 0) / totals[b].length;
        const avgA = totals[a].reduce((s, v) => s + v, 0) / totals[a].length;
        return avgB - avgA;
      });
    }, [trendDim, baseFilteredRows]);
    const currentTrendList = trendCandidates.slice(0, 10);
    const trendXLabels = useMemo(() => {
      const labels = [];
      years.forEach((y) => { for (let m = monthFrom; m <= monthTo; m++) { const ym = y * 100 + m; if (ymStart != null && ym < ymStart) continue; if (ymEnd != null && ym > ymEnd) continue; labels.push(`${y}.${String(m).padStart(2, "0")}`); } });
      return labels;
    }, [years, monthFrom, monthTo, ymStart, ymEnd]);
    const trendSeries = useMemo(() => currentTrendList.map((v0, idx) => {
      const bucket = {};
      baseFilteredRows.forEach((r) => {
        if (dimValue(r, trendDim) !== v0) return;
        const xVal = `${r.year}.${String(r.month).padStart(2, "0")}`;
        (bucket[xVal] || (bucket[xVal] = [])).push(r);
      });
      const rawArr = trendXLabels.map((x) => bucket[x] ? Math.round(aggregateGroup(bucket[x]) * 100) / 100 : null);
      return { name: v0 + (smoothed ? " (3개월 이동평균)" : ""), color: SERIES_PALETTE[idx % SERIES_PALETTE.length], data: smoothed ? movingAvg(rawArr, 3) : rawArr };
    }), [baseFilteredRows, trendDim, currentTrendList, trendXLabels, smoothed]);
    function exportTrendXlsx() {
      const header = ["연월", ...currentTrendList];
      downloadXlsx([header, ...trendXLabels.map((x, i) => [x, ...trendSeries.map((s) => s.data[i] != null ? s.data[i] : "")])], `EU돈가_${DIM_LABEL[trendDim]}별_추이${smoothed ? "_3개월이동평균" : ""}.xlsx`, "추이");
    }

    /* ── 겹쳐보기 ── */
    const overlayXLabels = useMemo(() => Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => `${monthFrom + i}월`), [monthFrom, monthTo]);
    const overlaySeries = useMemo(() => years.map((y, idx) => {
      const bucket = {};
      baseFilteredRows.forEach((r) => { if (r.year !== y) return; const xVal = `${r.month}월`; (bucket[xVal] || (bucket[xVal] = [])).push(r); });
      return { name: String(y), color: SERIES_PALETTE[idx % SERIES_PALETTE.length], data: overlayXLabels.map((x) => bucket[x] ? Math.round(aggregateGroup(bucket[x]) * 100) / 100 : null) };
    }), [baseFilteredRows, years, overlayXLabels]);
    function exportOverlayXlsx() {
      const header = ["월", ...years.map(String)];
      downloadXlsx([header, ...overlayXLabels.map((x, i) => [x, ...overlaySeries.map((s) => s.data[i] != null ? s.data[i] : "")])], `EU돈가_연도별겹쳐보기.xlsx`, "겹쳐보기");
    }

    useEffect(() => {
      const sp = new URLSearchParams();
      if (msFilter.length) sp.set("ms", msFilter.join(","));
      if (clsFilter !== "ALL") sp.set("cls", clsFilter);
      if (yearFilter.length) sp.set("yr", yearFilter.join(","));
      if (ymStart != null) sp.set("ys", ymStart);
      if (ymEnd != null) sp.set("ye", ymEnd);
      if (monthFrom !== 1) sp.set("mf", monthFrom);
      if (monthTo !== 12) sp.set("mt", monthTo);
      sp.set("tab", mainTab);
      if (mainTab === "table") { sp.set("rd", rowDim); sp.set("cd", colDim); if (displayMode !== "abs") sp.set("dm", displayMode); }
      else { sp.set("csub", chartSub); if (chartSub === "group") sp.set("gb", groupBy); if (chartSub === "trend") { sp.set("td", trendDim); if (smoothed) sp.set("sm", "1"); } }
      const newSearch = "?" + sp.toString();
      if (newSearch !== window.location.search) window.history.replaceState(null, "", newSearch);
    }, [msFilter, clsFilter, yearFilter, ymStart, ymEnd, monthFrom, monthTo, mainTab, rowDim, colDim, displayMode, chartSub, groupBy, trendDim, smoothed]);

    const [linkCopied, setLinkCopied] = useState(false);
    function copyShareLink() {
      navigator.clipboard?.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); }).catch(() => {});
    }

    const msOptions = MS_LIST.map((c) => msNames[c]);

    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", color: COLORS.cream, fontFamily: "'Pretendard','Malgun Gothic','Noto Sans KR',sans-serif" } },
      React.createElement("div", { style: { maxWidth: 1120, margin: "0 auto" } },
        React.createElement("div", { style: { fontSize: 13.5, letterSpacing: "0.13em", color: COLORS.mute, fontWeight: 700, marginBottom: 4 } }, "EU 27개 회원국 + EU 평균"),
        fmtUpdatedAt(raw.collectedAt) && React.createElement("div", { style: { fontSize: 12.5, color: COLORS.amberSoft, fontWeight: 700, marginBottom: 4 } }, `\u25CF ${fmtUpdatedAt(raw.collectedAt)} 기준`),
        React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 16px", letterSpacing: "-0.01em" } }, "EU 축산물 내수현황"),

        React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 } },
          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "등급"),
            React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              ["ALL", "S", "E"].map((k) => React.createElement("button", {
                key: k, onClick: () => setClsFilter(k),
                style: { padding: "7px 14px", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${k === clsFilter ? COLORS.amber : COLORS.panelBorder}`,
                  background: k === clsFilter ? "rgba(217,139,63,0.14)" : COLORS.panel,
                  color: k === clsFilter ? COLORS.amber : COLORS.mute }
              }, k === "ALL" ? "전체 등급" : k === "S" ? "S(최상급)" : "E(우수)"))
            )
          ),

          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "국가 · 연도"),
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
              React.createElement(HoverMultiPicker, { label: "국가", options: msOptions, selected: msFilter, onToggle: (v) => toggleFilter(msFilter, setMsFilter, v), onSelectAll: () => setMsFilter([...msOptions]), onClear: () => setMsFilter([]) }),
              React.createElement(HoverMultiPicker, { label: "연도", options: [...new Set(ROWS.map((r) => String(r.year)))].sort().reverse(), selected: yearFilter, onToggle: (v) => toggleFilter(yearFilter, setYearFilter, v), onSelectAll: () => setYearFilter([...new Set(ROWS.map((r) => String(r.year)))]), onClear: () => setYearFilter([]) }),
              (mainTab !== "table" || chartSub !== "trend" || msFilter.length > 0 || clsFilter !== "ALL" || yearFilter.length > 0 || ymStart !== YM_MIN || ymEnd !== YM_MAX || monthFrom !== 1 || monthTo !== 12 || rowDim !== "ms" || colDim !== "year" || displayMode !== "abs" || groupBy !== "ms" || !sortDesc || smoothed || trendDim !== "ms") && React.createElement("button", {
                onClick: () => {
                  setMainTab("table"); setChartSub("trend");
                  setMsFilter([]); setClsFilter("ALL"); setYearFilter([]);
                  setYmStart(YM_MIN); setYmEnd(YM_MAX); setMonthFrom(1); setMonthTo(12);
                  setRowDim("ms"); setColDim("year"); setDisplayMode("abs"); setGroupBy("ms");
                  setSortDesc(true); setSmoothed(false); setTrendDim("ms");
                },
                style: { fontSize: 13, color: COLORS.rust, background: "none", border: `1px solid ${COLORS.rust}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 700 }
              }, "필터 초기화")
            )
          ),

          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "기간"),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
              React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
                [["3", "최근 3개월"], ["6", "최근 6개월"], ["12", "최근 1년"]].map(([m, lbl]) => React.createElement(ToggleBtn, {
                  key: m, active: ymEnd === YM_MAX && ymStart === addYm(YM_MAX, -(Number(m) - 1)),
                  onClick: () => { setYmEnd(YM_MAX); setYmStart(addYm(YM_MAX, -(Number(m) - 1))); }, label: lbl
                })),
                ymStart != null && React.createElement(HoverAxisPicker, { label: "시작", value: ymStart, onChange: onYmStart, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
                React.createElement("span", { style: { color: COLORS.mute } }, "–"),
                ymEnd != null && React.createElement(HoverAxisPicker, { label: "종료", value: ymEnd, onChange: onYmEnd, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) })
              ),
              React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
                React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, "월별"),
                React.createElement(HoverAxisPicker, { label: "시작월", value: monthFrom, onChange: onMonthFrom, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
                React.createElement("span", { style: { color: COLORS.mute } }, "–"),
                React.createElement(HoverAxisPicker, { label: "종료월", value: monthTo, onChange: onMonthTo, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
                (ymStart !== YM_MIN || ymEnd !== YM_MAX || monthFrom !== 1 || monthTo !== 12) && React.createElement("button", { onClick: () => { setYmStart(YM_MIN); setYmEnd(YM_MAX); setMonthFrom(1); setMonthTo(12); },
                  style: { fontSize: 13, color: COLORS.mute, background: "none", border: `1px solid ${COLORS.panelBorder}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer" } }, "전체기간")
              )
            )
          )
        ),

        React.createElement("div", { style: { background: COLORS.panel, borderLeft: `3px solid ${COLORS.amber}`, borderRadius: "4px 10px 10px 4px", boxShadow: "0 1px 3px rgba(31,36,32,0.06)", padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
          React.createElement("div", { style: { fontSize: 13, color: COLORS.mute } },
            "EU 돈가", msFilter.length ? ` · 국가 ${msFilter.length}개` : "", clsFilter !== "ALL" ? ` · ${clsFilter}등급` : "",
            yearFilter.length ? ` · 연도 ${yearFilter.length}개` : "", ymStart != null ? ` · ${ymLabel(ymStart)}~${ymLabel(ymEnd)}` : "",
            (monthFrom !== 1 || monthTo !== 12) ? ` · ${monthFrom}월~${monthTo}월만` : ""
          ),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            React.createElement("button", { onClick: copyShareLink, style: { fontSize: 13, fontWeight: 700, color: linkCopied ? COLORS.sage : COLORS.mute, background: "none", border: `1px solid ${linkCopied ? COLORS.sage : COLORS.panelBorder}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" } }, linkCopied ? "\u2713 복사됨" : "이 화면 링크 복사"),
            React.createElement("div", { style: { fontSize: 22, fontWeight: 800, color: COLORS.cream, fontFamily: "ui-monospace,monospace" } }, "평균 ", fmtEur(grandAvgAll))
          )
        ),
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 14, textAlign: "right" } }, raw.sourceMostRecentData ? `집행위 Agri-food Data Portal 주간 자료 · ${raw.sourceMostRecentData} 기준` : ""),

        React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
          React.createElement(SheetTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" }),
          React.createElement(SheetTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" })
        ),

        mainTab === "table" && React.createElement(React.Fragment, null,
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
            React.createElement(HoverAxisPicker, { label: "행", value: rowDim, onChange: onRowDimChange, options: DIM_OPTIONS }),
            React.createElement(HoverAxisPicker, { label: "열", value: colDim, onChange: onColDimChange, options: DIM_OPTIONS }),
            React.createElement("div", { style: { display: "flex", gap: 4, marginLeft: "auto" } },
              React.createElement(ToggleBtn, { active: displayMode === "abs", onClick: () => setDisplayMode("abs"), label: "실수치(€/100kg)" }),
              React.createElement(ToggleBtn, { active: displayMode === "yoy", onClick: () => setDisplayMode("yoy"), label: "전 열 대비 증감률" }),
              React.createElement("button", { onClick: exportTableXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "\u2B07 엑셀 다운로드")
            )
          ),
          React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, overflow: "hidden" } },
            React.createElement("div", { style: { overflowX: "auto", maxHeight: 560, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 14.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { ...thStyle, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 108 } }, DIM_LABEL[rowDim]),
                  colLabels.map((cl) => React.createElement("th", { key: cl, style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 84 } }, cl)),
                  React.createElement("th", { className: "stick-r", style: { ...thStyle, position: "sticky", top: 0, right: 0, zIndex: 3, background: "#ede4d8", textAlign: "right", minWidth: 96, color: COLORS.amberSoft } }, "평균")
                )),
                React.createElement("tbody", null, rowLabels.map((rl) => React.createElement("tr", { key: rl, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700, zIndex: 1 } }, rl),
                  colLabels.map((cl, ci) => {
                    const { text, raw: rawV } = cellDisplay(rl, cl, ci);
                    const color = displayMode === "yoy" ? (rawV === null ? COLORS.mute : rawV > 0 ? COLORS.rust : rawV < 0 ? "#3a6ea5" : COLORS.mute) : COLORS.cream;
                    return React.createElement("td", { key: cl, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", color } }, text);
                  }),
                  React.createElement("td", { className: "stick-r", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: COLORS.amberSoft, position: "sticky", right: 0, background: "#ede4d8" } }, fmtEur(rowTotals[rl]))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "전체 평균"),
                  colLabels.map((cl) => React.createElement("td", { key: cl, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amberSoft } }, fmtEur(colTotals[cl] || 0))),
                  React.createElement("td", { className: "stick-r", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amber, position: "sticky", right: 0, background: "#ede4d8" } }, fmtEur(grandTotal))
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
                !isTimeGroup && React.createElement("button", { onClick: () => setSortDesc(!sortDesc), style: { fontSize: 13.5, color: COLORS.mute, background: "none", border: "none", cursor: "pointer" } }, "\u21C5 ", sortDesc ? "내림차순" : "오름차순"),
                React.createElement("button", { onClick: exportGroupXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "\u2B07 엑셀 다운로드")
              )
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "각 ", DIM_LABEL[groupBy], "의 평균가격을 비교합니다."),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(BarRanking, { items: grouped, formatValue: fmtEur })
            )
          ),
          chartSub === "trend" && React.createElement(React.Fragment, null,
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(HoverAxisPicker, { label: "기준", value: trendDim, onChange: setTrendDim, options: [["ms", "국가"], ["cls", "등급"]] }),
              React.createElement(ToggleBtn, { active: !smoothed, onClick: () => setSmoothed(false), label: "원자료" }),
              React.createElement(ToggleBtn, { active: smoothed, onClick: () => setSmoothed(true), label: "3개월 이동평균" }),
              React.createElement("button", { onClick: exportTrendXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "\u2B07 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } },
              "* 전체 기간을 하나로 이어붙인 시계열입니다. 위쪽 ", DIM_LABEL[trendDim], " 필터에서 고른 항목이 그대로 표시됩니다", trendCandidates.length > 10 ? ` (평균가 상위 10개만 표시 중, 전체 ${trendCandidates.length}개)` : "", "."
            ),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(SvgLineChart, { categories: trendXLabels, series: trendSeries, height: 340, formatAxisValue: fmtShort, formatTooltipValue: fmtEur }),
              React.createElement(ChartLegend, { series: trendSeries })
            )
          ),
          chartSub === "overlay" && React.createElement(React.Fragment, null,
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10, justifyContent: "flex-end" } },
              React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "\u2B07 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "* 연도별로 1~12월 축 위에 겹쳐서 계절 패턴을 비교합니다 (현재 필터된 국가/등급 평균)."),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "16px" } },
              React.createElement(SvgLineChart, { categories: overlayXLabels, series: overlaySeries, height: 340, formatAxisValue: fmtShort, formatTooltipValue: fmtEur }),
              React.createElement(ChartLegend, { series: overlaySeries })
            )
          )
        ),
        React.createElement("p", { style: { fontSize: 12.5, color: COLORS.mute, marginTop: 14, lineHeight: 1.6 } }, "매주 자동 갱신됩니다.")
      )
    );
  }

  return function EuPigmeatPriceApp() {
    const [raw, setRaw] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      fetch("./data/eu_pigmeat_price.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("데이터 파일을 불러오지 못했습니다 (" + r.status + ")");
        return r.json();
      }).then(setRaw).catch((e) => setErr(e.message));
    }, []);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 } }, err);
    if (!raw) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 } }, "데이터를 불러오는 중...");
    return React.createElement(Dashboard, { raw });
  };
})();
