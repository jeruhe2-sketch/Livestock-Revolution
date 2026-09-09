/* 축산레이더 · 미국 축산물 내수 현황 / USDA AMS LM_PK602
   검역(QuarantineApp)·EU/USDA 수출현황(EuTradeApp/UsdaTradeApp)과 동일한 디자인 시스템을
   재사용함 (색상 팔레트, SvgLineChart, HoverAxisPicker, 스티키 표, URL 상태동기화, 링크복사).
   다만 이 데이터는 국가/부위 같은 다차원이 없는 "품목 3개 × 일별 가격" 단일 시계열이라
   행/열 자유선택 피벗 대신 "집계 단위(일/월/연) 선택"으로 단순화하고,
   원자재 가격 특성에 맞게 [추이(이동평균)] / [연도별 겹쳐보기(계절성)] 두 축으로 구성함. */
window.UsdaDomesticApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const { COLORS, SheetTab, SubTab, ToggleBtn, HoverAxisPicker, SvgLineChart, ChartLegend, fmtUpdatedAt, pctFmt, downloadXlsx, useIsMobile } = window.RadarUI;
  const ITEMS = [
    { key: "Bnls CC Strap-off", label: "등심", color: COLORS.amber },
    { key: "Picnic Cushion Meat Vac", label: "전지", color: COLORS.sage },
    { key: "1/4 Trim Bnls Butt VAC", label: "목전지", color: "#2f6f96" },
    { key: "PorkCutout", label: "돈육 컷아웃", color: "#8a5a30" },
    { key: "BeefChoiceCutout", label: "소고기 Choice 컷아웃", color: "#a34a3f" },
    { key: "BeefSelectCutout", label: "소고기 Select 컷아웃", color: "#6b5ca5" }
  ];
  const KG_PER_LB = 0.45359237;
  const lbToKg = (v) => v == null || !isFinite(v) ? null : v / KG_PER_LB;
  const GRANULARITY_OPTIONS = [["day", "일별"], ["month", "월별"], ["year", "연도별"]];
  const CHG_LABEL = { day: "전일대비", month: "전월대비", year: "전년대비" };
  function ymLabel(ym) { return `${Math.floor(ym / 100)}년 ${ym % 100}월`; }

  function money(v) { return v == null || !isFinite(v) ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function dateLabel(s) { return s ? String(s).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1.$2.$3") : "—"; }
  const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
  // 일별 표/카드에서 "2026-09-08"만 보고는 무슨 요일인지 감이 안 왔던 것 보정.
  // "9월 8일 (화)" 처럼 사람이 바로 읽히는 형태로. 연도가 올해와 다를 때만 연도를 붙임.
  const THIS_YEAR = new Date().getFullYear();
  function dayLabel(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    const wd = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${y !== THIS_YEAR ? y + "년 " : ""}${m}월 ${d}일 (${wd})`;
  }
  function monthGroupLabel(iso) {
    const [y, m] = iso.split("-").map(Number);
    return `${y}년 ${m}월`;
  }

  function readParams() { return new URLSearchParams(window.location.search); }

  /* ── EU/USDA 앱과 동일한 라인차트(호버 툴팁 포함) ── */
  const thStyle = { textAlign: "left", padding: "10px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" };
  const tdStyle = { padding: "9px 10px", color: COLORS.cream };

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

  function Card({ item, latestRow, latestDate, isStale, prevVal, weekVal, monthVal, yearVal }) {
    const v = latestRow?.[item.key]?.usdPerLb;
    const chgs = [
      ["전일", v != null && prevVal ? (v - prevVal) / prevVal * 100 : null],
      ["전주", v != null && weekVal ? (v - weekVal) / weekVal * 100 : null],
      ["전월", v != null && monthVal ? (v - monthVal) / monthVal * 100 : null],
      ["전년", v != null && yearVal ? (v - yearVal) / yearVal * 100 : null]
    ];
    const arrow = (chg) => chg == null ? "" : chg > 0 ? "▲ " : chg < 0 ? "▼ " : "";
    const chgColor = (chg) => chg == null ? COLORS.mute : chg > 0 ? COLORS.rust : chg < 0 ? "#3a6ea5" : COLORS.mute;
    return React.createElement("div", { style: { background: COLORS.panel, borderLeft: `3px solid ${item.color}`, borderRadius: "4px 10px 10px 4px", padding: "13px 16px", boxShadow: "0 1px 3px rgba(31,36,32,0.06)" } },
      React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: COLORS.mute } }, item.label),
      React.createElement("div", { style: { fontSize: "clamp(21px,5.5vw,29px)", fontWeight: 800, color: COLORS.cream, fontFamily: "ui-monospace,monospace", marginTop: 4, letterSpacing: "-0.01em" } }, v == null ? "—" : `${money(v)}/lb`),
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginTop: 2 } },
        v == null ? "데이터 없음" : `${money(lbToKg(v))}/kg · Wtd Avg`,
        isStale && v != null && React.createElement("span", { style: { color: COLORS.rust, fontWeight: 700 } }, ` · ${dateLabel(latestDate)} 기준`)
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 14px", marginTop: 9, fontSize: 12.5 } },
        chgs.map(([label, chg]) => React.createElement("span", { key: label, style: { color: COLORS.mute } }, label + " ",
          React.createElement("b", { style: { color: chgColor(chg) } }, arrow(chg), pctFmt(chg))
        ))
      )
    );
  }

  // 모바일용: 가로로 12개+ 열이 늘어서는 표 대신, 날짜 하나당 카드 하나로 세로 나열.
  // 각 카드 안에서 품목별로 한 줄씩 - lb 단가를 크게, kg 환산은 옅게 보조로만.
  function MobileTableCard({ row, idx, visibleItems, isLatest, cellDisplay, lbToKg, money, displayMode }) {
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${isLatest ? COLORS.amber : COLORS.panelBorder}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 } },
      React.createElement("div", { style: { fontSize: 13.5, fontWeight: 800, color: isLatest ? COLORS.amberSoft : COLORS.cream, marginBottom: 8 } }, row.label, isLatest ? " · 최신" : ""),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } },
        visibleItems.map((i) => {
          const { text, raw } = cellDisplay(idx, i.key);
          const color = displayMode === "chg" ? (raw === null ? COLORS.mute : raw > 0 ? COLORS.sage : raw < 0 ? COLORS.rust : COLORS.mute) : COLORS.cream;
          const v = row.vals[i.key];
          const kgText = displayMode === "abs" ? money(lbToKg(v)) : null;
          return React.createElement("div", { key: i.key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: COLORS.mute, minWidth: 0 } },
              React.createElement("span", { style: { width: 7, height: 7, borderRadius: 2, background: i.color, display: "inline-block", flexShrink: 0 } }),
              React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, i.label)
            ),
            React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
              React.createElement("div", { style: { fontSize: 14.5, fontWeight: 700, fontFamily: "ui-monospace,monospace", color } }, text),
              kgText && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, fontFamily: "ui-monospace,monospace" } }, kgText, "/kg")
            )
          );
        })
      )
    );
  }

  function UsdaDomesticApp() {
    const [db, setDb] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      Promise.all([
        fetch("./data/usda_pork_domestic.json", { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error(`데이터 파일을 불러오지 못했습니다 (${r.status})`);
          return r.json();
        }),
        fetch("./data/usda_cutout.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([dbData, cutoutData]) => {
        // 컷아웃(종합가)을 부위별 가격과 완전히 같은 행 구조(row[품목키] = {usdPerLb})로
        // 병합해서 아래 표/차트/추이/연도별겹쳐보기 로직을 손댈 필요 없이 그대로 재사용함.
        // (원자료는 $/cwt라 100으로 나눠서 $/lb로 맞춤 - 1 cwt = 100 lb)
        const byDate = {};
        (dbData.data || []).forEach((r) => { byDate[r.date] = { ...r }; });
        (cutoutData?.pork?.data || []).forEach((r) => {
          if (r.value == null) return;
          (byDate[r.date] = byDate[r.date] || { date: r.date }).PorkCutout = { label: "돈육 컷아웃", usdPerLb: r.value / 100 };
        });
        (cutoutData?.beef?.data || []).forEach((r) => {
          const row = (byDate[r.date] = byDate[r.date] || { date: r.date });
          if (r.choice != null) row.BeefChoiceCutout = { label: "소고기 Choice 컷아웃", usdPerLb: r.choice / 100 };
          if (r.select != null) row.BeefSelectCutout = { label: "소고기 Select 컷아웃", usdPerLb: r.select / 100 };
        });
        setDb({ ...dbData, data: Object.values(byDate) });
      }).catch((e) => setErr(e.message));
    }, []);
    if (err) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.rust, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 } }, err);
    if (!db) return React.createElement("div", { style: { background: COLORS.bg, color: COLORS.mute, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 } }, "데이터를 불러오는 중...");
    return React.createElement(Dashboard, { db });
  }

  function Dashboard({ db }) {
    const isMobile = useIsMobile();
    useEffect(() => {
      const onDocClick = (e) => {
        document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
      };
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }, []);

    const ROWS = useMemo(() => [...(db.data || [])].sort((a, b) => a.date.localeCompare(b.date)), [db]);
    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const set = new Set();
      ROWS.forEach((r) => { const [y, m] = r.date.split("-").map(Number); set.add(y * 100 + m); });
      const all = [...set].sort((a, b) => a - b);
      return { ALL_YM: all, YM_MIN: all[0], YM_MAX: all[all.length - 1] };
    }, [ROWS]);

    const initParams = useMemo(() => readParams(), []);
    const p = (k, f) => { const v = initParams.get(k); return v != null ? v : f; };
    const pOneOf = (k, f, valid) => { const v = p(k, f); return valid.includes(v) ? v : f; };
    const pList = (k, fallback) => { const v = initParams.get(k); return v ? v.split(",").filter(Boolean) : fallback; };
    const pInt = (k, f) => { const v = initParams.get(k); const n2 = parseInt(v, 10); return Number.isFinite(n2) ? n2 : f; };

    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "chart", ["table", "chart"]));
    // 기본값을 "전부 다"로 두면 돼지고기 부위($1~1.5대)랑 소고기 컷아웃($3~4대)이
    // 스케일이 완전히 달라서 한 차트에 겹쳐 그리면 알아보기 힘든 뒤죽박죽이 됨.
    // 처음엔 등심 하나만 보여주고, 비교하고 싶은 품목은 사용자가 직접 추가하게 함.
    const [itemFilter, setItemFilter] = useState(() => {
      const fromUrl = pList("it", null);
      if (fromUrl) return fromUrl.filter((k) => ITEMS.some((i) => i.key === k));
      return [ITEMS[0].key];
    });
    const [granularity, setGranularity] = useState(() => pOneOf("gr", "day", ["day", "month", "year"]));
    const [displayMode, setDisplayMode] = useState(() => pOneOf("dm", "abs", ["abs", "chg"]));
    const [chartSub, setChartSub] = useState(() => pOneOf("csub", "trend", ["trend", "overlay"]));
    const [smoothed, setSmoothed] = useState(() => p("sm", "0") === "1");
    const [overlayItem, setOverlayItem] = useState(() => pOneOf("oi", ITEMS[0].key, ITEMS.map((i) => i.key)));

    // 기간선택: 검역/EU/USDA 수출현황과 동일하게 "연월 범위 + 월별(계절) 범위" 방식.
    const [ymStart, setYmStart] = useState(() => pInt("ys", YM_MIN));
    const [ymEnd, setYmEnd] = useState(() => pInt("ye", YM_MAX));
    const [monthFrom, setMonthFrom] = useState(() => pInt("ms", 1));
    const [monthTo, setMonthTo] = useState(() => pInt("me", 12));
    const onYmStart = (v) => { const val = +v; setYmStart(val); if (val > ymEnd) setYmEnd(val); };
    const onYmEnd = (v) => { const val = +v; setYmEnd(val); if (val < ymStart) setYmStart(val); };
    const onMonthFrom = (v) => { const val = +v; setMonthFrom(val); if (val > monthTo) setMonthTo(val); };
    const onMonthTo = (v) => { const val = +v; setMonthTo(val); if (val < monthFrom) setMonthFrom(val); };

    const toggleItem = (key) => setItemFilter((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
    const visibleItems = useMemo(() => ITEMS.filter((i) => itemFilter.includes(i.key)), [itemFilter]);

    const periodRows = useMemo(() => {
      return ROWS.filter((r) => {
        const [y, m] = r.date.split("-").map(Number);
        const ym = y * 100 + m;
        if (ym < ymStart || ym > ymEnd) return false;
        if (m < monthFrom || m > monthTo) return false;
        return true;
      });
    }, [ROWS, ymStart, ymEnd, monthFrom, monthTo]);

    /* ── 표: 일/월/연 집계 ── */
    const tableRows = useMemo(() => {
      if (granularity === "day") return periodRows.map((r) => ({ label: dayLabel(r.date), sortKey: r.date, vals: ITEMS.reduce((o, i) => (o[i.key] = r[i.key]?.usdPerLb ?? null, o), {}) }));
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

    function cellDisplay(idx, key) {
      const v = tableRows[idx].vals[key];
      if (displayMode === "abs") return { text: money(v), raw: v };
      const prevRow = tableRows[idx - 1];
      const prevV = prevRow ? prevRow.vals[key] : null;
      if (v == null || prevV == null || prevV === 0) return { text: "—", raw: null };
      const chg = (v - prevV) / prevV * 100;
      const arrow = chg > 0.05 ? "▲ " : chg < -0.05 ? "▼ " : "";
      return { text: `${arrow}${pctFmt(chg)}`, raw: chg };
    }
    // 계산(전일·전월·전년대비)은 예전→최근 순서가 있어야 하므로 tableRows 자체는 오름차순 유지하고,
    // 화면에는 최신이 위로 오게 인덱스만 뒤집어서 렌더링함.
    const displayIdxs = useMemo(() => tableRows.map((_, i) => i).reverse(), [tableRows]);
    const tableAvg = useMemo(() => {
      const avg = {};
      ITEMS.forEach((i) => {
        const vals = tableRows.map((r) => r.vals[i.key]).filter((v) => v != null && isFinite(v));
        avg[i.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return avg;
    }, [tableRows]);
    function exportTableXlsx() {
      const header = [granularity === "day" ? "발표일" : granularity === "month" ? "연월" : "연도", ...visibleItems.flatMap((i) => [`${i.label} ($/lb)`, `${i.label} ($/kg)`])];
      const body = [...tableRows].reverse().map((r) => [r.label, ...visibleItems.flatMap((i) => {
        const v = r.vals[i.key];
        return [v != null ? Math.round(v * 10000) / 10000 : "", v != null ? Math.round(lbToKg(v) * 10000) / 10000 : ""];
      })]);
      const footer = ["기간평균", ...visibleItems.flatMap((i) => {
        const v = tableAvg[i.key];
        return [v != null ? Math.round(v * 10000) / 10000 : "", v != null ? Math.round(lbToKg(v) * 10000) / 10000 : ""];
      })];
      downloadXlsx([header, ...body, footer], `미국축산물내수현황_${granularity}_${ymStart}-${ymEnd}.xlsx`, "표");
    }

    /* ── 차트: 추이(이동평균) ── */
    const trendCategories = useMemo(() => periodRows.map((r) => r.date), [periodRows]);
    const trendSeries = useMemo(() => {
      const out = [];
      visibleItems.forEach((i) => {
        const raw = periodRows.map((r) => r[i.key]?.usdPerLb ?? null);
        if (smoothed) out.push({ name: `${i.label} (7일 이동평균)`, color: i.color, data: movingAvg(raw, 7) });
        else out.push({ name: i.label, color: i.color, data: raw });
      });
      return out;
    }, [periodRows, visibleItems, smoothed]);
    function exportTrendXlsx() {
      const header = ["발표일", ...trendSeries.map((s) => s.name)];
      const body = trendCategories.map((c, i) => [c, ...trendSeries.map((s) => s.data[i] != null ? Math.round(s.data[i] * 10000) / 10000 : "")]);
      downloadXlsx([header, ...body], `미국축산물내수현황_추이_${ymStart}-${ymEnd}.xlsx`, "추이");
    }

    /* ── 차트: 연도별 겹쳐보기(계절성) ── 선택한 품목 하나를 연도별 월평균으로 겹쳐서 계절 패턴/연도비교 ── */
    const overlayYears = useMemo(() => [...new Set(periodRows.map((r) => r.date.slice(0, 4)))].sort(), [periodRows]);
    const overlaySeries = useMemo(() => {
      const palette = ["#b96a2e", "#2e7d4f", "#2f6f96", "#8a7d3a", "#7d4f79", "#a34a3f"];
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
      if (ymStart !== YM_MIN) sp.set("ys", ymStart);
      if (ymEnd !== YM_MAX) sp.set("ye", ymEnd);
      if (monthFrom !== 1) sp.set("ms", monthFrom);
      if (monthTo !== 12) sp.set("me", monthTo);
      if (itemFilter.length !== 1 || itemFilter[0] !== ITEMS[0].key) sp.set("it", itemFilter.join(","));
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
    }, [mainTab, ymStart, ymEnd, monthFrom, monthTo, itemFilter, granularity, displayMode, chartSub, smoothed, overlayItem]);

    const [linkCopied, setLinkCopied] = useState(false);
    function copyShareLink() {
      navigator.clipboard.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); }).catch(() => {});
    }

    const cur = ROWS[ROWS.length - 1];
    // 품목마다 실제 발표 주기가 달라서(돼지고기 부위는 매일, 소고기 컷아웃은 주간 리포트라 며칠 지연됨)
    // 전체 중 "가장 최근 날짜" 한 곳만 보고 카드를 채우면 늦게 발표되는 품목은 항상 빈 값으로 보임.
    // 품목별로 자기 자신의 값이 실제로 있는 가장 최근 지점을 따로 찾아서 보여줌.
    function findLatest(key) {
      // 날짜 기준으로 "그날 또는 그 이전 중 가장 가까운" 값을 찾음 - 매일 발표 안 되는
      // 품목(소고기 컷아웃 등)도 정확하게 몇 주/몇 달 전 값과 비교되게 함.
      function valueNearDate(beforeIdx, daysAgo) {
        const target = new Date(ROWS[beforeIdx].date + "T00:00:00Z");
        target.setUTCDate(target.getUTCDate() - daysAgo);
        const targetIso = target.toISOString().slice(0, 10);
        for (let j = beforeIdx - 1; j >= 0; j--) {
          if (ROWS[j].date <= targetIso && ROWS[j][key]?.usdPerLb != null) return ROWS[j][key].usdPerLb;
        }
        return null;
      }
      for (let idx = ROWS.length - 1; idx >= 0; idx--) {
        if (ROWS[idx]?.[key]?.usdPerLb != null) {
          let prevVal = null;
          for (let j = idx - 1; j >= 0; j--) {
            if (ROWS[j]?.[key]?.usdPerLb != null) { prevVal = ROWS[j][key].usdPerLb; break; }
          }
          return {
            row: ROWS[idx], date: ROWS[idx].date, prevVal,
            weekVal: valueNearDate(idx, 7), monthVal: valueNearDate(idx, 30), yearVal: valueNearDate(idx, 365)
          };
        }
      }
      return { row: null, date: null, prevVal: null, weekVal: null, monthVal: null, yearVal: null };
    }

    return React.createElement("div", { style: { background: COLORS.bg, minHeight: "100vh", padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", color: COLORS.cream, fontFamily: "'Pretendard','Malgun Gothic','Noto Sans KR',sans-serif" } },
      React.createElement("div", { style: { maxWidth: 1120, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em" } }, "미국 축산물 내수현황"),
        React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 14 } }, "돼지고기 주요 부위 협상가(Wtd Avg) · 등심 / 전지 / 목전지"),
        fmtUpdatedAt(db.collectedAt) && React.createElement("div", { style: { fontSize: 12.5, color: COLORS.amberSoft, fontWeight: 700, marginBottom: 14 } }, `\u25CF ${fmtUpdatedAt(db.collectedAt)} 기준`),

        React.createElement("div", { style: { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: 8, marginBottom: 12 } },
          ITEMS.map((i) => {
            const latest = findLatest(i.key);
            return React.createElement(Card, {
              key: i.key, item: i, latestRow: latest.row, latestDate: latest.date,
              isStale: latest.date != null && latest.date !== cur?.date,
              prevVal: latest.prevVal, weekVal: latest.weekVal, monthVal: latest.monthVal, yearVal: latest.yearVal
            });
          })
        ),

        React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "14px 16px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 12 } },
          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 6 } }, "품목"),
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
              ITEMS.map((i) => React.createElement(ToggleBtn, { key: i.key, active: itemFilter.includes(i.key), onClick: () => toggleItem(i.key), label: i.label, activeColor: i.color }))
            )
          ),
          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 6 } }, "기간"),
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
              React.createElement(HoverAxisPicker, { label: "시작", value: ymStart, onChange: onYmStart, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
              React.createElement("span", { style: { color: COLORS.mute } }, "–"),
              React.createElement(HoverAxisPicker, { label: "종료", value: ymEnd, onChange: onYmEnd, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
              React.createElement("span", { style: { fontSize: 13, color: COLORS.mute, marginLeft: 10 } }, "월별"),
              React.createElement(HoverAxisPicker, { label: "시작월", value: monthFrom, onChange: onMonthFrom, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
              React.createElement("span", { style: { color: COLORS.mute } }, "–"),
              React.createElement(HoverAxisPicker, { label: "종료월", value: monthTo, onChange: onMonthTo, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]) }),
              (mainTab !== "chart" || chartSub !== "trend" || granularity !== "day" || displayMode !== "abs" || smoothed || overlayItem !== ITEMS[0].key || ymStart !== YM_MIN || ymEnd !== YM_MAX || monthFrom !== 1 || monthTo !== 12 || itemFilter.length !== 1 || itemFilter[0] !== ITEMS[0].key) && React.createElement("button", {
                onClick: () => {
                  setMainTab("chart"); setChartSub("trend"); setGranularity("day"); setDisplayMode("abs");
                  setSmoothed(false); setOverlayItem(ITEMS[0].key);
                  setYmStart(YM_MIN); setYmEnd(YM_MAX); setMonthFrom(1); setMonthTo(12); setItemFilter([ITEMS[0].key]);
                },
                style: { fontSize: 13, color: COLORS.rust, background: "none", border: `1px solid ${COLORS.rust}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 700 }
              }, "필터 초기화")
            )
          )
        ),

        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
          React.createElement("div", { style: { fontSize: 13, color: COLORS.mute } },
            `최근 발표 ${dateLabel(cur?.date)} · 데이터 ${dateLabel(db.period?.start)} ~ ${dateLabel(db.period?.end)} · ${ymLabel(ymStart)}~${ymLabel(ymEnd)}`,
            (monthFrom !== 1 || monthTo !== 12) ? ` · ${monthFrom}월~${monthTo}월만` : "",
            ` · 표시 품목 ${visibleItems.length}개`
          ),
          React.createElement("button", { onClick: copyShareLink, style: { fontSize: 13, fontWeight: 700, color: linkCopied ? COLORS.sage : COLORS.mute, background: "none", border: `1px solid ${linkCopied ? COLORS.sage : COLORS.panelBorder}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" } }, linkCopied ? "✓ 복사됨" : "이 화면 링크 복사")
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
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(ToggleBtn, { active: !smoothed, onClick: () => setSmoothed(false), label: "일별 원자료" }),
              React.createElement(ToggleBtn, { active: smoothed, onClick: () => setSmoothed(true), label: "7일 이동평균" }),
              React.createElement("button", { onClick: exportTrendXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16 } },
              trendSeries.length
                ? React.createElement(React.Fragment, null, React.createElement(SvgLineChart, { categories: trendCategories, series: trendSeries, height: 340, formatValue: (v) => v == null ? "—" : v.toFixed(2) }), React.createElement(ChartLegend, { series: trendSeries }))
                : React.createElement("div", { style: { padding: 40, textAlign: "center", color: COLORS.mute } }, "표시할 품목을 하나 이상 선택하세요.")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginTop: 10 } }, "※ USDA 원자료 Wtd Avg는 $/100 lb입니다. 예: $145.00/100 lb = $1.45/lb. 카드의 kg 환산치는 1 lb = 0.453592 kg 기준 단순 환산(참고용)입니다.")
          ),
          chartSub === "overlay" && React.createElement(React.Fragment, null,
            React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
              React.createElement(HoverAxisPicker, { label: "품목", value: overlayItem, onChange: setOverlayItem, options: ITEMS.map((i) => [i.key, i.label]) }),
              React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, marginLeft: "auto" } }, "⬇ 엑셀 다운로드")
            ),
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "* 위쪽 기간 필터 안에 포함된 연도들을 월별 평균으로 겹쳐서 계절 패턴과 연도별 가격 수준을 비교합니다."),
            React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16 } },
              React.createElement(SvgLineChart, { categories: overlayCategories, series: overlaySeries, height: 340, formatValue: (v) => v == null ? "—" : v.toFixed(2) }),
              React.createElement(ChartLegend, { series: overlaySeries })
            )
          )
        ),

        mainTab === "table" && React.createElement(React.Fragment, null,
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
            React.createElement(HoverAxisPicker, { label: "단위", value: granularity, onChange: setGranularity, options: GRANULARITY_OPTIONS }),
            React.createElement("div", { style: { display: "flex", gap: 4, marginLeft: "auto" } },
              React.createElement(ToggleBtn, { active: displayMode === "abs", onClick: () => setDisplayMode("abs"), label: "실수치($/lb)" }),
              React.createElement(ToggleBtn, { active: displayMode === "chg", onClick: () => setDisplayMode("chg"), label: CHG_LABEL[granularity] }),
              React.createElement("button", { onClick: exportTableXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "⬇ 엑셀 다운로드")
            )
          ),
          isMobile ? React.createElement(React.Fragment, null,
            React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 8 } }, "최신 날짜가 맨 위입니다."),
            (() => {
              const out = [];
              let lastMonth = null;
              displayIdxs.forEach((idx, rowPos) => {
                const row = tableRows[idx];
                if (granularity === "day") {
                  const ym = row.sortKey.slice(0, 7);
                  if (ym !== lastMonth) {
                    out.push(React.createElement("div", {
                      key: "grp-" + ym,
                      style: { fontSize: 12.5, fontWeight: 700, color: COLORS.amberSoft, margin: rowPos === 0 ? "0 0 6px 2px" : "16px 0 6px 2px" }
                    }, monthGroupLabel(row.sortKey)));
                    lastMonth = ym;
                  }
                }
                out.push(React.createElement(MobileTableCard, {
                  key: row.sortKey, row, idx, visibleItems, isLatest: rowPos === 0,
                  cellDisplay, lbToKg, money, displayMode
                }));
              });
              return out;
            })(),
            React.createElement("div", { style: { background: "#ede4d8", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 12, padding: "12px 14px", marginTop: 4 } },
              React.createElement("div", { style: { fontSize: 13.5, fontWeight: 800, color: COLORS.cream, marginBottom: 8 } }, "기간평균"),
              React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } },
                visibleItems.map((i) => React.createElement("div", { key: i.key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
                  React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: COLORS.mute } },
                    React.createElement("span", { style: { width: 7, height: 7, borderRadius: 2, background: i.color, display: "inline-block" } }), i.label
                  ),
                  React.createElement("div", { style: { textAlign: "right" } },
                    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 800, fontFamily: "ui-monospace,monospace", color: COLORS.amberSoft } }, money(tableAvg[i.key])),
                    React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, fontFamily: "ui-monospace,monospace" } }, money(lbToKg(tableAvg[i.key])), "/kg")
                  )
                ))
              )
            )
          ) : React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, overflow: "hidden" } },
            React.createElement("div", { style: { overflowX: "auto", maxHeight: 560, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 14.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { ...thStyle, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 92 } }, granularity === "day" ? "발표일" : granularity === "month" ? "연월" : "연도"),
                  visibleItems.flatMap((i) => [
                    React.createElement("th", { key: i.key + "-lb", style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 92 } }, `${i.label} ($/lb)`),
                    React.createElement("th", { key: i.key + "-kg", style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 92, color: COLORS.mute } }, `${i.label} ($/kg)`)
                  ])
                )),
                React.createElement("tbody", null, displayIdxs.map((idx, rowPos) => {
                  const r = tableRows[idx];
                  return React.createElement("tr", {
                    key: r.sortKey,
                    style: { borderTop: `1px solid ${COLORS.panelBorder}`, background: rowPos % 2 ? "rgba(255,255,255,0.015)" : "transparent" },
                    onMouseEnter: (e) => { e.currentTarget.style.background = "rgba(217,139,63,0.07)"; },
                    onMouseLeave: (e) => { e.currentTarget.style.background = rowPos % 2 ? "rgba(255,255,255,0.015)" : "transparent"; }
                  },
                    React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: rowPos === 0 ? "#f7f8f5" : COLORS.panel, fontWeight: rowPos === 0 ? 800 : 700, zIndex: 1, color: rowPos === 0 ? COLORS.amberSoft : COLORS.cream } }, r.label, rowPos === 0 ? " ·최신" : ""),
                    visibleItems.flatMap((i) => {
                      const { text, raw } = cellDisplay(idx, i.key);
                      const color = displayMode === "chg" ? (raw === null ? COLORS.mute : raw > 0 ? COLORS.sage : raw < 0 ? COLORS.rust : COLORS.mute) : COLORS.cream;
                      const v = r.vals[i.key];
                      const kgText = displayMode === "abs" ? money(lbToKg(v)) : text; // 증감률은 단위 무관하게 동일값
                      return [
                        React.createElement("td", { key: i.key + "-lb", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", color } }, text),
                        React.createElement("td", { key: i.key + "-kg", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", color: displayMode === "abs" ? COLORS.mute : color } }, kgText)
                      ];
                    })
                  );
                })),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "기간평균"),
                  visibleItems.flatMap((i) => [
                    React.createElement("td", { key: i.key + "-lb", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.amberSoft } }, money(tableAvg[i.key])),
                    React.createElement("td", { key: i.key + "-kg", style: { ...tdStyle, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 800, color: COLORS.mute } }, money(lbToKg(tableAvg[i.key])))
                  ])
                ))
              )
            )
          )
        )
      )
    );
  }

  return UsdaDomesticApp;
})();
