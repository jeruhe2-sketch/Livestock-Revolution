/* 축산레이더 · 미국 축산물 내수 현황 / USDA AMS LM_PK602
   검역(QuarantineApp)·EU/USDA 수출현황(EuTradeApp/UsdaTradeApp)과 동일한 디자인 시스템을
   재사용함 (색상 팔레트, SvgLineChart, HoverAxisPicker, 스티키 표, URL 상태동기화, 링크복사).
   다만 이 데이터는 국가/부위 같은 다차원이 없는 "품목 3개 × 일별 가격" 단일 시계열이라
   행/열 자유선택 피벗 대신 "집계 단위(일/월/연) 선택"으로 단순화하고,
   원자재 가격 특성에 맞게 [추이(이동평균)] / [연도별 겹쳐보기(계절성)] 두 축으로 구성함. */
window.UsdaDomesticApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const COLORS = {
    bg: "#151312", panel: "#1d1a19", panelBorder: "#2b2624", panelBorder2: "#332c29",
    amber: "#d98b3f", amberSoft: "#e8b877", cream: "#f2ead9", mute: "#8f857a",
    sage: "#6f9482", rust: "#c2695f", head: "#141211"
  };
  const ITEMS = [
    { key: "Bnls CC Strap-off", label: "등심", color: COLORS.amber },
    { key: "Picnic Cushion Meat Vac", label: "전지", color: COLORS.sage },
    { key: "1/4 Trim Butt VAC", label: "목전지", color: "#4f8fb8" }
  ];
  const PERIOD_OPTIONS = [["3y", "3년"], ["2y", "2년"], ["1y", "1년"], ["6m", "6개월"], ["3m", "3개월"], ["all", "전체"]];
  const PERIOD_DAYS = { "3y": 1095, "2y": 730, "1y": 365, "6m": 180, "3m": 90, all: Infinity };
  const GRANULARITY_OPTIONS = [["day", "일별"], ["month", "월별"], ["year", "연도별"]];
  const CHG_LABEL = { day: "전일대비", month: "전월대비", year: "전년대비" };

  function money(v) { return v == null || !isFinite(v) ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
  function dateLabel(s) { return s ? String(s).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1.$2.$3") : "—"; }
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

  /* ── EU/USDA 앱과 동일한 라인차트(호버 툴팁 포함) ── */
  function SvgLineChart({ categories, series, height = 260, formatValue }) {
    const fmt = formatValue || ((v) => v == null ? "—" : v.toFixed(2));
    const width = 900;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 46 : 26, left: 52 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) : 1;
    const minVal = allVals.length ? Math.min(0, Math.min(...allVals) * 0.97) : 0;
    const span = Math.max(0.01, maxVal * 1.05 - minVal);
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v - minVal) / span * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = manyLabels ? Math.ceil(categories.length / 12) : 1;
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
          const val = maxVal * 1.05 - (maxVal * 1.05 - minVal) / gridLines * i;
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, `$${val.toFixed(2)}`)
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - 8, textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
        hoverIdx !== null && React.createElement("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: COLORS.amberSoft, strokeWidth: "1", strokeDasharray: "2 2" }),
        series.map((s) => {
          const segs = [];
          let cur = [];
          s.data.forEach((v, i) => {
            if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur); cur = []; } return; }
            cur.push(`${cur.length ? "L" : "M"}${xFor(i)},${yFor(v)}`);
          });
          if (cur.length) segs.push(cur);
          return React.createElement("g", { key: s.name },
            segs.map((seg, si) => React.createElement("path", { key: si, d: seg.join(" "), fill: "none", stroke: s.color, strokeWidth: "2.2", strokeDasharray: s.dashed ? "5 4" : undefined })),
            categories.length <= 60 && s.data.map((v, i) => v != null && isFinite(v) && React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v), r: i === hoverIdx ? 4 : 2, fill: s.color }))
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
          React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block", flexShrink: 0, opacity: s.dashed ? 0.6 : 1 } }),
          React.createElement("span", { style: { color: COLORS.cream } }, s.name),
          React.createElement("span", { style: { fontFamily: "ui-monospace,monospace", color: COLORS.amberSoft, marginLeft: "auto" } }, fmt(s.data[hoverIdx]))
        ))
      )
    );
  }
  function ChartLegend({ series }) {
    return React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8, paddingBottom: 4 } },
      series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: COLORS.cream } },
        React.createElement("span", { style: { width: 10, height: 3, borderRadius: 2, background: s.color, display: "inline-block", opacity: s.dashed ? 0.6 : 1 } }), s.name
      ))
    );
  }
  function SheetTab({ active, onClick, label }) {
    return React.createElement("button", { onClick, style: { padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", background: "none", border: "none", borderBottom: active ? `2px solid ${COLORS.amber}` : "2px solid transparent", color: active ? COLORS.amber : COLORS.mute, marginBottom: -1 } }, label);
  }
  function SubTab({ active, onClick, label }) {
    return React.createElement("button", { onClick, style: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.panelBorder}`, background: active ? "rgba(217,139,63,0.14)" : COLORS.panel, color: active ? COLORS.amber : COLORS.mute } }, label);
  }
  function ToggleBtn({ active, onClick, label, activeColor }) {
    const c = activeColor || COLORS.amber;
    return React.createElement("button", { onClick, style: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${active ? c : COLORS.panelBorder}`, background: active ? `${c}22` : COLORS.panel, color: active ? c : COLORS.mute } }, label);
  }
  function HoverAxisPicker({ label, value, onChange, options }) {
    const detailsRef = useRef(null);
    const found = options.find(([v]) => v === value);
    return React.createElement("details", { ref: detailsRef, style: { position: "relative", display: "inline-block" } },
      React.createElement("summary", { style: { display: "flex", alignItems: "center", gap: 6, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", listStyle: "none" } },
        React.createElement("span", { style: { fontSize: 11, color: COLORS.mute } }, label),
        React.createElement("span", { style: { fontSize: 12.5, fontWeight: 700, color: COLORS.amber } }, found ? found[1] : value),
        React.createElement("span", { style: { fontSize: 10, color: COLORS.mute } }, "▾")
      ),
      React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, zIndex: 20, background: "#141211", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 10, padding: 6, minWidth: 110, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" } },
        options.map(([v, l]) => React.createElement("button", { key: v, onClick: () => { onChange(v); if (detailsRef.current) detailsRef.current.open = false; },
          style: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 6, fontSize: 12.5, cursor: "pointer", border: "none", background: v === value ? "rgba(217,139,63,0.18)" : "transparent", color: v === value ? COLORS.amberSoft : COLORS.cream, whiteSpace: "nowrap" } }, l))
      )
    );
  }

  const thStyle = { textAlign: "left", padding: "8px 8px", fontSize: 10.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" };
  const tdStyle = { padding: "6px 8px", color: COLORS.cream };

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

  function Card({ item, cur, prev, week }) {
    const v = cur?.[item.key]?.usdPerLb;
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: "14px 16px" } },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, display: "flex", alignItems: "center", gap: 6 } },
        React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: item.color, display: "inline-block" } }), item.label
      ),
      React.createElement("div", { style: { fontSize: "clamp(20px,5vw,28px)", fontWeight: 800, color: COLORS.amberSoft, fontFamily: "ui-monospace,monospace", marginTop: 6 } }, v == null ? "—" : `${money(v)}/lb`),
      React.createElement("div", { style: { fontSize: 10, color: COLORS.mute, marginTop: 3 } }, v == null ? "데이터 없음" : `${money(v * 100)} / 100 lb · Wtd Avg`),
      React.createElement("div", { style: { display: "flex", gap: 12, marginTop: 9, fontSize: 10.5 } },
        React.createElement("span", { style: { color: COLORS.mute } }, "전일 ", React.createElement("b", { style: { color: COLORS.cream } }, pctFmt(v != null && prev?.[item.key]?.usdPerLb ? (v - prev[item.key].usdPerLb) / prev[item.key].usdPerLb * 100 : null))),
        React.createElement("span", { style: { color: COLORS.mute } }, "전주 ", React.createElement("b", { style: { color: COLORS.cream } }, pctFmt(v != null && week?.[item.key]?.usdPerLb ? (v - week[item.key].usdPerLb) / week[item.key].usdPerLb * 100 : null)))
      )
    );
  }

  function UsdaDomesticApp() {
    const [db, setDb] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      fetch("./data/usda_pork_domestic.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`데이터 파일을 불러오지 못했습니다 (${r.status})`);
        return r.json();
      }).then(setDb).catch((e) => setErr(e.message));
    }, []);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, err);
    if (!db) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, "데이터를 불러오는 중...");
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

    const ROWS = useMemo(() => [...(db.data || [])].sort((a, b) => a.date.localeCompare(b.date)), [db]);

    const initParams = useMemo(() => readParams(), []);
    const p = (k, f) => { const v = initParams.get(k); return v != null ? v : f; };
    const pOneOf = (k, f, valid) => { const v = p(k, f); return valid.includes(v) ? v : f; };
    const pList = (k, fallback) => { const v = initParams.get(k); return v ? v.split(",").filter(Boolean) : fallback; };

    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "chart", ["table", "chart"]));
    const [period, setPeriod] = useState(() => pOneOf("p", "1y", PERIOD_OPTIONS.map(([v]) => v)));
    const [itemFilter, setItemFilter] = useState(() => pList("it", ITEMS.map((i) => i.key)).filter((k) => ITEMS.some((i) => i.key === k)));
    const [granularity, setGranularity] = useState(() => pOneOf("gr", "day", ["day", "month", "year"]));
    const [displayMode, setDisplayMode] = useState(() => pOneOf("dm", "abs", ["abs", "chg"]));
    const [chartSub, setChartSub] = useState(() => pOneOf("csub", "trend", ["trend", "overlay"]));
    const [smoothed, setSmoothed] = useState(() => p("sm", "0") === "1");
    const [overlayItem, setOverlayItem] = useState(() => pOneOf("oi", ITEMS[0].key, ITEMS.map((i) => i.key)));

    const toggleItem = (key) => setItemFilter((cur) => cur.includes(key) ? (cur.length > 1 ? cur.filter((k) => k !== key) : cur) : [...cur, key]);

    const periodRows = useMemo(() => {
      const days = PERIOD_DAYS[period];
      return isFinite(days) ? ROWS.slice(-days) : ROWS;
    }, [ROWS, period]);

    /* ── 표: 일/월/연 집계 ── */
    const tableRows = useMemo(() => {
      if (granularity === "day") return periodRows.map((r) => ({ label: r.date, sortKey: r.date, vals: ITEMS.reduce((o, i) => (o[i.key] = r[i.key]?.usdPerLb ?? null, o), {}) }));
      const buckets = new Map();
      periodRows.forEach((r) => {
        const key = granularity === "month" ? r.date.slice(0, 7) : r.date.slice(0, 4);
        if (!buckets.has(key)) buckets.set(key, { sums: {}, counts: {} });
        const b = buckets.get(key);
        ITEMS.forEach((i) => {
          const v = r[i.key]?.usdPerLb;
          if (v != null && isFinite(v)) { b.sums[i.key] = (b.sums[i.key] || 0) + v; b.counts[i.key] = (b.counts[i.key] || 0) + 1; }
        });
      });
      return [...buckets.keys()].sort().map((key) => {
        const b = buckets.get(key);
        const vals = {};
        ITEMS.forEach((i) => { vals[i.key] = b.counts[i.key] ? b.sums[i.key] / b.counts[i.key] : null; });
        return { label: granularity === "month" ? key.replace("-", ".") : key, sortKey: key, vals };
      });
    }, [periodRows, granularity]);

    function cellDisplay(row, idx, key) {
      const v = tableRows[idx].vals[key];
      if (displayMode === "abs") return { text: money(v), raw: v };
      const prevRow = tableRows[idx - 1];
      const prevV = prevRow ? prevRow.vals[key] : null;
      if (v == null || prevV == null || prevV === 0) return { text: "—", raw: null };
      const chg = (v - prevV) / prevV * 100;
      return { text: pctFmt(chg), raw: chg };
    }
    const tableAvg = useMemo(() => {
      const avg = {};
      ITEMS.forEach((i) => {
        const vals = tableRows.map((r) => r.vals[i.key]).filter((v) => v != null && isFinite(v));
        avg[i.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return avg;
    }, [tableRows]);
    function exportTableXlsx() {
      const header = [granularity === "day" ? "발표일" : granularity === "month" ? "연월" : "연도", ...ITEMS.map((i) => `${i.label} ($/lb)`)];
      const body = tableRows.map((r) => [r.label, ...ITEMS.map((i) => r.vals[i.key] != null ? Math.round(r.vals[i.key] * 10000) / 10000 : "")]);
      const footer = ["기간평균", ...ITEMS.map((i) => tableAvg[i.key] != null ? Math.round(tableAvg[i.key] * 10000) / 10000 : "")];
      downloadXlsx([header, ...body, footer], `미국축산물내수현황_${granularity}_${period}.xlsx`, "표");
    }

    /* ── 차트: 추이(이동평균) ── */
    const trendCategories = useMemo(() => periodRows.map((r) => r.date), [periodRows]);
    const trendSeries = useMemo(() => {
      const out = [];
      ITEMS.filter((i) => itemFilter.includes(i.key)).forEach((i) => {
        const raw = periodRows.map((r) => r[i.key]?.usdPerLb ?? null);
        if (smoothed) out.push({ name: `${i.label} (7일 이동평균)`, color: i.color, data: movingAvg(raw, 7) });
        else out.push({ name: i.label, color: i.color, data: raw });
      });
      return out;
    }, [periodRows, itemFilter, smoothed]);
    function exportTrendXlsx() {
      const header = ["발표일", ...trendSeries.map((s) => s.name)];
      const body = trendCategories.map((c, i) => [c, ...trendSeries.map((s) => s.data[i] != null ? Math.round(s.data[i] * 10000) / 10000 : "")]);
      downloadXlsx([header, ...body], `미국축산물내수현황_추이_${period}.xlsx`, "추이");
    }

    /* ── 차트: 연도별 겹쳐보기(계절성) ── 선택한 품목 하나를 연도별 월평균으로 겹쳐서 계절 패턴/연도비교 ── */
    const overlayYears = useMemo(() => [...new Set(periodRows.map((r) => r.date.slice(0, 4)))].sort(), [periodRows]);
    const overlaySeries = useMemo(() => {
      const palette = ["#d98b3f", "#6f9482", "#4f8fb8", "#b0a25c", "#a06a9c", "#c2695f"];
      return overlayYears.map((y, idx) => {
        const monthSums = Array(12).fill(0), monthCounts = Array(12).fill(0);
        periodRows.forEach((r) => {
          if (!r.date.startsWith(y)) return;
          const m = parseInt(r.date.slice(5, 7), 10) - 1;
          const v = r[overlayItem]?.usdPerLb;
          if (v != null && isFinite(v)) { monthSums[m] += v; monthCounts[m]++; }
        });
        return { name: y, color: palette[idx % palette.length], data: monthSums.map((s, i) => monthCounts[i] ? s / monthCounts[i] : null) };
      });
    }, [periodRows, overlayYears, overlayItem]);
    const overlayCategories = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    function exportOverlayXlsx() {
      const header = ["월", ...overlaySeries.map((s) => s.name)];
      const body = overlayCategories.map((c, i) => [c, ...overlaySeries.map((s) => s.data[i] != null ? Math.round(s.data[i] * 10000) / 10000 : "")]);
      const itemLabel = ITEMS.find((i) => i.key === overlayItem)?.label || overlayItem;
      downloadXlsx([header, ...body], `미국축산물내수현황_${itemLabel}_연도별겹쳐보기.xlsx`, "겹쳐보기");
    }

    /* ── URL 상태 동기화 ── */
    useEffect(() => {
      const sp = new URLSearchParams();
      sp.set("tab", mainTab);
      if (period !== "1y") sp.set("p", period);
      if (itemFilter.length !== ITEMS.length) sp.set("it", itemFilter.join(","));
      if (mainTab === "table") {
        if (granularity !== "day") sp.set("gr", granularity);
        if (displayMode !== "abs") sp.set("dm", displayMode);
      } else {
        sp.set("csub", chartSub);
        if (chartSub === "trend" && smoothed) sp.set("sm", "1");
        if (chartSub === "overlay") sp.set("oi", overlayItem);
      }
      const newSearch = "?" + sp.toString();
      if (newSearch !== window.location.search) window.history.replaceState(null, "", newSearch);
    }, [mainTab, period, itemFilter, granularity, displayMode, chartSub, smoothed, overlayItem]);

    const [linkCopied, setLinkCopied] = useState(false);
    function copyShareLink() {
      navigator.clipboard.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); }).catch(() => {});
    }

    const cur = ROWS[ROWS.length - 1], prev = ROWS[ROWS.length - 2], weekAgo = ROWS[Math.max(0, ROWS.length - 6)];

    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", color: COLORS.cream, fontFamily: "'Pretendard','Malgun Gothic','Noto Sans KR',sans-serif" } },
      React.createElement("div", { style: { maxWidth: 1120, margin: "0 auto" } },
        React.createElement("div", { style: { fontSize: 11.5, letterSpacing: "0.13em", color: COLORS.mute, fontWeight: 700, marginBottom: 4 } }, "USDA AMS · LM_PK602 · NATIONAL DAILY PORK FOB PLANT"),
        React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em" } }, "미국 축산물 내수 현황"),
        React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginBottom: 14 } }, "돼지고기 주요 부위 협상가(Wtd Avg) · 등심 / 전지 / 목전지"),

        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginBottom: 12 } },
          ITEMS.map((i) => React.createElement(Card, { key: i.key, item: i, cur, prev, week: weekAgo }))
        ),

        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
          React.createElement("span", { style: { fontSize: 11, color: COLORS.mute } }, "기간"),
          PERIOD_OPTIONS.map(([v, l]) => React.createElement(ToggleBtn, { key: v, active: period === v, onClick: () => setPeriod(v), label: l })),
          React.createElement("span", { style: { fontSize: 11, color: COLORS.mute, marginLeft: 8 } }, "표시 품목"),
          ITEMS.map((i) => React.createElement(ToggleBtn, { key: i.key, active: itemFilter.includes(i.key), onClick: () => toggleItem(i.key), label: i.label, activeColor: i.color }))
        ),

        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
          React.createElement("div", { style: { fontSize: 11, color: COLORS.mute } },
            `최근 발표 ${dateLabel(cur?.date)} · 데이터 ${dateLabel(db.period?.start)} ~ ${dateLabel(db.period?.end)} · 표시 품목 ${itemFilter.length}개`
          ),
          React.createElement("button", { onClick: copyShareLink, style: { fontSize: 11, fontWeight: 700, color: linkCopied ? COLORS.sage : COLORS.mute, background: "none", border: `1px solid ${linkCopied ? COLORS.sage : COLORS.panelBorder}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" } }, linkCopied ? "✓ 복사됨" : "🔗 이 화면 링크 복사")
        ),

        React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
          React.createElement(SheetTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
          React.createElement(SheetTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" })
        ),

        mainTab === "chart" && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
            React.createElement(SubTab, { active: chartSub === "trend", onClick: () => setChartSub("trend"), label: "추이" }),
            React.createElement(SubTab, { active: chartSub === "overlay", onClick: () => setChartSub("overlay"), label: "연도별 겹쳐보기" })
          ),
          chartSub === "trend" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(ToggleBtn, { active: !smoothed, onClick: () => setSmoothed(false), label: "일별 원자료" }),
              React.createElement(ToggleBtn, { active: smoothed, onClick: () => setSmoothed(true), label: "7일 이동평균" }),
              React.createElement("button", { onClick: exportTrendXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16 } },
              trendSeries.length
                ? React.createElement(React.Fragment, null, React.createElement(SvgLineChart, { categories: trendCategories, series: trendSeries, height: 300 }), React.createElement(ChartLegend, { series: trendSeries }))
                : React.createElement("div", { style: { padding: 40, textAlign: "center", color: COLORS.mute } }, "표시할 품목을 하나 이상 선택하세요.")
            ),
            React.createElement("div", { style: { fontSize: 10.5, color: COLORS.mute, marginTop: 10 } }, "※ USDA 원자료 Wtd Avg는 $/100 lb입니다. 예: $145.00/100 lb = $1.45/lb.")
          ),
          chartSub === "overlay" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(HoverAxisPicker, { label: "품목", value: overlayItem, onChange: setOverlayItem, options: ITEMS.map((i) => [i.key, i.label]) }),
              React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 10.5, color: COLORS.mute, marginBottom: 10 } }, "* 위쪽 기간 필터 안에 포함된 연도들을 월별 평균으로 겹쳐서 계절 패턴과 연도별 가격 수준을 비교합니다."),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16 } },
              React.createElement(SvgLineChart, { categories: overlayCategories, series: overlaySeries, height: 300 }),
              React.createElement(ChartLegend, { series: overlaySeries })
            )
          )
        ),

        mainTab === "table" && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
            React.createElement(HoverAxisPicker, { label: "단위", value: granularity, onChange: setGranularity, options: GRANULARITY_OPTIONS }),
            React.createElement("div", { style: { display: "flex", gap: 4, marginLeft: "auto" } },
              React.createElement(ToggleBtn, { active: displayMode === "abs", onClick: () => setDisplayMode("abs"), label: "실수치($/lb)" }),
              React.createElement(ToggleBtn, { active: displayMode === "chg", onClick: () => setDisplayMode("chg"), label: CHG_LABEL[granularity] }),
              React.createElement("button", { onClick: exportTableXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "⬇ 엑셀 다운로드")
            )
          ),
          React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, overflow: "hidden" } },
            React.createElement("div", { style: { overflowX: "auto", maxHeight: 560, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 12.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { ...thStyle, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 92 } }, granularity === "day" ? "발표일" : granularity === "month" ? "연월" : "연도"),
                  ITEMS.map((i) => React.createElement("th", { key: i.key, style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 96 } }, `${i.label} ($/lb)`))
                )),
                React.createElement("tbody", null, tableRows.map((r, idx) => React.createElement("tr", { key: r.sortKey, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700, zIndex: 1 } }, r.label),
                  ITEMS.map((i) => {
                    const { text, raw } = cellDisplay(r, idx, i.key);
                    const color = displayMode === "chg" ? (raw === null ? COLORS.mute : raw > 0 ? COLORS.sage : raw < 0 ? COLORS.rust : COLORS.mute) : COLORS.cream;
                    return React.createElement("td", { key: i.key, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", color } }, text);
                  })
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: "#1a1613", fontWeight: 800 } }, "기간평균"),
                  ITEMS.map((i) => React.createElement("td", { key: i.key, style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amberSoft } }, money(tableAvg[i.key])))
                ))
              )
            )
          )
        ),

        React.createElement("div", { style: { marginTop: 16, paddingTop: 10, borderTop: `1px solid ${COLORS.panelBorder}`, fontSize: 10.5, color: COLORS.mute, lineHeight: 1.7 } },
          "자료: USDA Agricultural Marketing Service · LMR Datamart (Slug ID 2498 / LM_PK602) · National Daily Pork FOB Plant - Negotiated Sales - Afternoon"
        )
      )
    );
  }

  return UsdaDomesticApp;
})();
