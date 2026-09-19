/* 축산레이더 · 국내 축산물 재고동향
   축산물품질평가원(KAPE) 공식 API(data.ekape.or.kr)로 GitHub Actions가 매일 수집한
   data/livestock_inventory.json을 그린다. 조사업체 표본 기준 추정치, 월 단위,
   집계 시차 2~3개월 (예: 9월 기준 최신은 6~7월치).
   단위: 소=kg, 돼지=ton (그대로 표기, 서로 합산/비교하지 않음). */
window.LivestockInventoryApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgTimeBarChart, ChartLegend, fmtUpdatedAt, downloadXlsx, readUrlParams, useShareLink, ShareLinkButton, ResetFilterButton, buildPivot, PivotTable } = window.RadarUI;
  const PIVOT_DIM_LABEL = { item: "\uD56D\uBAA9", year: "\uC5F0\uB3C4" };

  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5", "#4a8fa8", "#a06a9a", "#7a8a3a", "#c48a3a", "#5a7ab9", "#9a4a6a"];
  const Toggle = PillToggle;

  function useRadarData() {
    const [raw, setRaw] = React.useState(null);
    const [error, setError] = React.useState(null);
    React.useEffect(() => {
      fetch("./data/livestock_inventory.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);
    return { raw, error };
  }

  return function LivestockInventoryApp() {
    const { raw, error } = useRadarData();
    const { p, pOneOf, pList, pInt } = readUrlParams();
    const [species, setSpecies] = useState(() => pOneOf("sp", "돼지", ["돼지", "소"]));
    const [selected, setSelected] = useState(() => pList("sel", ["총재고"]));
    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "chart", ["chart", "table"]));
    const [ymStart, setYmStart] = useState(() => pInt("ys", null));
    const [ymEnd, setYmEnd] = useState(() => pInt("ye", null));

    const speciesData = raw?.species?.[species];
    const history = speciesData?.history || [];
    const unit = history[0]?.unit || "";

    const partNames = useMemo(() => {
      const set = new Set();
      history.forEach((h) => Object.keys(h.parts || {}).forEach((p) => set.add(p)));
      return [...set];
    }, [history]);
    const ALL_INDICATORS = ["총재고", ...partNames];
    const PART_INDICATORS = partNames;

    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const all = history.map((h) => {
        const [y, m] = h.yearMonth.split("-");
        return +y * 100 + +m;
      });
      return { ALL_YM: all, YM_MIN: all[0] ?? null, YM_MAX: all[all.length - 1] ?? null };
    }, [history]);
    const ymLabel = (ym) => ym == null ? "—" : `${Math.floor(ym / 100)}년 ${ym % 100}월`;
    const addYm = (ym, delta) => {
      let y = Math.floor(ym / 100), m = ym % 100;
      m += delta;
      while (m > 12) { m -= 12; y++; }
      while (m < 1) { m += 12; y--; }
      return y * 100 + m;
    };

    const ys = ymStart ?? YM_MIN, ye = ymEnd ?? YM_MAX;

    const filtered = useMemo(() => {
      return history.filter((h) => {
        const [y, m] = h.yearMonth.split("-");
        const ym = +y * 100 + +m;
        return (ys == null || ym >= ys) && (ye == null || ym <= ye);
      });
    }, [history, ys, ye]);

    const categories = filtered.map((h) => h.yearMonth);
    const baseSeries = useMemo(() => {
      return selected.map((name) => ({
        id: name,
        name,
        color: PALETTE[ALL_INDICATORS.indexOf(name) % PALETTE.length],
        data: filtered.map((h) => name === "총재고" ? h.totStock : (h.parts?.[name] ?? null)),
      }));
    }, [filtered, selected, ALL_INDICATORS]);
    // 차트용: 선택된 각 지표마다 "OOO 평균" 기준선을 같이 그려서(옅은 색) 조회기간
    // 평균이 카드 숫자뿐 아니라 차트에도 바로 보이게 함. 표/엑셀은 baseSeries 그대로 씀.
    const chartSeries = useMemo(() => {
      const avgLines = baseSeries.map((s) => {
        const vals = s.data.filter((v) => v != null && isFinite(v));
        if (!vals.length) return null;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { id: `${s.id}_avg`, name: `${s.name} 평균`, color: s.color, dashed: true, data: filtered.map(() => avg) };
      }).filter(Boolean);
      return [...baseSeries, ...avgLines];
    }, [baseSeries, filtered]);
    const series = baseSeries;

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();
    const colAvg = (s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const periodAvgTot = useMemo(() => {
      const vals = filtered.map((h) => h.totStock).filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }, [filtered]);

    const exportXlsx = () => {
      const header = ["연월", ...selected.map((s) => `${s}(${unit})`)];
      const rows = tableIdx.map((i) => [categories[i], ...series.map((s) => s.data[i] != null ? s.data[i] : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_재고동향.xlsx`, "재고동향");
    };

    const [rowDim, setRowDim] = useState(() => pOneOf("rd", "item", ["item", "year"]));
    const [colDim, setColDim] = useState(() => pOneOf("cd", "year", ["item", "year"]));
    const [pivotDisplay, setPivotDisplay] = useState(() => pOneOf("pdm", "abs", ["abs", "yoy"]));
    const onRowDimChange = (v) => { if (v === colDim) setColDim(rowDim); setRowDim(v); };
    const onColDimChange = (v) => { if (v === rowDim) setRowDim(colDim); setColDim(v); };
    const pivotRows = useMemo(() => {
      const out = [];
      filtered.forEach((h) => {
        const year = h.yearMonth.split("-")[0];
        ALL_INDICATORS.forEach((name) => {
          const v = name === "총재고" ? h.totStock : h.parts?.[name];
          if (v != null && isFinite(v)) out.push({ item: name, year, value: v });
        });
      });
      return out;
    }, [filtered, ALL_INDICATORS]);
    const dimVal = (row, dimKey) => dimKey === "item" ? row.item : row.year;
    const pivot = useMemo(() => buildPivot(pivotRows, {
      rowOf: (r) => dimVal(r, rowDim), colOf: (r) => dimVal(r, colDim), valueOf: (r) => r.value,
      rowSort: rowDim === "year" ? (labels) => labels.sort((a, b) => +a - +b) : undefined,
      colSort: colDim === "year" ? (labels) => labels.sort((a, b) => +a - +b) : undefined,
    }), [pivotRows, rowDim, colDim]);
    const exportPivotXlsx = () => {
      const header = [PIVOT_DIM_LABEL[rowDim], ...pivot.colLabels, "\uCD1D\uD569\uACC4"];
      const rows2 = pivot.rowLabels.map((rl) => [rl, ...pivot.colLabels.map((cl) => pivot.matrix[rl]?.[cl] != null ? Math.round(pivot.matrix[rl][cl]) : ""), pivot.rowTotals[rl] != null ? Math.round(pivot.rowTotals[rl]) : ""]);
      const footer = ["\uCD1D\uD569\uACC4", ...pivot.colLabels.map((cl) => pivot.colTotals[cl] != null ? Math.round(pivot.colTotals[cl]) : ""), pivot.grandTotal != null ? Math.round(pivot.grandTotal) : ""];
      downloadXlsx([header, ...rows2, footer], `국내_${species}_재고동향_피벗표_${PIVOT_DIM_LABEL[rowDim]}x${PIVOT_DIM_LABEL[colDim]}.xlsx`, "피벗표");
    };

    const { linkCopied, copyShareLink } = useShareLink();
    React.useEffect(() => {
      const sp2 = new URLSearchParams();
      sp2.set("sp", species);
      sp2.set("tab", mainTab);
      if (selected.length && !(selected.length === 1 && selected[0] === "총재고")) sp2.set("sel", selected.join(","));
      if (ymStart != null) sp2.set("ys", ymStart);
      if (ymEnd != null) sp2.set("ye", ymEnd);
      if (mainTab === "table") { sp2.set("rd", rowDim); sp2.set("cd", colDim); if (pivotDisplay !== "abs") sp2.set("pdm", pivotDisplay); }
      const newSearch = "?" + sp2.toString() + window.location.hash;
      if (newSearch !== window.location.search + window.location.hash) window.history.replaceState(null, "", newSearch);
    }, [species, mainTab, selected.join(","), ymStart, ymEnd, rowDim, colDim, pivotDisplay]);
    const resetFilters = () => {
      setSpecies("돼지"); setSelected(["총재고"]); setYmStart(null); setYmEnd(null); setMainTab("chart");
      setRowDim("item"); setColDim("year"); setPivotDisplay("abs");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const latest = history[history.length - 1];
    const prevMonth = history[history.length - 2];
    const yearAgo = history[history.length - 1 - 12] || null;
    const momPct = latest && prevMonth ? (latest.totStock - prevMonth.totStock) / prevMonth.totStock * 100 : null;
    const yoyPct = latest && yearAgo ? (latest.totStock - yearAgo.totStock) / yearAgo.totStock * 100 : null;

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "국내 축산물 재고동향"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "축산물품질평가원(KAPE) 조사업체 표본 기준 추정치 \u00B7 월 단위, 집계 시차 2~3개월"
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, {
          key: sp, active: species === sp,
          onClick: () => { setSpecies(sp); setSelected(["총재고"]); },
          label: sp
        }))
      ),

      latest && React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `${species} 총재고 (${latest.yearMonth})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, `${latest.totStock?.toLocaleString() ?? "—"} ${unit}`),
          React.createElement("div", { style: { display: "flex", gap: 14, marginTop: 6 } },
            momPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "전월 "),
              React.createElement("span", { style: { color: momPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${momPct > 0 ? "+" : ""}${momPct.toFixed(1)}%`)
            ),
            yoyPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "전년 "),
              React.createElement("span", { style: { color: yoyPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${yoyPct > 0 ? "+" : ""}${yoyPct.toFixed(1)}%`)
            )
          )
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `조회기간 평균 총재고 (${ymLabel(ys)}~${ymLabel(ye)})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, periodAvgTot != null ? `${Math.round(periodAvgTot).toLocaleString()} ${unit}` : "—")
        )
      ),

      React.createElement(ShareLinkButton, { linkCopied, onClick: copyShareLink }),
      React.createElement("div", { style: { height: 8 } }),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "지표"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            React.createElement("button", {
              onClick: () => toggle("총재고"),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                border: `1.5px solid ${selected.includes("총재고") ? COLORS.amber : COLORS.panelBorder2}`,
                background: selected.includes("총재고") ? COLORS.amber : COLORS.panel,
                color: selected.includes("총재고") ? "#ffffff" : COLORS.cream
              }
            }, "\u{1F4CA} 총재고"),
            React.createElement("div", { style: { width: 1, alignSelf: "stretch", background: COLORS.panelBorder2, margin: "0 2px" } }),
            PART_INDICATORS.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, id)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement(ResetFilterButton, { onClick: resetFilters }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "기간"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            [["3", "최근 3개월"], ["6", "최근 6개월"], ["12", "최근 1년"]].map(([m, lbl]) => React.createElement(Toggle, {
              key: m, active: ye === YM_MAX && ys === addYm(YM_MAX, -(Number(m) - 1)), color: COLORS.sage,
              onClick: () => { setYmEnd(YM_MAX); setYmStart(addYm(YM_MAX, -(Number(m) - 1))); }
            }, lbl)),
            React.createElement(HoverAxisPicker, { label: "시작월", value: ys, onChange: (v) => { setYmStart(+v); if (+v > ye) setYmEnd(+v); }, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
            React.createElement("span", { style: { color: COLORS.mute } }, "\u2013"),
            React.createElement(HoverAxisPicker, { label: "종료월", value: ye, onChange: (v) => { setYmEnd(+v); if (+v < ys) setYmStart(+v); }, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) })
          )
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" })
      ),

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        chartSeries.length && categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgTimeBarChart, { categories, series: chartSeries, formatAxisValue: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0) }),
              React.createElement(ChartLegend, { series: chartSeries })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
          React.createElement(HoverAxisPicker, { label: "\uD589", value: rowDim, onChange: onRowDimChange, options: [["item", "\uD56D\uBAA9"], ["year", "\uC5F0\uB3C4"]] }),
          React.createElement(HoverAxisPicker, { label: "\uC5F4", value: colDim, onChange: onColDimChange, options: [["item", "\uD56D\uBAA9"], ["year", "\uC5F0\uB3C4"]] }),
          React.createElement(PillToggle, { active: pivotDisplay === "abs", onClick: () => setPivotDisplay("abs"), color: COLORS.sage }, "\uC2E4\uC218\uCE58"),
          React.createElement(PillToggle, { active: pivotDisplay === "yoy", onClick: () => setPivotDisplay("yoy"), color: COLORS.sage }, "\uC804\uC5F4 \uB300\uBE44 \uC99D\uAC10\uB960"),
          React.createElement("div", { style: { flex: 1 } }),
          React.createElement("button", { onClick: exportPivotXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
        ),
        pivot.rowLabels.length && pivot.colLabels.length
          ? React.createElement(PivotTable, { rowLabels: pivot.rowLabels, colLabels: pivot.colLabels, matrix: pivot.matrix, rowTotals: pivot.rowTotals, colTotals: pivot.colTotals, grandTotal: pivot.grandTotal, rowDimLabel: PIVOT_DIM_LABEL[rowDim], displayMode: pivotDisplay, formatValue: (v) => `${Math.round(v).toLocaleString()} ${unit}` })
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `단위: ${unit || "—"} \u00B7 수집: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "—"} \u00B7 ${raw.source || ""}`
      )
    );
  };
})();
