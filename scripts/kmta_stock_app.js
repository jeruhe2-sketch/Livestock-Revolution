/* 축산레이더 · KMTA(한국육류유통수출협회) 소고기/돼지고기 재고
   https://www.kmta.or.kr/kr/info/pork_stock.php, .../beef_stock.php 를 월 단위로
   수집한 data/kmta_pork_stock.json, data/kmta_beef_stock.json.
   KAPE 기반 "국내 축산물 재고동향" 탭과는 부위 분류 체계가 서로 달라 직접 비교는
   안 되지만, 서로 다른 소스로 크로스체크하기 좋음(같은 UI 패턴: 막대그래프,
   합계 전용 버튼, 조회기간 평균선). */
window.KmtaStockApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgTimeBarChart, ChartLegend, fmtUpdatedAt, downloadXlsx, readUrlParams, useShareLink, ShareLinkButton, ResetFilterButton } = window.RadarUI;
  const Toggle = PillToggle;
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5", "#4a8fa8", "#a06a9a"];
  const FILES = { "돼지": "./data/kmta_pork_stock.json", "소": "./data/kmta_beef_stock.json" };

  return function KmtaStockApp() {
    const { p, pOneOf, pList, pInt } = readUrlParams();
    const [species, setSpecies] = useState(() => pOneOf("sp", "돼지", ["돼지", "소"]));
    const [dataBySpecies, setDataBySpecies] = useState({});
    const [errorBySpecies, setErrorBySpecies] = useState({});

    React.useEffect(() => {
      Object.entries(FILES).forEach(([sp, url]) => {
        fetch(url, { cache: "no-store" })
          .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
          .then((json) => setDataBySpecies((s) => ({ ...s, [sp]: json })))
          .catch((e) => setErrorBySpecies((s) => ({ ...s, [sp]: String(e) })));
      });
    }, []);

    const raw = dataBySpecies[species];
    const error = errorBySpecies[species];
    const months = raw?.months || [];
    const unit = raw?.unit || "";

    const partNames = useMemo(() => {
      const set = new Set();
      months.forEach((mo) => Object.keys(mo.parts || {}).forEach((p) => { if (p !== "합계") set.add(p); }));
      return [...set];
    }, [months]);

    const [selected, setSelected] = useState(() => pList("sel", ["합계"]));
    const [mainTab, setMainTab] = useState(() => pOneOf("tab", "chart", ["chart", "table"]));
    const [ymStart, setYmStart] = useState(() => pInt("ys", null));
    const [ymEnd, setYmEnd] = useState(() => pInt("ye", null));

    const didMount = React.useRef(false);
    React.useEffect(() => {
      if (!didMount.current) { didMount.current = true; return; }
      setSelected(["합계"]); setYmStart(null); setYmEnd(null);
    }, [species]);

    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const all = months.map((mo) => mo.year * 100 + mo.month);
      return { ALL_YM: all, YM_MIN: all[0] ?? null, YM_MAX: all[all.length - 1] ?? null };
    }, [months]);
    const ymLabel = (ym) => ym == null ? "\u2014" : `${Math.floor(ym / 100)}\uB144 ${ym % 100}\uC6D4`;
    const addYm = (ym, delta) => {
      let y = Math.floor(ym / 100), m = ym % 100;
      m += delta;
      while (m > 12) { m -= 12; y++; }
      while (m < 1) { m += 12; y--; }
      return y * 100 + m;
    };
    const ys = ymStart ?? YM_MIN, ye = ymEnd ?? YM_MAX;

    const filtered = useMemo(() => months.filter((mo) => {
      const ym = mo.year * 100 + mo.month;
      return (ys == null || ym >= ys) && (ye == null || ym <= ye);
    }), [months, ys, ye]);

    const categories = filtered.map((mo) => mo.label);
    const baseSeries = useMemo(() => selected.map((name) => ({
      id: name, name,
      color: name === "합계" ? COLORS.amber : PALETTE[partNames.indexOf(name) % PALETTE.length],
      data: filtered.map((mo) => mo.parts?.[name] ?? null),
    })), [filtered, selected, partNames]);

    const chartSeries = useMemo(() => {
      const avgLines = baseSeries.map((s) => {
        const vals = s.data.filter((v) => v != null && isFinite(v));
        if (!vals.length) return null;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { id: `${s.id}_avg`, name: `${s.name} \uD3C9\uADE0`, color: s.color, dashed: true, data: filtered.map(() => avg) };
      }).filter(Boolean);
      return [...baseSeries, ...avgLines];
    }, [baseSeries, filtered]);

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();
    const colAvg = (s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const exportXlsx = () => {
      const header = ["\uC5F0\uC6D4", ...selected.map((s) => `${s}(${unit})`)];
      const rows = tableIdx.map((i) => [categories[i], ...baseSeries.map((s) => s.data[i] != null ? s.data[i] : "")]);
      downloadXlsx([header, ...rows], `KMTA_${species}_\uC7AC\uACE0_${ymLabel(ys)}~${ymLabel(ye)}.xlsx`, "\uC7AC\uACE0");
    };

    const periodAvgTotal = useMemo(() => {
      const vals = filtered.map((mo) => mo.parts?.["합계"]).filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }, [filtered]);

    const { linkCopied, copyShareLink } = useShareLink();
    React.useEffect(() => {
      const sp2 = new URLSearchParams();
      sp2.set("sp", species);
      sp2.set("tab", mainTab);
      if (selected.length && !(selected.length === 1 && selected[0] === "합계")) sp2.set("sel", selected.join(","));
      if (ymStart != null) sp2.set("ys", ymStart);
      if (ymEnd != null) sp2.set("ye", ymEnd);
      const newSearch = "?" + sp2.toString() + window.location.hash;
      if (newSearch !== window.location.search + window.location.hash) window.history.replaceState(null, "", newSearch);
    }, [species, mainTab, selected.join(","), ymStart, ymEnd]);
    const resetFilters = () => {
      setSpecies("돼지"); setSelected(["합계"]); setYmStart(null); setYmEnd(null); setMainTab("chart");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "\uBD88\uB7EC\uC624\uB294 \uC911...");

    const latest = months[months.length - 1];
    const prevMonth = months[months.length - 2];
    const yearAgoMonth = months[months.length - 1 - 12] || null;
    const latestTotal = latest?.parts?.["합계"];
    const prevTotal = prevMonth?.parts?.["합계"];
    const yearAgoTotal = yearAgoMonth?.parts?.["합계"];
    const momPct = latestTotal != null && prevTotal ? (latestTotal - prevTotal) / prevTotal * 100 : null;
    const yoyPct = latestTotal != null && yearAgoTotal ? (latestTotal - yearAgoTotal) / yearAgoTotal * 100 : null;


    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "\uC18C\uACE0\uAE30/\uB3FC\uC9C0\uACE0\uAE30 \uC7AC\uACE0"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "\uD55C\uAD6D\uC721\uB958\uC720\uD1B5\uC218\uCD9C\uD611\uD68C(KMTA) \u00B7 \uBD80\uC704\uBCC4 \uCD94\uC815 \uC7AC\uACE0\uB7C9 \u00B7 \uC6D4 \uB2E8\uC704 \u00B7 KAPE \uAE30\uBC18 \"\uAD6D\uB0B4 \uCD95\uC0B0\uBB3C \uC7AC\uACE0\uB3D9\uD5A5\"\uACFC\uB294 \uBD80\uC704 \uBD84\uB958\uAC00 \uB2EC\uB77C \uC9C1\uC811 \uBE44\uAD50 \uC548 \uD568(\uAD50\uCC28\uCCB4\uD06C\uC6A9)"
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, { key: sp, active: species === sp, onClick: () => setSpecies(sp), label: sp }))
      ),

      latest && React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `${species} \uD569\uACC4 (${latest.label})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, latestTotal != null ? `${latestTotal.toLocaleString()} ${unit}` : "\u2014"),
          React.createElement("div", { style: { display: "flex", gap: 14, marginTop: 6 } },
            momPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "\uC804\uC6D4 "),
              React.createElement("span", { style: { color: momPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${momPct > 0 ? "+" : ""}${momPct.toFixed(1)}%`)
            ),
            yoyPct != null && React.createElement("div", { style: { fontSize: 12 } },
              React.createElement("span", { style: { color: COLORS.mute } }, "\uC804\uB144 "),
              React.createElement("span", { style: { color: yoyPct > 0 ? COLORS.rust : COLORS.sage, fontWeight: 700 } }, `${yoyPct > 0 ? "+" : ""}${yoyPct.toFixed(1)}%`)
            )
          )
        ),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `\uC870\uD68C\uAE30\uAC04 \uD3C9\uADE0 \uD569\uACC4 (${ymLabel(ys)}~${ymLabel(ye)})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, periodAvgTotal != null ? `${Math.round(periodAvgTotal).toLocaleString()} ${unit}` : "\u2014")
        )
      ),

      React.createElement(ShareLinkButton, { linkCopied, onClick: copyShareLink }),
      React.createElement("div", { style: { height: 8 } }),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "\uC9C0\uD45C"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            React.createElement("button", {
              onClick: () => toggle("합계"),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                border: `1.5px solid ${selected.includes("합계") ? COLORS.amber : COLORS.panelBorder2}`,
                background: selected.includes("합계") ? COLORS.amber : COLORS.panel,
                color: selected.includes("합계") ? "#ffffff" : COLORS.cream
              }
            }, "\u{1F4CA} \uD569\uACC4"),
            React.createElement("div", { style: { width: 1, alignSelf: "stretch", background: COLORS.panelBorder2, margin: "0 2px" } }),
            partNames.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, id)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement(ResetFilterButton, { onClick: resetFilters }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.sage}`, background: "rgba(111,148,130,0.14)", color: COLORS.sage, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "\uAE30\uAC04"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            [["3", "\uCD5C\uADFC 3\uAC1C\uC6D4"], ["6", "\uCD5C\uADFC 6\uAC1C\uC6D4"], ["12", "\uCD5C\uADFC 1\uB144"]].map(([m, lbl]) => React.createElement(Toggle, {
              key: m, active: ye === YM_MAX && ys === addYm(YM_MAX, -(Number(m) - 1)), color: COLORS.sage,
              onClick: () => { setYmEnd(YM_MAX); setYmStart(addYm(YM_MAX, -(Number(m) - 1))); }
            }, lbl)),
            React.createElement(Toggle, { active: ys === YM_MIN && ye === YM_MAX, color: COLORS.sage, onClick: () => { setYmStart(YM_MIN); setYmEnd(YM_MAX); } }, "\uC804\uCCB4"),
            ALL_YM.length > 0 && React.createElement(HoverAxisPicker, { label: "\uC2DC\uC791\uC6D4", value: ys, onChange: (v) => { setYmStart(+v); if (+v > ye) setYmEnd(+v); }, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
            React.createElement("span", { style: { color: COLORS.mute } }, "\u2013"),
            ALL_YM.length > 0 && React.createElement(HoverAxisPicker, { label: "\uC885\uB8CC\uC6D4", value: ye, onChange: (v) => { setYmEnd(+v); if (+v < ys) setYmStart(+v); }, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) })
          )
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "\uCC28\uD2B8" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "\uD45C" })
      ),

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        chartSeries.length && categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgTimeBarChart, { categories, series: chartSeries, formatAxisValue: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0) }),
              React.createElement(ChartLegend, { series: chartSeries })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uD45C\uC2DC\uD560 \uC9C0\uD45C\uB97C \uC120\uD0DD\uD558\uC138\uC694.")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        baseSeries.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head } }, "\uC5F0\uC6D4"),
                  baseSeries.map((s) => React.createElement("th", { key: s.id, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, zIndex: 2, background: COLORS.head } }, s.name))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: categories[i], style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, categories[i]),
                  baseSeries.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, s.data[i] != null ? s.data[i].toLocaleString() : "\u2014"))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { padding: "8px 10px", position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "\uD3C9\uADE0"),
                  baseSeries.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", textAlign: "right", fontWeight: 800, color: COLORS.amberSoft } }, (() => { const a = colAvg(s); return a != null ? Math.round(a).toLocaleString() : "\u2014"; })()))
                ))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uD45C\uC2DC\uD560 \uC9C0\uD45C\uB97C \uC120\uD0DD\uD558\uC138\uC694.")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `\uC218\uC9D1: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "\u2014"} \u00B7 ${raw.source || ""} \u00B7 `,
        React.createElement("a", { href: raw.sourceUrl, target: "_blank", rel: "noopener noreferrer", style: { color: COLORS.mute } }, "\uC6D0\uBCF8 \uD398\uC774\uC9C0")
      )
    );
  };
})();
