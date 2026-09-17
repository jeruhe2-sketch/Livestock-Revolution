/* 축산레이더 · 국내 도매시장 경락가격(소/돼지) - 심플 버전
   지육(도체) 기준 전국 평균 경락가만. 소매가/수입단가와 단위가 달라 비교 안 함. */
window.AuctionPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, SvgLineChart } = window.RadarUI;

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
    const speciesData = raw?.species?.[species];
    const daily = speciesData?.daily || [];
    const unit = speciesData?.unit || "원/kg";

    const weekKey = (dateStr) => {
      const d = new Date(dateStr);
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
    };

    const weekly = useMemo(() => {
      const groups = {};
      daily.forEach((r) => {
        if (r.avgAmt == null) return;
        const k = weekKey(r.date);
        if (!groups[k]) groups[k] = { label: k.slice(5).replace("W", ""), vals: [] };
        groups[k].vals.push(r.avgAmt);
      });
      return Object.entries(groups).map(([k, g]) => ({
        key: k, label: g.label,
        avg: round(g.vals.reduce((a, b) => a + b, 0) / g.vals.length),
      })).sort((a, b) => a.key.localeCompare(b.key));
    }, [daily]);

    const categories = weekly.map((w) => w.label);
    const series = [{ id: "avg", name: species, color: "#b96a2e", data: weekly.map((w) => w.avg) }];

    const latest = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const diffPct = latest && prev && prev.avgAmt ? round((latest.avgAmt - prev.avgAmt) / prev.avgAmt * 1000) / 10 : null;

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "국내 경락가격"),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, {
          key: sp, active: species === sp, onClick: () => setSpecies(sp), label: sp
        }))
      ),

      latest && React.createElement("div", { style: { marginBottom: 18 } },
        React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } },
          `${round(latest.avgAmt).toLocaleString()} ${unit}`
        ),
        diffPct != null && React.createElement("span", { style: { fontSize: 12, color: diffPct > 0 ? COLORS.rust : COLORS.sage } }, `전일대비 ${diffPct > 0 ? "+" : ""}${diffPct}%`)
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16 } },
        categories.length
          ? React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => Math.round(v).toLocaleString() })
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터 없음")
      )
    );
  };
})();
