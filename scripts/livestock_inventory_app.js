/* 축산레이더 · 국내 축산물 재고동향
   축산물품질평가원(KAPE) 공식 API(data.ekape.or.kr)로 GitHub Actions가 매일 수집한
   data/livestock_inventory.json을 그린다. 조사업체 표본 기준 추정치, 월 단위,
   집계 시차 2~3개월 (예: 9월 기준 최신은 6~7월치).
   단위: 소=kg, 돼지=ton (그대로 표기, 서로 합산/비교하지 않음). */
window.LivestockInventoryApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, fmtUpdatedAt, downloadXlsx } = window.RadarUI;

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
    const [species, setSpecies] = useState("돼지");
    const [selected, setSelected] = useState(["총재고"]);
    const [mainTab, setMainTab] = useState("chart");
    const [ymStart, setYmStart] = useState(null);
    const [ymEnd, setYmEnd] = useState(null);

    const speciesData = raw?.species?.[species];
    const history = speciesData?.history || [];
    const unit = history[0]?.unit || "";

    const partNames = useMemo(() => {
      const set = new Set();
      history.forEach((h) => Object.keys(h.parts || {}).forEach((p) => set.add(p)));
      return [...set];
    }, [history]);
    const ALL_INDICATORS = ["총재고", ...partNames];

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
    const series = useMemo(() => {
      return selected.map((name, idx) => ({
        id: name,
        name,
        color: PALETTE[ALL_INDICATORS.indexOf(name) % PALETTE.length],
        data: filtered.map((h) => name === "총재고" ? h.totStock : (h.parts?.[name] ?? null)),
      }));
    }, [filtered, selected, ALL_INDICATORS]);

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();
    const colAvg = (s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const exportXlsx = () => {
      const header = ["연월", ...selected.map((s) => `${s}(${unit})`)];
      const rows = tableIdx.map((i) => [categories[i], ...series.map((s) => s.data[i] != null ? s.data[i] : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_재고동향.xlsx`, "재고동향");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const latest = history[history.length - 1];
    const prevMonth = history[history.length - 2];
    const momPct = latest && prevMonth ? (latest.totStock - prevMonth.totStock) / prevMonth.totStock * 100 : null;

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

      latest && React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 170, flex: "1 1 170px" } },
          React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, `${species} 총재고 (${latest.yearMonth})`),
          React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, `${latest.totStock?.toLocaleString() ?? "—"} ${unit}`),
          momPct != null && React.createElement("div", { style: { fontSize: 12, color: momPct > 0 ? COLORS.rust : COLORS.sage, marginTop: 4 } }, `전월대비 ${momPct > 0 ? "+" : ""}${momPct.toFixed(1)}%`)
        )
      ),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "부위"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            ALL_INDICATORS.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, id)),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드")
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
        series.length && categories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0) }),
              React.createElement(ChartLegend, { series })
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      mainTab === "table" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        series.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 90 } }, "연월"),
                  series.map((s) => React.createElement("th", { key: s.id, style: { textAlign: "right", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, minWidth: 100 } }, s.name))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: categories[i], style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { padding: "8px 10px", color: COLORS.cream, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, categories[i]),
                  series.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", color: COLORS.cream, textAlign: "right" } }, s.data[i] != null ? s.data[i].toLocaleString() : "—"))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { padding: "8px 10px", position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "평균"),
                  series.map((s) => React.createElement("td", { key: s.id, style: { padding: "8px 10px", textAlign: "right", fontWeight: 800, color: COLORS.amberSoft } }, (() => { const a = colAvg(s); return a != null ? Math.round(a).toLocaleString() : "—"; })()))
                ))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 부위를 선택하세요.")
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `단위: ${unit || "—"} \u00B7 수집: ${fmtUpdatedAt(raw.updatedAt) || raw.updatedAt || "—"} \u00B7 ${raw.source || ""}`
      )
    );
  };
})();
