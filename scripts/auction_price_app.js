/* 축산레이더 · 국내 도매시장 경락가격(소/돼지)
   축산물품질평가원(KAPE) 경매 데이터. 지육(도체) 단위 가격이라 소비자가격(부위별
   소매가)이나 수입 통관단가와는 기준이 달라 직접 비교(스프레드 계산)는 하지 않고,
   독립된 원가 지표로만 제공한다. */
window.AuctionPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, PillToggle, SvgLineChart, ChartLegend, fmtUpdatedAt, downloadXlsx } = window.RadarUI;
  const Toggle = PillToggle;
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5"];

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
    const [rangeDays, setRangeDays] = useState(22);
    const [mainTab, setMainTab] = useState("chart");
    const [showGrades, setShowGrades] = useState([]);

    const speciesData = raw?.species?.[species];
    const daily = speciesData?.daily || [];
    const unit = speciesData?.unit || "원/kg";

    const filtered = useMemo(() => daily.slice(-rangeDays), [daily, rangeDays]);
    const categories = filtered.map((d) => d.date.slice(5));

    const gradeNames = useMemo(() => {
      const set = new Set();
      daily.forEach((d) => Object.keys(d.byGrade || {}).forEach((g) => { if (g !== "평균") set.add(g); }));
      return [...set];
    }, [daily]);

    const avgSeries = [{
      id: "평균", name: "전체 평균",
      color: "#b96a2e",
      data: filtered.map((d) => d.avgAmt),
    }];
    const gradeSeries = showGrades.map((g, idx) => ({
      id: g, name: g,
      color: PALETTE[(idx + 1) % PALETTE.length],
      data: filtered.map((d) => d.byGrade?.[g]?.amt != null ? Number(d.byGrade[g].amt) : null),
    }));
    const chartSeries = [...avgSeries, ...gradeSeries];

    const latest = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const diffPct = latest && prev && prev.avgAmt ? (latest.avgAmt - prev.avgAmt) / prev.avgAmt * 100 : null;

    const tableIdx = filtered.map((_, i) => i).reverse();
    const exportXlsx = () => {
      const header = ["날짜", "전체평균", "전체두수", ...showGrades];
      const rows = tableIdx.map((i) => [
        filtered[i].date, filtered[i].avgAmt ?? "", filtered[i].avgCnt ?? "",
        ...showGrades.map((g) => filtered[i].byGrade?.[g]?.amt ?? ""),
      ]);
      downloadXlsx([header, ...rows], `국내_${species}_경락가격.xlsx`, "경락가격");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "국내 도매시장 경락가격"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 6 } },
        "축산물품질평가원(KAPE) 경매 데이터 \u00B7 지육(도체) 단위, 등급 가중평균"
      ),
      React.createElement("div", { style: { fontSize: 12, color: COLORS.amberSoft, marginBottom: 18, background: "#faf3e6", borderRadius: 8, padding: "8px 12px" } },
        "\u26A0\uFE0F 지육 기준 가격이라 소매가·수입 통관단가와 단위/기준이 달라 직접 비교(스프레드 계산)는 하지 않습니다. 국내 원가 흐름 참고용."
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, {
          key: sp, active: species === sp, onClick: () => { setSpecies(sp); setShowGrades([]); }, label: sp
        }))
      ),

      latest && React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170 } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `${species} 전체평균 경락가 (${latest.date})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, `${latest.avgAmt?.toLocaleString() ?? "—"} ${unit}`),
          diffPct != null && React.createElement("div", { style: { fontSize: 12, color: diffPct > 0 ? COLORS.rust : COLORS.sage, marginTop: 4 } }, `전일대비 ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%`)
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 130 } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, "경락두수"),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, latest.avgCnt?.toLocaleString() ?? "—")
        )
      ),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "기간"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
            [[10, "2주"], [22, "1개월"], [999, "전체"]].map(([d, lbl]) => React.createElement(Toggle, {
              key: d, active: rangeDays === d, color: COLORS.sage, onClick: () => setRangeDays(d)
            }, lbl))
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "등급별 겹쳐보기 (선택)"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            gradeNames.map((g) => React.createElement(Toggle, {
              key: g, active: showGrades.includes(g),
              onClick: () => setShowGrades((s) => s.includes(g) ? s.filter((x) => x !== g) : [...s, g])
            }, g)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
          )
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" })
      ),

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series: chartSeries, formatAxisValue: (v) => v.toLocaleString() }),
              React.createElement(ChartLegend, { series: chartSeries })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        filtered.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, background: COLORS.head, zIndex: 3 } }, "날짜"),
                  React.createElement("th", { style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, "전체평균"),
                  React.createElement("th", { style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, "두수"),
                  showGrades.map((g) => React.createElement("th", { key: g, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, background: COLORS.head, zIndex: 2 } }, g))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: filtered[i].date, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, filtered[i].date),
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, filtered[i].avgAmt?.toLocaleString() ?? "—"),
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.mute, textAlign: "right" } }, filtered[i].avgCnt?.toLocaleString() ?? "—"),
                  showGrades.map((g) => React.createElement("td", { key: g, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, filtered[i].byGrade?.[g]?.amt ? Number(filtered[i].byGrade[g].amt).toLocaleString() : "—"))
                )))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `수집: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "—"} \u00B7 ${raw.source || ""}`
      )
    );
  };
})();
