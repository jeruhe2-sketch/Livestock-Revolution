/* 축산레이더 · 국내 도매시장 경락가격(소/돼지)
   지육(도체) 기준 전국 주간 가중평균. 소매가/수입단가와 단위가 달라 직접 비교 안 함. */
window.AuctionPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, downloadXlsx } = window.RadarUI;
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

    const [species, setSpecies] = useState("돼지");
    const [showGrades, setShowGrades] = useState([]);
    const [mainTab, setMainTab] = useState("chart");
    const [idxStart, setIdxStart] = useState(null);
    const [idxEnd, setIdxEnd] = useState(null);

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
    React.useEffect(() => { setIdxStart(null); setIdxEnd(null); }, [species]);

    const filtered = useMemo(() => weekly.filter((_, i) => i >= is && i <= ie), [weekly, is, ie]);

    const categories = filtered.map((w) => w.label);
    const avgSeries = [{ id: "평균", name: "전체평균", color: "#b96a2e", data: filtered.map((w) => round(w.avgAmt)) }];
    const gradeSeries = showGrades.map((g, idx) => ({
      id: g, name: g,
      color: PALETTE[(idx + 1) % PALETTE.length],
      data: filtered.map((w) => w.byGrade?.[g]?.amt != null ? round(Number(w.byGrade[g].amt)) : null),
    }));
    const series = [...avgSeries, ...gradeSeries];

    const latest = weekly[weekly.length - 1];
    const prev = weekly[weekly.length - 2];
    const diffPct = latest && prev && prev.avgAmt ? round((latest.avgAmt - prev.avgAmt) / prev.avgAmt * 1000) / 10 : null;

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

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        latest && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `최근 주(${latest.label})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, `${round(latest.avgAmt).toLocaleString()} ${unit}`),
          diffPct != null && React.createElement("div", { style: { fontSize: 12, color: diffPct > 0 ? COLORS.rust : COLORS.sage, marginTop: 4 } }, `전주대비 ${diffPct > 0 ? "+" : ""}${diffPct}%`)
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

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "등급"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            gradeNames.map((g) => React.createElement(Toggle, {
              key: g, active: showGrades.includes(g),
              onClick: () => setShowGrades((s) => s.includes(g) ? s.filter((x) => x !== g) : [...s, g])
            }, g)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
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

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
        categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => Math.round(v).toLocaleString() }),
              React.createElement(ChartLegend, { series })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
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
