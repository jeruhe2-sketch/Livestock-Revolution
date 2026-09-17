/* 축산레이더 · 국내 도매시장 경락가격(소/돼지)
   지육(도체) 기준 전국 주간 가중평균. 소매가/수입단가와 단위가 달라 직접 비교 안 함. */
window.AuctionPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, PillToggle, SvgLineChart, ChartLegend } = window.RadarUI;
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

    const speciesData = raw?.species?.[species];
    const weekly = speciesData?.weekly || [];
    const unit = speciesData?.unit || "원/kg";

    const gradeNames = useMemo(() => {
      const set = new Set();
      weekly.forEach((w) => Object.keys(w.byGrade || {}).forEach((g) => set.add(g)));
      return [...set];
    }, [weekly]);

    const categories = weekly.map((w) => w.label);
    const avgSeries = [{ id: "평균", name: "전체평균", color: "#b96a2e", data: weekly.map((w) => round(w.avgAmt)) }];
    const gradeSeries = showGrades.map((g, idx) => ({
      id: g, name: g,
      color: PALETTE[(idx + 1) % PALETTE.length],
      data: weekly.map((w) => w.byGrade?.[g]?.amt != null ? round(Number(w.byGrade[g].amt)) : null),
    }));
    const series = [...avgSeries, ...gradeSeries];

    const latest = weekly[weekly.length - 1];
    const prev = weekly[weekly.length - 2];
    const diffPct = latest && prev && prev.avgAmt ? round((latest.avgAmt - prev.avgAmt) / prev.avgAmt * 1000) / 10 : null;

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

      latest && React.createElement("div", { style: { marginBottom: 14 } },
        React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } },
          `${round(latest.avgAmt).toLocaleString()} ${unit}`
        ),
        diffPct != null && React.createElement("span", { style: { fontSize: 12, color: diffPct > 0 ? COLORS.rust : COLORS.sage } }, `전주대비 ${diffPct > 0 ? "+" : ""}${diffPct}%`)
      ),

      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 } },
        React.createElement("span", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute } }, "등급:"),
        gradeNames.map((g) => React.createElement(Toggle, {
          key: g, active: showGrades.includes(g),
          onClick: () => setShowGrades((s) => s.includes(g) ? s.filter((x) => x !== g) : [...s, g])
        }, g))
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16 } },
        categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => Math.round(v).toLocaleString() }),
              React.createElement(ChartLegend, { series })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
      )
    );
  };
})();
