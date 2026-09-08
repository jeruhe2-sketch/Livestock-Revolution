/* 축산레이더 · 주요지표
   이미 사이트에 있는 데이터 파일들(EU돈가/환율/호주EYCI/미국돈육)을 한 화면에 모아
   요약해서 보여주는 롤업 배너. 새로운 원자료 수집은 없고, 이미 각자 탭에서
   자동 갱신되는 JSON들을 프론트에서 한 번 더 읽어 요약만 함 (LLM/수동작업 없음).

   CME Live Cattle 선물, Steiner 90CL 지표는 유료/구독 데이터라 자동화된 무료 API가
   없어서 여기 포함하지 않음 (수입육 시황 브리핑 스킬이 계속 수동 확인). */
window.KeyIndicatorsApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };
  const PALETTE = ["#3a6ea5", "#b96a2e", "#2e7d4f", "#a34a3f"];
  const SERIES_DEFS = [
    { key: "fx", name: "USD/KRW", hash: null },
    { key: "eu", name: "EU 돈가(S+E)", hash: "#eupigmeatprice" },
    { key: "eyci", name: "EYCI(호주)", hash: "#mladomestic" },
    { key: "usda", name: "미국 돈육 목전지", hash: "#usdedomestic" },
  ];

  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
  function fetchJson(path) {
    return fetch(path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  function downloadXlsx(aoa, filename, sheetName) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    XLSX.writeFile(wb, filename);
  }
  // ISO 8601 주차 키 (예: "2026-W35"). fx_history.json의 weekly 키 포맷과 동일.
  function isoWeekKey(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function Toggle({ active, onClick, children, color }) {
    return React.createElement("button", {
      onClick, style: {
        padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
        border: `1px solid ${active ? (color || COLORS.amber) : COLORS.panelBorder}`,
        background: active ? (color || COLORS.amber) : COLORS.panel,
        color: active ? "#ffffff" : COLORS.mute, fontWeight: 700, whiteSpace: "nowrap"
      }
    }, children);
  }

  function SvgLineChart({ categories, series, height = 280 }) {
    const width = 900;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 40 : 26, left: 48 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) : 1;
    const minVal = allVals.length ? Math.min(...allVals) * 0.97 : 0;
    const span = Math.max(0.01, maxVal * 1.03 - minVal);
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v - minVal) / span * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = Math.max(1, Math.ceil(categories.length / 10));
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
          const val = maxVal * 1.03 - (maxVal * 1.03 - minVal) / gridLines * i;
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 6, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, val.toFixed(0))
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - (manyLabels ? 22 : 8), textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
        hoverIdx !== null && React.createElement("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: COLORS.amberSoft, strokeWidth: "1", strokeDasharray: "2 2" }),
        series.map((s) => {
          const segs = []; let cur = [];
          s.data.forEach((v, i) => {
            if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur); cur = []; } return; }
            cur.push(`${cur.length ? "L" : "M"}${xFor(i)},${yFor(v)}`);
          });
          if (cur.length) segs.push(cur);
          return React.createElement("g", { key: s.name },
            segs.map((seg, si) => React.createElement("path", { key: si, d: seg.join(" "), fill: "none", stroke: s.color, strokeWidth: "2.2" })),
            categories.length <= 60 && s.data.map((v, i) => v != null && isFinite(v) && React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v), r: i === hoverIdx ? 4 : 1.6, fill: s.color }))
          );
        })
      ),
      hoverIdx !== null && React.createElement("div", {
        style: {
          position: "absolute", left: `${tooltipLeftPct}%`, top: 6,
          transform: `translateX(${tooltipLeftPct > 70 ? "-100%" : tooltipLeftPct < 5 ? "0%" : "-50%"})`,
          background: COLORS.cream, color: "#f7f8f5", borderRadius: 8, padding: "8px 10px",
          fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 10px rgba(0,0,0,.18)", zIndex: 5
        }
      },
        React.createElement("div", { style: { fontWeight: 700, marginBottom: 4 } }, categories[hoverIdx]),
        series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", justifyContent: "space-between", gap: 10 } },
          React.createElement("span", { style: { color: s.color } }, "\u25CF " + s.name),
          React.createElement("span", null, s.data[hoverIdx] != null ? s.data[hoverIdx].toFixed(1) : "—")
        ))
      )
    );
  }
  function ChartLegend({ series }) {
    return React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6, paddingBottom: 4 } },
      series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: COLORS.cream } },
        React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" } }), s.name
      ))
    );
  }

  function Card({ label, value, unit, sub, subColor, asOf, source, onClick, pending }) {
    return React.createElement("div", {
      onClick,
      style: {
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12,
        padding: "16px 18px", cursor: onClick ? "pointer" : "default", minWidth: 200, flex: "1 1 200px",
        opacity: pending ? 0.55 : 1
      }
    },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 26, fontWeight: 800, color: COLORS.cream, lineHeight: 1.1 } },
        value, unit && React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: COLORS.mute, marginLeft: 5 } }, unit)
      ),
      sub && React.createElement("div", { style: { fontSize: 13, color: subColor || COLORS.mute, marginTop: 6, fontWeight: 700 } }, sub),
      (asOf || source) && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 8 } }, [asOf, source].filter(Boolean).join(" · "))
    );
  }

  function PendingCard({ label, note }) {
    return React.createElement("div", { style: { background: COLORS.head, border: `1px dashed ${COLORS.panelBorder2}`, borderRadius: 12, padding: "16px 18px", minWidth: 200, flex: "1 1 200px" } },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 15, color: COLORS.mute, fontWeight: 700 } }, "\u26A0 자동화 불가"),
      React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginTop: 6, lineHeight: 1.5 } }, note)
    );
  }

  // 일별 시계열을 ISO 주차별로 리샘플(그 주의 마지막 값 사용)
  function resampleWeekly(rows, dateKey, valueKey) {
    const byWeek = {};
    for (const r of rows) {
      const d = new Date(r[dateKey] + "T00:00:00Z");
      const wk = isoWeekKey(d);
      const v = r[valueKey];
      if (v == null || !isFinite(v)) continue;
      if (!byWeek[wk] || r[dateKey] > byWeek[wk].date) byWeek[wk] = { date: r[dateKey], value: v };
    }
    return byWeek;
  }

  // 카드용 WoW/YoY: 소스마다 최신 발표 주차가 다를 수 있어서(예: EYCI는 이번주까지,
  // EU 돈가는 2주 전까지) 공통 주차 목록이 아니라 "그 소스 자신의" 최신 주차를 기준으로 계산.
  function wowYoy(weeklyMap) {
    const keys = Object.keys(weeklyMap).sort();
    if (!keys.length) return { latest: null, latestWeek: null, wow: null, yoy: null };
    const lastWeek = keys[keys.length - 1];
    const latest = weeklyMap[lastWeek];
    const wowWeek = keys[keys.length - 2];
    const yoyWeek = keys[keys.length - 53];
    const wowV = wowWeek ? weeklyMap[wowWeek] : null;
    const yoyV = yoyWeek ? weeklyMap[yoyWeek] : null;
    return {
      latest: latest ? latest.value : null,
      latestWeek: lastWeek,
      wow: latest && wowV ? (latest.value - wowV.value) / wowV.value * 100 : null,
      yoy: latest && yoyV ? (latest.value - yoyV.value) / yoyV.value * 100 : null,
    };
  }


  const PERIOD_OPTIONS = [["26", "6개월"], ["52", "1년"], ["104", "2년"], ["99999", "전체"]];

  return function KeyIndicatorsApp() {
    const [eu, setEu] = useState(null);
    const [fx, setFx] = useState(null);
    const [fxHist, setFxHist] = useState(null);
    const [mla, setMla] = useState(null);
    const [usda, setUsda] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [periodWeeks, setPeriodWeeks] = useState(104);
    const [visible, setVisible] = useState({ fx: true, eu: true, eyci: true, usda: true });

    useEffect(() => {
      Promise.all([
        fetchJson("./data/eu_pigmeat_price.json"),
        fetchJson("./data/exchange_rates.json"),
        fetchJson("./data/fx_history.json"),
        fetchJson("./data/mla_domestic.json"),
        fetchJson("./data/usda_pork_domestic.json"),
      ]).then(([euD, fxD, fxHistD, mlaD, usdaD]) => {
        setEu(euD); setFx(fxD); setFxHist(fxHistD); setMla(mlaD); setUsda(usdaD); setLoaded(true);
      });
    }, []);

    // 4개 소스를 전부 "주차 -> 값" 맵으로 통일 (단위가 다르므로 절대값 비교엔 안 쓰고,
    // 카드의 WoW/YoY 계산과 아래 정규화 차트의 원자료로만 씀)
    const weekly = useMemo(() => {
      const out = { fx: {}, eu: {}, eyci: {}, usda: {} };
      if (fxHist?.weekly) {
        for (const [wk, r] of Object.entries(fxHist.weekly)) {
          if (r.usd && r.krw) out.fx[wk] = { date: r.date, value: r.krw / r.usd }; // EUR/KRW ÷ EUR/USD = USD/KRW
        }
      }
      if (eu?.data) {
        const byWeek = {};
        for (const [year, week, cls, msCode, price] of eu.data) {
          if (msCode !== "EU") continue;
          const wk = `${year}-W${String(week).padStart(2, "0")}`;
          (byWeek[wk] = byWeek[wk] || []).push(price);
        }
        for (const [wk, prices] of Object.entries(byWeek)) {
          out.eu[wk] = { value: prices.reduce((s, v) => s + v, 0) / prices.length };
        }
      }
      if (mla?.indicators?.["0"]) {
        out.eyci = resampleWeekly(mla.indicators["0"], "date", "value");
      }
      if (usda?.data) {
        const rows = usda.data.map((r) => ({ date: r.date, value: r["1/4 Trim Butt VAC"]?.usdPerLb }));
        out.usda = resampleWeekly(rows, "date", "value");
      }
      return out;
    }, [eu, fxHist, mla, usda]);

    const weekKeys = useMemo(() => {
      const set = new Set();
      Object.values(weekly).forEach((m) => Object.keys(m).forEach((k) => set.add(k)));
      return [...set].sort();
    }, [weekly]);

    const cardStats = useMemo(() => ({
      fx: wowYoy(weekly.fx),
      eu: wowYoy(weekly.eu),
      eyci: wowYoy(weekly.eyci),
      usda: wowYoy(weekly.usda),
    }), [weekly]);

    const goto = (hash) => { window.location.hash = hash; };

    // 정규화(기준=100) 겹쳐보기 차트용 시리즈
    const chart = useMemo(() => {
      const keys = periodWeeks >= 99999 ? weekKeys : weekKeys.slice(-periodWeeks);
      const series = SERIES_DEFS.filter((d) => visible[d.key]).map((d, i) => {
        const map = weekly[d.key] || {};
        const raw = keys.map((k) => (map[k] ? map[k].value : null));
        const base = raw.find((v) => v != null && v !== 0);
        const data = base ? raw.map((v) => (v == null ? null : v / base * 100)) : raw;
        return { key: d.key, name: d.name, color: PALETTE[i % PALETTE.length], data };
      });
      return { categories: keys, series };
    }, [weekly, weekKeys, periodWeeks, visible]);

    const exportXlsx = () => {
      const keys = chart.categories;
      const header = ["주차", ...SERIES_DEFS.map((d) => d.name)];
      const rows = keys.map((k) => [k, ...SERIES_DEFS.map((d) => (weekly[d.key]?.[k] ? Math.round(weekly[d.key][k].value * 100) / 100 : ""))]);
      downloadXlsx([header, ...rows], "주요지표_원자료.xlsx", "주요지표");
    };

    const toggleSeries = (key) => setVisible((v) => ({ ...v, [key]: !v[key] }));

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1040 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 20 } },
        "사이트 내 각 탭에서 자동 갱신되는 데이터를 한 화면에 모은 요약입니다. 카드를 클릭하면 해당 탭으로 이동합니다."
      ),

      !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "불러오는 중..."),

      loaded && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
          React.createElement(Card, {
            label: "USD/KRW", value: fx?.usdKrw != null ? fx.usdKrw.toLocaleString() : "—", unit: "원",
            sub: cardStats.fx.wow != null ? `1주 ${pctFmt(cardStats.fx.wow)} · 1년 ${pctFmt(cardStats.fx.yoy)}` : null,
            subColor: cardStats.fx.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `${fmtUpdatedAt(fx?.updatedAt) || "—"} · ${fx?.source || ""}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#eupigmeatprice"),
            label: "EU 돈가 (S+E 평균)", value: cardStats.eu.latest != null ? cardStats.eu.latest.toFixed(2) : "—", unit: "\u20AC/100kg",
            sub: cardStats.eu.wow != null ? `1주 ${pctFmt(cardStats.eu.wow)} · 1년 ${pctFmt(cardStats.eu.yoy)}` : null,
            subColor: cardStats.eu.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `EU 집행위 \u00B7 ${cardStats.eu.latestWeek || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "EYCI (호주 소값)", value: cardStats.eyci.latest != null ? cardStats.eyci.latest.toFixed(1) : "—", unit: "c/kg cwt",
            sub: cardStats.eyci.wow != null ? `1주 ${pctFmt(cardStats.eyci.wow)} · 1년 ${pctFmt(cardStats.eyci.yoy)}` : null,
            subColor: cardStats.eyci.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `MLA \u00B7 ${cardStats.eyci.latestWeek || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 돈육 목전지", value: cardStats.usda.latest != null ? cardStats.usda.latest.toFixed(2) : "—", unit: "$/lb",
            sub: cardStats.usda.wow != null ? `1주 ${pctFmt(cardStats.usda.wow)} · 1년 ${pctFmt(cardStats.usda.yoy)}` : null,
            subColor: cardStats.usda.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `USDA LMR \u00B7 ${cardStats.usda.latestWeek || "—"}`
          })
        ),

        React.createElement("h2", { style: { fontSize: 15, fontWeight: 800, color: COLORS.cream, margin: "0 0 4px" } }, "추이 비교 (지수화, 기준=100)"),
        React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } },
          "단위가 서로 다른 지표(환율/€/c-kg/$-lb)를 같이 비교하려고 각 기간 첫 값을 100으로 맞춘 지수입니다. 실제 값은 위 카드나 엑셀에서 확인하세요."
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 } },
          SERIES_DEFS.map((d, i) => React.createElement(Toggle, { key: d.key, active: visible[d.key], onClick: () => toggleSeries(d.key), color: PALETTE[i % PALETTE.length] }, d.name)),
          React.createElement("div", { style: { flex: 1 } }),
          PERIOD_OPTIONS.map(([w, l]) => React.createElement(Toggle, { key: w, active: periodWeeks === +w, onClick: () => setPeriodWeeks(+w), color: COLORS.sage }, l)),
          React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 원자료 엑셀")
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12, padding: 16, marginBottom: 24 } },
          chart.series.length
            ? React.createElement(React.Fragment, null,
                React.createElement(SvgLineChart, { categories: chart.categories, series: chart.series }),
                React.createElement(ChartLegend, { series: chart.series })
              )
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 지표를 선택하세요.")
        ),

        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "자동화 안 되는 지표 (수동 확인 필요)"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
          React.createElement(PendingCard, { label: "CME Live Cattle 선물", note: "CME 실시간/지연 시세는 유료 라이선스 필요. 무료 API 없음." }),
          React.createElement(PendingCard, { label: "미국 90CL 수입육 지표", note: "Steiner Consulting 구독 데이터. MLA API report/9에서 republish하지만 별도 검증 필요." }),
          React.createElement(PendingCard, { label: "미국 소 도축(주간)", note: "USDA 리포트 slug 확인 후 추가 예정." })
        )
      ),

      React.createElement("p", { style: { fontSize: 12, color: COLORS.mute, marginTop: 20, lineHeight: 1.6 } },
        "이 화면은 새로 데이터를 수집하지 않고, 각 탭이 이미 자동 갱신한 파일을 한 번 더 읽어 보여줍니다. 상세 내역/차트는 각 탭에서 확인하세요."
      )
    );
  };
})();
