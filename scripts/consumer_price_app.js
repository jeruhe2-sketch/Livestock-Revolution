/* 축산레이더 · 국내 축산물 소비자가격
   축산물품질평가원(KAPE) 공식 API로 수집한 data/consumer_price.json을 그린다.
   오늘 시세 스냅샷(consumerPriceDaily) + 월별 추이(consumerPriceMonth) +
   연도별 평년비교(consumerPriceYear) 세 가지를 한 화면에서. */
window.ConsumerPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, fmtUpdatedAt, downloadXlsx } = window.RadarUI;

  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5", "#4a8fa8", "#a06a9a"];
  const Toggle = PillToggle;

  return function ConsumerPriceApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    React.useEffect(() => {
      fetch("./data/consumer_price.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    const [species, setSpecies] = useState("돼지");
    const [selected, setSelected] = useState([]);
    const [mainTab, setMainTab] = useState("chart");
    const [ymStart, setYmStart] = useState(null);
    const [ymEnd, setYmEnd] = useState(null);

    const speciesData = raw?.species?.[species];
    const history = speciesData?.history || [];
    const yearly = speciesData?.yearly || [];
    const tendays = speciesData?.tendays || [];
    const unit = speciesData?.unit || "원/100g";

    const itemNames = useMemo(() => {
      const set = new Set();
      history.forEach((h) => Object.keys(h.items || {}).forEach((n) => set.add(n)));
      return [...set];
    }, [history]);

    React.useEffect(() => {
      if (itemNames.length && selected.length === 0) setSelected([itemNames[0]]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemNames.join(",")]);

    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const all = history.map((h) => { const [y, m] = h.yearMonth.split("-"); return +y * 100 + +m; });
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

    const filtered = useMemo(() => history.filter((h) => {
      const [y, m] = h.yearMonth.split("-");
      const ym = +y * 100 + +m;
      return (ys == null || ym >= ys) && (ye == null || ym <= ye);
    }), [history, ys, ye]);

    const categories = filtered.map((h) => h.yearMonth);
    const series = useMemo(() => selected.map((name) => ({
      id: name, name,
      color: PALETTE[itemNames.indexOf(name) % PALETTE.length],
      data: filtered.map((h) => h.items?.[name] ?? null),
    })), [filtered, selected, itemNames]);

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();

    const exportXlsx = () => {
      const header = ["연월", ...selected.map((s) => `${s}(${unit})`)];
      const rows = tableIdx.map((i) => [categories[i], ...series.map((s) => s.data[i] != null ? Math.round(s.data[i]) : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_소비자가격.xlsx`, "소비자가격");
    };

    const tendaysRecent = tendays.slice(-36);
    const tenCategories = tendaysRecent.map((t) => t.label);
    const tenSeries = useMemo(() => selected.map((name) => ({
      id: name, name,
      color: PALETTE[itemNames.indexOf(name) % PALETTE.length],
      data: tendaysRecent.map((t) => t.items?.[name] ?? null),
    })), [tendaysRecent, selected, itemNames]);

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const snapshot = speciesData?.latestSnapshot || {};
    const snapshotItems = Object.keys(snapshot);
    const thisYear = new Date().getFullYear();
    const avgYear = yearly.find((y) => y.year === String(thisYear));

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "국내 축산물 소비자가격"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "축산물품질평가원(KAPE) 소매가격 조사 \u00B7 전국 평균, 단위 " + unit
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 16 } },
        ["돼지", "소"].map((sp) => React.createElement(SubTab, {
          key: sp, active: species === sp, onClick: () => { setSpecies(sp); setSelected([]); }, label: sp
        }))
      ),

      React.createElement("div", { style: { marginBottom: 18 } },
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 8 } }, `오늘 시세 (${speciesData?.latestDate ? `${speciesData.latestDate.slice(0,4)}.${speciesData.latestDate.slice(4,6)}.${speciesData.latestDate.slice(6,8)}` : "—"} 기준)`),
        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
          snapshotItems.length ? snapshotItems.map((name) => {
            const yearAvg = avgYear?.items?.[name];
            const val = snapshot[name];
            const diffPct = yearAvg ? (val - yearAvg) / yearAvg * 100 : null;
            return React.createElement("div", { key: name, style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "10px 14px", minWidth: 110 } },
              React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 4 } }, name),
              React.createElement("div", { style: { fontSize: 17, fontWeight: 800, color: COLORS.cream } }, Math.round(val).toLocaleString()),
              diffPct != null && React.createElement("div", { style: { fontSize: 11, color: diffPct > 0 ? COLORS.rust : COLORS.sage } }, `연평균대비 ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%`)
            );
          }) : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "오늘 시세 없음")
        )
      ),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "부위"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            itemNames.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, id)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "기간"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            [["6", "최근 6개월"], ["12", "최근 1년"], ["36", "최근 3년"]].map(([m, lbl]) => React.createElement(Toggle, {
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
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" }),
        React.createElement(SubTab, { active: mainTab === "tendays", onClick: () => setMainTab("tendays"), label: "순별(초중하)" }),
        React.createElement(SubTab, { active: mainTab === "yearly", onClick: () => setMainTab("yearly"), label: "연도별 평균" })
      ),

      mainTab === "chart" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        series.length && categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => v.toLocaleString() }),
              React.createElement(ChartLegend, { series })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        series.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head } }, "연월"),
                  series.map((s) => React.createElement("th", { key: s.id, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, minWidth: 100 } }, s.name))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: categories[i], style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, categories[i]),
                  series.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, s.data[i] != null ? Math.round(s.data[i]).toLocaleString() : "—"))
                )))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      mainTab === "tendays" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
        tenSeries.length && tenCategories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories: tenCategories, series: tenSeries, formatAxisValue: (v) => v.toLocaleString() }),
              React.createElement(ChartLegend, { series: tenSeries }),
              React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginTop: 8 } }, "최근 12개월(36개 순) 기준 \u00B7 초순/중순/하순")
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      mainTab === "yearly" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        yearly.length
          ? React.createElement("div", { style: { overflowX: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}` } }, "연도"),
                  itemNames.map((n) => React.createElement("th", { key: n, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}` } }, n))
                )),
                React.createElement("tbody", null, [...yearly].reverse().map((y) => React.createElement("tr", { key: y.year, style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, fontWeight: 700 } }, y.year),
                  itemNames.map((n) => React.createElement("td", { key: n, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, y.items?.[n] != null ? Math.round(y.items[n]).toLocaleString() : "—"))
                )))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "연도별 데이터 없음")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `수집: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "—"} \u00B7 ${raw.source || ""}`
      )
    );
  };
})();
