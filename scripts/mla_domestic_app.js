/* 축산레이더 · 호주 내수(EYCI 등) 현황
   MLA(Meat & Livestock Australia) Statistics API(인증 불필요, 공개 API)로 GitHub Actions가
   수집한 data/mla_domestic.json을 그린다.
   지표: EYCI, 중량우(Heavy Steer), 처리소(Processor Cow), 무역용 양(Trade Lamb), 머튼(Mutton)
   + 주간 도축량(NLRS 자발적 조사, 소/양)

   주의: MLA Market Report and Information Terms of Use 적용 대상 데이터.
   개인적 용도 및 내부 업무용으로만 사용. */
window.MlaDomesticApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30"];
  const IND_ORDER = ["0", "4", "13", "7", "11"];
  const IND_SHORT = {
    "0": "EYCI (동부 영계)", "4": "중량우 (Heavy Steer)", "13": "처리소 (Processor Cow)",
    "7": "무역용 양 (Trade Lamb)", "11": "머튼 (Mutton)"
  };

  function fmtVal(v, unit) { return v == null || !isFinite(v) ? "—" : `${Number(v).toFixed(1)}${unit ? " " + unit : ""}`; }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
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

  function SvgLineChart({ categories, series, height = 260 }) {
    const width = 900;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 40 : 26, left: 56 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) : 1;
    const minVal = allVals.length ? Math.min(...allVals) * 0.95 : 0;
    const span = Math.max(0.01, maxVal * 1.05 - minVal);
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
          const val = maxVal * 1.05 - (maxVal * 1.05 - minVal) / gridLines * i;
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, val.toFixed(0))
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - 8, textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
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
            categories.length <= 60 && s.data.map((v, i) => v != null && isFinite(v) && React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v), r: i === hoverIdx ? 4 : 1.8, fill: s.color }))
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

  function Tile({ label, value, sub, color }) {
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 150, flex: "1 1 150px" } },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, label),
      React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, value),
      sub && React.createElement("div", { style: { fontSize: 12, color, marginTop: 4 } }, sub)
    );
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

  return function MlaDomesticApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(["0"]);
    const [days, setDays] = useState(180);
    const [normalize, setNormalize] = useState(false);

    useEffect(() => {
      fetch("./data/mla_domestic.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    // Hooks 규칙: raw가 없을 때 일찍 return해버리면 이 아래 훅들이 아예 호출이
    // 안 됐다가, 데이터가 로드된 다음 렌더에서 갑자기 훅 개수가 늘어나
    // "Rendered more hooks than during the previous render"(#310) 에러가 남.
    // 그래서 훅 호출은 항상 이 위치에서 raw 유무와 상관없이 실행하고,
    // 화면을 안 그리는 것(early return)은 모든 훅 호출이 끝난 뒤에만 함.
    const chartCategories = useMemoLite(raw, selected, days, normalize);

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const names = raw.indicatorNames || {};

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

    const exportXlsx = () => {
      const cats = chartCategories.categories;
      const header = ["날짜", ...selected.map((id) => IND_SHORT[id] || id)];
      const rows = cats.map((c, i) => [c, ...selected.map((id) => {
        const s = chartCategories.series.find((s2) => s2.id === id);
        return s ? (s.data[i] != null ? s.data[i] : "") : "";
      })]);
      downloadXlsx([header, ...rows], "호주_내수지표.xlsx", "지표");
    };

    const exportSlaughterXlsx = () => {
      const cattle = raw.slaughter?.Cattle || [], sheep = raw.slaughter?.Sheep || [];
      const dateSet = [...new Set([...cattle.map((r) => r.date), ...sheep.map((r) => r.date)])].sort();
      const cMap = Object.fromEntries(cattle.map((r) => [r.date, r.headCount]));
      const sMap = Object.fromEntries(sheep.map((r) => [r.date, r.headCount]));
      const header = ["주(종료일)", "소 도축두수", "양 도축두수"];
      downloadXlsx([header, ...dateSet.map((d) => [d, cMap[d] ?? "", sMap[d] ?? ""])], "호주_주간도축량.xlsx", "도축량");
    };

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1040 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "호주 내수현황(EYCI 등)"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "MLA(Meat & Livestock Australia) 공개 API \u00B7 매일 자동 갱신 \u00B7 수동작업 없음"
      ),

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        IND_ORDER.map((id) => {
          const meta = names[id];
          const series = raw.indicators?.[id] || [];
          const latest = series[series.length - 1];
          const weekAgo = series[series.length - 8];
          const wowPct = latest && weekAgo ? (latest.value - weekAgo.value) / weekAgo.value * 100 : null;
          return React.createElement(Tile, {
            key: id,
            label: IND_SHORT[id] || meta?.desc || id,
            value: fmtVal(latest?.value, meta?.unit),
            sub: wowPct != null ? `1주 ${pctFmt(wowPct)}` : null,
            color: wowPct > 0 ? COLORS.rust : "#3a6ea5"
          });
        })
      ),

      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4 } },
        IND_ORDER.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, IND_SHORT[id])),
        React.createElement("div", { style: { flex: 1 } }),
        [["90", "3개월"], ["180", "6개월"], ["365", "1년"], ["99999", "전체"]].map(([d, l]) =>
          React.createElement(Toggle, { key: d, active: days === +d, onClick: () => setDays(+d), color: COLORS.sage }, l)),
        React.createElement(Toggle, { active: normalize, onClick: () => setNormalize((v) => !v), color: COLORS.amberSoft }, "지수화(기준일=100)"),
        React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀")
      ),
      (() => {
        const units = new Set(selected.map((id) => names[id]?.unit).filter(Boolean));
        return selected.length > 1 && units.size > 1 && !normalize
          ? React.createElement("div", { style: { fontSize: 12, color: COLORS.rust, marginBottom: 10 } },
              `\u26A0 선택한 지표의 단위가 서로 달라요 (${[...units].join(", ")}) — 이대로 겹쳐보면 절대값 비교가 왜곡됩니다. "지수화" 켜는 걸 추천합니다.`)
          : React.createElement("div", { style: { marginBottom: 10 } });
      })(),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        chartCategories.series.length ? React.createElement(SvgLineChart, { categories: chartCategories.categories, series: chartCategories.series })
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 지표를 선택하세요.")
      ),

      React.createElement("h2", { style: { fontSize: 16, fontWeight: 800, color: COLORS.cream, marginBottom: 8 } }, "주간 도축량 (NLRS 자발적 조사)"),
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "매주 금요일 발표, 국가 합계(6개 주 합산) \u00B7 공급 선행지표"),
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 8 } },
        React.createElement("button", { onClick: exportSlaughterXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀")
      ),
      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
        React.createElement(SvgLineChart, {
          categories: (raw.slaughter?.Cattle || []).slice(-52).map((r) => r.date.slice(5)),
          series: [
            { name: "소(천두)", color: PALETTE[0], data: (raw.slaughter?.Cattle || []).slice(-52).map((r) => r.headCount / 1000) },
            { name: "양(천두)", color: PALETTE[1], data: (raw.slaughter?.Sheep || []).slice(-52).map((r) => r.headCount / 1000) }
          ]
        })
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `최근 데이터 기준: ${raw.sourceMostRecentData || "—"} \u00B7 수집: ${fmtUpdatedAt(raw.collectedAt) || "—"}`
      ),
      React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 4 } },
        "출처: Meat & Livestock Australia Statistics API \u00B7 MLA Market Report and Information Terms of Use 적용 (개인/내부 업무용)"
      )
    );
  };

  function useMemoLite(raw, selected, days, normalize) {
    return useMemo(() => {
      if (!raw) return { categories: [], series: [] };
      const indicators = raw.indicators || {};
      const base = indicators[selected[0]] || Object.values(indicators)[0] || [];
      const dates = base.slice(days >= 99999 ? 0 : -days).map((r) => r.date);
      const series = selected.filter((id) => indicators[id]).map((id) => {
        const byDate = Object.fromEntries(indicators[id].map((r) => [r.date, r.value]));
        let data = dates.map((d) => byDate[d] ?? null);
        if (normalize) {
          const base0 = data.find((v) => v != null && isFinite(v) && v !== 0);
          if (base0) data = data.map((v) => v == null ? null : v / base0 * 100);
        }
        return { id, name: IND_SHORT[id] || id, color: PALETTE[IND_ORDER.indexOf(id) % PALETTE.length], data };
      });
      return { categories: dates.map((d) => d.slice(5)), series };
    }, [raw, selected, days, normalize]);
  }
})();
