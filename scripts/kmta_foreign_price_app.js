/* 축산레이더 · KMTA(한국육류유통수출협회) 해외시세(돈육 지육가격 국제비교)
   https://www.kmta.or.kr/kr/price/foreign.php 를 주 단위로 수집한 data/kmta_foreign_price.json.
   단위 US$/kg, 지육가격 기준(일본은 동경시장 기준). 국내 돈육 가격과 비교할 때
   원/kg ↔ US$/kg 환산과 관세/운임 차이까지 감안해야 해서 직접 스프레드 계산은 안 함. */
window.KmtaForeignPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, fmtUpdatedAt, downloadXlsx } = window.RadarUI;
  const Toggle = PillToggle;
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5", "#4a8fa8"];

  return function KmtaForeignPriceApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    React.useEffect(() => {
      fetch("./data/kmta_foreign_price.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    const weeks = raw?.weeks || [];
    const itemNames = useMemo(() => {
      const set = new Set();
      weeks.forEach((w) => Object.keys(w.byCountry || {}).forEach((n) => set.add(n)));
      return [...set];
    }, [weeks]);

    const [selected, setSelected] = useState([]);
    const [showOverall, setShowOverall] = useState(true);
    const [mainTab, setMainTab] = useState("chart");
    const [idxStart, setIdxStart] = useState(null);
    const [idxEnd, setIdxEnd] = useState(null);

    React.useEffect(() => {
      if (itemNames.length && selected.length === 0) setSelected([itemNames[0]]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemNames.join(",")]);

    const IDX_MAX = weeks.length - 1;
    const idxLabel = (i) => i == null || !weeks[i] ? "\u2014" : weeks[i].label;
    const is = idxStart ?? 0, ie = idxEnd ?? IDX_MAX;

    const filtered = useMemo(() => weeks.filter((_, i) => i >= is && i <= ie), [weeks, is, ie]);
    const categories = filtered.map((w) => w.label);

    const itemSeries = useMemo(() => selected.map((name) => ({
      id: name, name,
      color: PALETTE[itemNames.indexOf(name) % PALETTE.length],
      data: filtered.map((w) => w.byCountry?.[name] ?? null),
    })), [filtered, selected, itemNames]);

    const overallSeries = useMemo(() => {
      if (!itemNames.length) return null;
      const data = filtered.map((w) => {
        const vals = itemNames.map((n) => w.byCountry?.[n]).filter((v) => v != null && isFinite(v));
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return { id: "__overall", name: "전체(국가평균)", color: COLORS.rust, data };
    }, [filtered, itemNames]);

    const series = [...(showOverall && overallSeries ? [overallSeries] : []), ...itemSeries];
    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();
    const periodAvgByItem = useMemo(() => series.map((s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return { name: s.name, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    }), [series]);

    const exportXlsx = () => {
      const header = ["연-월-주", ...series.map((s) => `${s.name}(US$/kg)`)];
      const rows = tableIdx.map((i) => [categories[i], ...series.map((s) => s.data[i] != null ? s.data[i].toFixed(2) : "")]);
      downloadXlsx([header, ...rows], `KMTA_돈육_해외시세_${idxLabel(is)}~${idxLabel(ie)}.xlsx`, "해외시세");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const latest = weeks[weeks.length - 1];
    const prevW = weeks[weeks.length - 2];
    const headline = selected[0] || itemNames[0];
    const latestVal = latest ? latest.items?.[headline] ?? null : null;
    const prevVal = prevW ? prevW.items?.[headline] ?? null : null;
    const diffPct = latestVal != null && prevVal ? Math.round((latestVal - prevVal) / prevVal * 1000) / 10 : null;

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "해외시세 (돈육 국제가격)"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "\uD55C\uAD6D\uC721\uB958\uC720\uD1B5\uC218\uCD9C\uD611\uD68C(KMTA) \u00B7 \uB3C8\uC721 \uC9C0\uC721\uAC00\uACA9(US$/kg) \u00B7 \uAD6D\uAC00\uBCC4 \u00B7 \uC8FC \uB2E8\uC704 \u00B7 \uC77C\uBCF8\uC740 \uB3D9\uACBD\uC2DC\uC7A5 \uAE30\uC900"
      ),

      latest && React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `\uCD5C\uADFC(${latest.label}) ${headline || ""}`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, latestVal != null ? `US$ ${latestVal.toFixed(2)}/kg` : "\u2014"),
          diffPct != null && React.createElement("div", { style: { fontSize: 12, color: diffPct > 0 ? COLORS.rust : COLORS.sage, marginTop: 4 } }, `\uC804\uC8FC\uB300\uBE44 ${diffPct > 0 ? "+" : ""}${diffPct}%`)
        )
      ),

      periodAvgByItem.length > 0 && React.createElement("div", { style: { marginBottom: 14 } },
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 8 } }, `\uC870\uD68C\uAE30\uAC04 \uD3C9\uADE0\uAC00 (${idxLabel(is)}~${idxLabel(ie)})`),
        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
          periodAvgByItem.map((it) => React.createElement("div", { key: it.name, style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "10px 14px", minWidth: 110 } },
            React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 4 } }, it.name),
            React.createElement("div", { style: { fontSize: 17, fontWeight: 800, color: COLORS.cream } }, it.avg != null ? `$${it.avg.toFixed(2)}` : "\u2014")
          ))
        )
      ),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "\uAD6D\uAC00"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            React.createElement("button", {
              onClick: () => setShowOverall((v) => !v),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                border: `1.5px solid ${showOverall ? COLORS.amber : COLORS.panelBorder2}`,
                background: showOverall ? COLORS.amber : COLORS.panel,
                color: showOverall ? "#ffffff" : COLORS.cream
              }
            }, "\u{1F4CA} \uC804\uCCB4(\uAD6D\uAC00\uD3C9\uADE0)"),
            React.createElement("div", { style: { width: 1, alignSelf: "stretch", background: COLORS.panelBorder2, margin: "0 2px" } }),
            itemNames.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, id)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "\uAE30\uAC04 (\uC8FC \uB2E8\uC704)"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            [["13", "\uCD5C\uADFC 13\uC8FC"], ["26", "\uCD5C\uADFC 26\uC8FC"], ["52", "\uCD5C\uADFC 52\uC8FC"]].map(([n, lbl]) => React.createElement(Toggle, {
              key: n, active: ie === IDX_MAX && is === Math.max(0, IDX_MAX - (Number(n) - 1)), color: COLORS.sage,
              onClick: () => { setIdxEnd(IDX_MAX); setIdxStart(Math.max(0, IDX_MAX - (Number(n) - 1))); }
            }, lbl)),
            React.createElement(Toggle, { active: is === 0 && ie === IDX_MAX, color: COLORS.sage, onClick: () => { setIdxStart(0); setIdxEnd(IDX_MAX); } }, "\uC804\uCCB4"),
            IDX_MAX >= 0 && React.createElement(HoverAxisPicker, { label: "\uC2DC\uC791", value: is, onChange: (v) => { const nv = +v; setIdxStart(nv); if (nv > ie) setIdxEnd(nv); }, options: weeks.map((w, i) => [i, w.label]) }),
            React.createElement("span", { style: { color: COLORS.mute } }, "\u2013"),
            IDX_MAX >= 0 && React.createElement(HoverAxisPicker, { label: "\uC885\uB8CC", value: ie, onChange: (v) => { const nv = +v; setIdxEnd(nv); if (nv < is) setIdxStart(nv); }, options: weeks.map((w, i) => [i, w.label]) })
          )
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "\uCC28\uD2B8" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "\uD45C" })
      ),

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        series.length && categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => `$${v.toFixed(2)}` }),
              React.createElement(ChartLegend, { series })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uD45C\uC2DC\uD560 \uAD6D\uAC00\uC744 \uC120\uD0DD\uD558\uC138\uC694.")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        series.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head } }, "\uC5F0-\uC6D4-\uC8FC"),
                  series.map((s) => React.createElement("th", { key: s.id, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, zIndex: 2, background: COLORS.head } }, s.name))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: categories[i], style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, categories[i]),
                  series.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, s.data[i] != null ? s.data[i].toFixed(2) : "\u2014"))
                )))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uD45C\uC2DC\uD560 \uAD6D\uAC00\uC744 \uC120\uD0DD\uD558\uC138\uC694.")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `\uC218\uC9D1: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "\u2014"} \u00B7 ${raw.source || ""} \u00B7 `,
        React.createElement("a", { href: raw.sourceUrl, target: "_blank", rel: "noopener noreferrer", style: { color: COLORS.mute } }, "\uC6D0\uBCF8 \uD398\uC774\uC9C0")
      )
    );
  };
})();
