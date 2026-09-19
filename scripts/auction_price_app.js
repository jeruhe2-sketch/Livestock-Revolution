/* 축산레이더 · 국내 도매시장 경락가격(소/돼지)
   지육(도체) 기준 전국 주간 가중평균. 소매가/수입단가와 단위가 달라 직접 비교 안 함. */
window.AuctionPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, BarRanking, downloadXlsx, buildYearOverlay, readUrlParams, useShareLink, ShareLinkButton, ResetFilterButton } = window.RadarUI;
  const Toggle = PillToggle;
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5"];
  const round = (v) => v == null ? null : Math.round(v);

  return function AuctionPriceApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    React.useEffect(() => {
      fetch("./data/auction_price.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    const { p, pOneOf, pList, pInt } = readUrlParams();
    const [species, setSpecies] = useState(() => pOneOf("sp", "돼지", ["돼지", "소"]));
    const [showOverall, setShowOverall] = useState(() => p("ov", "1") === "1");
    const [showGrades, setShowGrades] = useState(() => pList("g", []));
    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "chart", ["chart", "table"]));
    const [idxStart, setIdxStart] = useState(() => pInt("is", null));
    const [idxEnd, setIdxEnd] = useState(() => pInt("ie", null));

    const speciesData = raw?.species?.[species];
    const weekly = speciesData?.weekly || [];
    const unit = speciesData?.unit || "원/kg";

    const gradeNames = useMemo(() => {
      const set = new Set();
      weekly.forEach((w) => Object.keys(w.byGrade || {}).forEach((g) => set.add(g)));
      return [...set];
    }, [weekly]);

    // 주차 인덱스(0..N-1) 기준 기간 필터. 라벨은 "연도-ISO주차"(예: 19-21)를 그대로 사용.
    const IDX_MIN = 0, IDX_MAX = weekly.length - 1;
    const idxLabel = (i) => i == null || !weekly[i] ? "—" : weekly[i].label;
    const is = idxStart ?? IDX_MIN, ie = idxEnd ?? IDX_MAX;
    const didMount = React.useRef(false);
    React.useEffect(() => {
      if (!didMount.current) { didMount.current = true; return; }
      setIdxStart(null); setIdxEnd(null);
    }, [species]);

    const filtered = useMemo(() => weekly.filter((_, i) => i >= is && i <= ie), [weekly, is, ie]);

    const categories = filtered.map((w) => w.label);
    const avgSeries = showOverall ? [{ id: "평균", name: "전체평균", color: "#b96a2e", data: filtered.map((w) => round(w.avgAmt)) }] : [];
    const gradeSeries = showGrades.map((g, idx) => ({
      id: g, name: g,
      color: PALETTE[(idx + 1) % PALETTE.length],
      data: filtered.map((w) => w.byGrade?.[g]?.amt != null ? round(Number(w.byGrade[g].amt)) : null),
    }));
    const series = [...avgSeries, ...gradeSeries];

    const latest = weekly[weekly.length - 1];
    const prev = weekly[weekly.length - 2];
    const yearAgo = weekly[weekly.length - 1 - 52] || null;
    const diffPct = latest && prev && prev.avgAmt ? round((latest.avgAmt - prev.avgAmt) / prev.avgAmt * 1000) / 10 : null;
    const yoyPct = latest && yearAgo && yearAgo.avgAmt ? round((latest.avgAmt - yearAgo.avgAmt) / yearAgo.avgAmt * 1000) / 10 : null;

    // 조회기간(필터된 범위) 요약: 평균가 · 총 거래두수
    const periodAvgAmt = useMemo(() => {
      const vals = filtered.map((w) => w.avgAmt).filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }, [filtered]);
    const periodTotalCnt = useMemo(() => {
      const vals = filtered.map((w) => w.avgCnt).filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    }, [filtered]);

    const exportXlsx = () => {
      const header = ["연도-주차", "전체평균", "두수", ...showGrades];
      const rows = [...filtered].reverse().map((w) => [
        w.label, round(w.avgAmt) ?? "", w.avgCnt ?? "",
        ...showGrades.map((g) => w.byGrade?.[g]?.amt != null ? round(Number(w.byGrade[g].amt)) : "")
      ]);
      downloadXlsx([header, ...rows], `국내_${species}_경락가격_${idxLabel(is)}~${idxLabel(ie)}.xlsx`, "경락가격");
    };

    // ── 그룹 비교(등급별 랭킹) / 겹쳐보기(연도별 계절 패턴) ──
    const [chartSub, setChartSub] = useState(() => pOneOf("csub", "trend", ["trend", "group", "overlay"]));
    const groupItems = useMemo(() => {
      const overallVals = filtered.map((w) => w.avgAmt).filter((v) => v != null && isFinite(v));
      const overallItem = { key: "전체평균", v: overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : 0 };
      const gradeItems = gradeNames.map((g) => {
        const vals = filtered.map((w) => w.byGrade?.[g]?.amt != null ? Number(w.byGrade[g].amt) : null).filter((v) => v != null && isFinite(v));
        return { key: g, v: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
      });
      return [overallItem, ...gradeItems].sort((a, b) => b.v - a.v);
    }, [filtered, gradeNames]);

    const overlayTargetGrades = showGrades.length ? showGrades : null;
    const overlay = useMemo(() => buildYearOverlay(weekly, {
      yearOf: (w) => w.weekStart ? +String(w.weekStart).slice(0, 4) : null,
      bucketOf: (w) => { const parts = String(w.label).split("-"); return parseInt(parts[1], 10) || null; },
      bucketLabel: (b) => `${b}\uC8FC`,
      valueOf: (w) => {
        if (!overlayTargetGrades) return w.avgAmt != null ? Number(w.avgAmt) : null;
        const vals = overlayTargetGrades.map((g) => w.byGrade?.[g]?.amt).filter((v) => v != null && isFinite(v)).map(Number);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      },
      bucketCompare: (a, b) => a - b,
    }), [weekly, overlayTargetGrades ? overlayTargetGrades.join(",") : "__overall"]);

    const exportGroupXlsx = () => {
      const header = ["구분", `평균가(${unit})`];
      const rows = groupItems.map((it) => [it.key, round(it.v)]);
      downloadXlsx([header, ...rows], `국내_${species}_경락가격_그룹비교_${idxLabel(is)}~${idxLabel(ie)}.xlsx`, "그룹비교");
    };
    const exportOverlayXlsx = () => {
      const header = ["ISO\uC8FC\uCC28", ...overlay.series.map((s) => s.name)];
      const rows = overlay.categories.map((c, i) => [c, ...overlay.series.map((s) => s.data[i] != null ? round(s.data[i]) : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_경락가격_겹쳐보기.xlsx`, "겹쳐보기");
    };

    const { linkCopied, copyShareLink } = useShareLink();
    React.useEffect(() => {
      const sp2 = new URLSearchParams();
      sp2.set("sp", species);
      sp2.set("tab", mainTab);
      if (!showOverall) sp2.set("ov", "0");
      if (showGrades.length) sp2.set("g", showGrades.join(","));
      if (idxStart != null) sp2.set("is", idxStart);
      if (idxEnd != null) sp2.set("ie", idxEnd);
      if (mainTab === "chart") sp2.set("csub", chartSub);
      const newSearch = "?" + sp2.toString() + window.location.hash;
      if (newSearch !== window.location.search + window.location.hash) window.history.replaceState(null, "", newSearch);
    }, [species, mainTab, showOverall, showGrades.join(","), idxStart, idxEnd, chartSub]);
    const resetFilters = () => {
      setSpecies("돼지"); setShowOverall(true); setShowGrades([]);
      setIdxStart(null); setIdxEnd(null); setMainTab("chart"); setChartSub("trend");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "국내 경락가격"),
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 14 } }, "라벨: 연도-ISO주차 (예 19-21 = 2019년 21주차) \u00B7 지육 기준, 소매가/수입단가와 비교 안 함"),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, {
          key: sp, active: species === sp, onClick: () => { setSpecies(sp); setShowGrades([]); }, label: sp
        }))
      ),

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
        latest && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `최근 주(${latest.label})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, `${round(latest.avgAmt).toLocaleString()} ${unit}`),
          React.createElement("div", { style: { display: "flex", gap: 14, marginTop: 6 } },
            diffPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "전주 "),
              React.createElement("span", { style: { color: diffPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${diffPct > 0 ? "+" : ""}${diffPct}%`)
            ),
            yoyPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "전년 "),
              React.createElement("span", { style: { color: yoyPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${yoyPct > 0 ? "+" : ""}${yoyPct}%`)
            )
          )
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `조회기간 평균가 (${idxLabel(is)}~${idxLabel(ie)})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, periodAvgAmt != null ? `${round(periodAvgAmt).toLocaleString()} ${unit}` : "—")
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, "조회기간 총 거래두수"),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, periodTotalCnt != null ? `${Math.round(periodTotalCnt).toLocaleString()} 두` : "—")
        )
      ),

      React.createElement(ShareLinkButton, { linkCopied, onClick: copyShareLink }),
      React.createElement("div", { style: { height: 8 } }),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "지표"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            React.createElement("button", {
              onClick: () => setShowOverall((v) => !v),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                border: `1.5px solid ${showOverall ? COLORS.amber : COLORS.panelBorder2}`,
                background: showOverall ? COLORS.amber : COLORS.panel,
                color: showOverall ? "#ffffff" : COLORS.cream
              }
            }, "\u{1F4CA} 전체평균"),
            React.createElement("div", { style: { width: 1, alignSelf: "stretch", background: COLORS.panelBorder2, margin: "0 2px" } }),
            gradeNames.map((g) => React.createElement(Toggle, {
              key: g, active: showGrades.includes(g),
              onClick: () => setShowGrades((s) => s.includes(g) ? s.filter((x) => x !== g) : [...s, g])
            }, g)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement(ResetFilterButton, { onClick: resetFilters }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "기간 (주 단위)"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            [["13", "최근 13주(3개월)"], ["26", "최근 26주(6개월)"], ["52", "최근 52주(1년)"]].map(([n, lbl]) => React.createElement(Toggle, {
              key: n, active: ie === IDX_MAX && is === Math.max(IDX_MIN, IDX_MAX - (Number(n) - 1)), color: COLORS.sage,
              onClick: () => { setIdxEnd(IDX_MAX); setIdxStart(Math.max(IDX_MIN, IDX_MAX - (Number(n) - 1))); }
            }, lbl)),
            React.createElement(Toggle, {
              active: is === IDX_MIN && ie === IDX_MAX, color: COLORS.sage,
              onClick: () => { setIdxStart(IDX_MIN); setIdxEnd(IDX_MAX); }
            }, "전체"),
            IDX_MAX >= 0 && React.createElement(HoverAxisPicker, {
              label: "시작주", value: is,
              onChange: (v) => { const nv = +v; setIdxStart(nv); if (nv > ie) setIdxEnd(nv); },
              options: weekly.map((w, i) => [i, w.label])
            }),
            React.createElement("span", { style: { color: COLORS.mute } }, "\u2013"),
            IDX_MAX >= 0 && React.createElement(HoverAxisPicker, {
              label: "종료주", value: ie,
              onChange: (v) => { const nv = +v; setIdxEnd(nv); if (nv < is) setIdxStart(nv); },
              options: weekly.map((w, i) => [i, w.label])
            })
          )
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" })
      ),

      mainTab === "chart" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
          React.createElement(SubTab, { active: chartSub === "trend", onClick: () => setChartSub("trend"), label: "\uCD94\uC774" }),
          React.createElement(SubTab, { active: chartSub === "group", onClick: () => setChartSub("group"), label: "\uADF8\uB8F9 \uBE44\uAD50" }),
          React.createElement(SubTab, { active: chartSub === "overlay", onClick: () => setChartSub("overlay"), label: "\uACB9\uCCD0\uBCF4\uAE30" })
        ),

        chartSub === "trend" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
          categories.length
            ? React.createElement(React.Fragment, null,
                React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => Math.round(v).toLocaleString() }),
                React.createElement(ChartLegend, { series })
              )
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
        ),

        chartSub === "group" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 } },
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute } }, `\uC804\uCCB4\uD3C9\uADE0\uACFC \uAC01 \uB4F1\uAE09\uC758 \uC870\uD68C\uAE30\uAC04(${idxLabel(is)}~${idxLabel(ie)}) \uD3C9\uADE0\uAC00\uB97C \uBE44\uAD50\uD569\uB2C8\uB2E4.`),
            React.createElement("button", { onClick: exportGroupXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          ),
          groupItems.length
            ? React.createElement(BarRanking, { items: groupItems, formatValue: (v) => `${Math.round(v).toLocaleString()} ${unit}` })
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
        ),

        chartSub === "overlay" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 } },
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute } }, `\uC5F0\uB3C4\uBCC4\uB85C 1~53\uC8FC \uCD95 \uC704\uC5D0 \uACB9\uCCD0\uC11C \uACC4\uC808 \uD328\uD134\uC744 \uBE44\uAD50\uD569\uB2C8\uB2E4 (${overlayTargetGrades ? overlayTargetGrades.join(", ") : "\uC804\uCCB4\uD3C9\uADE0"}).`),
            React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          ),
          overlay.series.length && overlay.categories.length
            ? React.createElement(React.Fragment, null,
                React.createElement(SvgLineChart, { categories: overlay.categories, series: overlay.series, formatAxisValue: (v) => Math.round(v).toLocaleString() }),
                React.createElement(ChartLegend, { series: overlay.series })
              )
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
        )
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 20 } },
        filtered.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, background: COLORS.head, zIndex: 3 } }, "연도-주차"),
                  React.createElement("th", { style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, "전체평균"),
                  React.createElement("th", { style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, "두수"),
                  showGrades.map((g) => React.createElement("th", { key: g, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, g))
                )),
                React.createElement("tbody", null, [...filtered].reverse().map((w) => React.createElement("tr", { key: w.label, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, w.label),
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, round(w.avgAmt)?.toLocaleString() ?? "—"),
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.mute, textAlign: "right" } }, w.avgCnt?.toLocaleString() ?? "—"),
                  showGrades.map((g) => React.createElement("td", { key: g, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, w.byGrade?.[g]?.amt ? round(Number(w.byGrade[g].amt)).toLocaleString() : "—"))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { padding: "8px 10px", position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "기간 평균/합계"),
                  React.createElement("td", { style: { padding: "8px 10px", textAlign: "right", fontWeight: 800, color: COLORS.amberSoft } }, periodAvgAmt != null ? round(periodAvgAmt).toLocaleString() : "—"),
                  React.createElement("td", { style: { padding: "8px 10px", textAlign: "right", fontWeight: 800, color: COLORS.amberSoft } }, periodTotalCnt != null ? Math.round(periodTotalCnt).toLocaleString() : "—"),
                  showGrades.map((g) => React.createElement("td", { key: g, style: { padding: "8px 10px" } }))
                ))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
      ),

      React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute } },
        `출처: ${raw.source || "축산물품질평가원(KAPE)"} \u00B7 수집: ${raw.updatedAt || "—"}`
      )
    );
  };
})();
