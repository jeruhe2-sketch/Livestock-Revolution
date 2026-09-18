/* 축산레이더 · 국내 축산물 소비자가격
   축산물품질평가원(KAPE) 공식 API로 수집한 data/consumer_price.json을 그린다.
   오늘 시세 스냅샷(consumerPriceDaily) + 월별 추이(consumerPriceMonth) +
   연도별 평년비교(consumerPriceYear) 세 가지를 한 화면에서. */
window.ConsumerPriceApp = (function () {
  const { useState, useMemo } = React;
  const { COLORS, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, BarRanking, fmtUpdatedAt, downloadXlsx, buildYearOverlay } = window.RadarUI;

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
    const [showOverall, setShowOverall] = useState(true);
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
    // "전체" = 추적 중인 모든 부위를 합쳐 낸 단순평균(단위가 다 원/100g로 같아서 비교 가능).
    // 재고동향 탭의 "총재고" 버튼과 같은 역할 - 부위별로 쪼개보기 전에 전체 흐름부터.
    const overallSeries = useMemo(() => {
      if (!itemNames.length) return null;
      const data = filtered.map((h) => {
        const vals = itemNames.map((n) => h.items?.[n]).filter((v) => v != null && isFinite(v));
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return { id: "__overall", name: "전체(부위평균)", color: COLORS.rust, data };
    }, [filtered, itemNames]);
    const series = useMemo(() => [
      ...(showOverall && overallSeries ? [overallSeries] : []),
      ...selected.map((name) => ({
        id: name, name,
        color: PALETTE[itemNames.indexOf(name) % PALETTE.length],
        data: filtered.map((h) => h.items?.[name] ?? null),
      }))
    ], [filtered, selected, itemNames, showOverall, overallSeries]);

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    const tableIdx = categories.map((_, i) => i).reverse();
    const periodAvgByItem = useMemo(() => series.map((s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return { name: s.name, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    }), [series]);

    const exportXlsx = () => {
      const header = ["연월", ...selected.map((s) => `${s}(${unit})`)];
      const rows = tableIdx.map((i) => [categories[i], ...series.map((s) => s.data[i] != null ? Math.round(s.data[i]) : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_소비자가격.xlsx`, "소비자가격");
    };

    // ── 그룹 비교(부위별 랭킹) / 겹쳐보기(연도별 계절 패턴) ──
    const [chartSub, setChartSub] = useState("trend");
    const groupItems = useMemo(() => itemNames.map((name) => {
      const vals = filtered.map((h) => h.items?.[name]).filter((v) => v != null && isFinite(v));
      return { key: name, v: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
    }).sort((a, b) => b.v - a.v), [filtered, itemNames]);

    const overlayTargetNames = selected.length ? selected : itemNames;
    const overlay = useMemo(() => buildYearOverlay(history, {
      yearOf: (h) => +h.yearMonth.split("-")[0],
      bucketOf: (h) => +h.yearMonth.split("-")[1],
      bucketLabel: (b) => `${b}\uC6D4`,
      valueOf: (h) => {
        const vals = overlayTargetNames.map((n) => h.items?.[n]).filter((v) => v != null && isFinite(v));
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      },
    }), [history, overlayTargetNames.join(",")]);

    const exportGroupXlsx = () => {
      const header = ["부위", `평균가(${unit})`];
      const rows = groupItems.map((it) => [it.key, Math.round(it.v)]);
      downloadXlsx([header, ...rows], `국내_${species}_소비자가격_그룹비교_${ymLabel(ys)}~${ymLabel(ye)}.xlsx`, "그룹비교");
    };
    const exportOverlayXlsx = () => {
      const header = ["월", ...overlay.series.map((s) => s.name)];
      const rows = overlay.categories.map((c, i) => [c, ...overlay.series.map((s) => s.data[i] != null ? Math.round(s.data[i]) : "")]);
      downloadXlsx([header, ...rows], `국내_${species}_소비자가격_겹쳐보기.xlsx`, "겹쳐보기");
    };

    // 순별(초/중/하순, 월 3회) 기간 필터 - 일단위는 아니지만 월별보다 촘촘한 단위
    const TEN_MAX = tendays.length - 1;
    const [tenIdxStart, setTenIdxStart] = useState(null);
    React.useEffect(() => { setTenIdxStart(null); }, [species]);
    const tenStart = tenIdxStart ?? Math.max(0, TEN_MAX - 35);
    const tendaysRecent = useMemo(() => tendays.filter((_, i) => i >= tenStart), [tendays, tenStart]);
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
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "지표"),
          React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            React.createElement("button", {
              onClick: () => setShowOverall((v) => !v),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                border: `1.5px solid ${showOverall ? COLORS.amber : COLORS.panelBorder2}`,
                background: showOverall ? COLORS.amber : COLORS.panel,
                color: showOverall ? "#ffffff" : COLORS.cream
              }
            }, "\u{1F4CA} 전체(부위평균)"),
            React.createElement("div", { style: { width: 1, alignSelf: "stretch", background: COLORS.panelBorder2, margin: "0 2px" } }),
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

      periodAvgByItem.length > 0 && React.createElement("div", { style: { marginBottom: 14 } },
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 8 } }, `조회기간 평균가 (${ymLabel(ys)}~${ymLabel(ye)})`),
        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
          periodAvgByItem.map((it) => React.createElement("div", { key: it.name, style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "10px 14px", minWidth: 110 } },
            React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 4 } }, it.name),
            React.createElement("div", { style: { fontSize: 17, fontWeight: 800, color: COLORS.cream } }, it.avg != null ? Math.round(it.avg).toLocaleString() : "—")
          ))
        )
      ),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SubTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
        React.createElement(SubTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" }),
        React.createElement(SubTab, { active: mainTab === "tendays", onClick: () => setMainTab("tendays"), label: "순별(초중하)" }),
        React.createElement(SubTab, { active: mainTab === "yearly", onClick: () => setMainTab("yearly"), label: "연도별 평균" })
      ),

      mainTab === "chart" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
          React.createElement(SubTab, { active: chartSub === "trend", onClick: () => setChartSub("trend"), label: "\uCD94\uC774" }),
          React.createElement(SubTab, { active: chartSub === "group", onClick: () => setChartSub("group"), label: "\uADF8\uB8F9 \uBE44\uAD50" }),
          React.createElement(SubTab, { active: chartSub === "overlay", onClick: () => setChartSub("overlay"), label: "\uACB9\uCCD0\uBCF4\uAE30" })
        ),

        chartSub === "trend" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
          series.length && categories.length
            ? React.createElement(React.Fragment, null,
                React.createElement(SvgLineChart, { categories, series, formatAxisValue: (v) => v.toLocaleString() }),
                React.createElement(ChartLegend, { series })
              )
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uD45C\uC2DC\uD560 \uBD80\uC704\uB97C \uC120\uD0DD\uD558\uC138\uC694.")
        ),

        chartSub === "group" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 } },
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute } }, `\uAC01 \uBD80\uC704\uC758 \uC870\uD68C\uAE30\uAC04(${ymLabel(ys)}~${ymLabel(ye)}) \uD3C9\uADE0\uAC00\uB97C \uBE44\uAD50\uD569\uB2C8\uB2E4.`),
            React.createElement("button", { onClick: exportGroupXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          ),
          groupItems.length
            ? React.createElement(BarRanking, { items: groupItems, formatValue: (v) => `${Math.round(v).toLocaleString()} ${unit}` })
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
        ),

        chartSub === "overlay" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 } },
            React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute } }, "\uC5F0\uB3C4\uBCC4\uB85C 1~12\uC6D4 \uCD95 \uC704\uC5D0 \uACB9\uCCD0\uC11C \uACC4\uC808 \uD328\uD134\uC744 \uBE44\uAD50\uD569\uB2C8\uB2E4 (\uD604\uC7AC \uC120\uD0DD\uB41C \uBD80\uC704 \uD3C9\uADE0)."),
            React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream } }, "\u{1F4E5} \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC")
          ),
          overlay.series.length && overlay.categories.length
            ? React.createElement(React.Fragment, null,
                React.createElement(SvgLineChart, { categories: overlay.categories, series: overlay.series, formatAxisValue: (v) => v.toLocaleString() }),
                React.createElement(ChartLegend, { series: overlay.series })
              )
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "\uB370\uC774\uD130 \uC5C6\uC74C")
        )
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
        React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
          React.createElement("span", { style: { fontSize: 12, color: COLORS.mute } }, "기간:"),
          [["12", "최근 12순(4개월)"], ["24", "최근 24순(8개월)"], ["36", "최근 36순(1년)"]].map(([n, lbl]) => React.createElement(Toggle, {
            key: n, active: tenStart === Math.max(0, TEN_MAX - (Number(n) - 1)), color: COLORS.sage,
            onClick: () => setTenIdxStart(Math.max(0, TEN_MAX - (Number(n) - 1)))
          }, lbl)),
          React.createElement(Toggle, { active: tenStart === 0, color: COLORS.sage, onClick: () => setTenIdxStart(0) }, "전체"),
          TEN_MAX >= 0 && React.createElement(HoverAxisPicker, {
            label: "시작", value: tenStart,
            onChange: (v) => setTenIdxStart(+v),
            options: tendays.map((t, i) => [i, t.label])
          })
        ),
        tenSeries.length && tenCategories.length
          ? React.createElement(React.Fragment, null,
              React.createElement(SvgLineChart, { categories: tenCategories, series: tenSeries, formatAxisValue: (v) => v.toLocaleString() }),
              React.createElement(ChartLegend, { series: tenSeries }),
              React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginTop: 8 } }, `${tenCategories[0] || "—"} ~ ${tenCategories[tenCategories.length - 1] || "—"} \u00B7 초순/중순/하순`)
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
