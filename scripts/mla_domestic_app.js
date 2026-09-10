/* 축산레이더 · 호주 내수(EYCI 등) 현황
   MLA(Meat & Livestock Australia) Statistics API(인증 불필요, 공개 API)로 GitHub Actions가
   수집한 data/mla_domestic.json을 그린다.
   지표: EYCI, 중량우(Heavy Steer), 처리소(Processor Cow), 무역용 양(Trade Lamb), 머튼(Mutton)
   + 주간 도축량(NLRS 자발적 조사, 소/양)

   주의: MLA Market Report and Information Terms of Use 적용 대상 데이터.
   개인적 용도 및 내부 업무용으로만 사용. */
window.MlaDomesticApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const { COLORS, SheetTab, SubTab, HoverAxisPicker, PillToggle, SvgLineChart, ChartLegend, fmtUpdatedAt, pctFmt, downloadXlsx } = window.RadarUI;

  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5"];
  const IND_ORDER = ["0", "4", "13", "7", "11", "90cl"];
  const IND_SHORT = {
    "0": "EYCI (동부 영계)", "4": "중량우 (Heavy Steer)", "13": "처리소 (Processor Cow)",
    "7": "무역용 양 (Trade Lamb)", "11": "머튼 (Mutton)", "90cl": "90CL (미국 수입육지표)"
  };

  function fmtVal(v, unit) { return v == null || !isFinite(v) ? "—" : `${Number(v).toFixed(1)}${unit ? " " + unit : ""}`; }

  function Tile({ label, value, sub, color }) {
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 150, flex: "1 1 150px" } },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, label),
      React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, value),
      sub && React.createElement("div", { style: { fontSize: 12, color, marginTop: 4 } }, sub)
    );
  }
  const Toggle = PillToggle;
  const thStyle = { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" };
  const tdStyle = { padding: "8px 10px", color: COLORS.cream, fontFamily: "ui-monospace,monospace" };

  return function MlaDomesticApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(["0"]);
    const [normalize, setNormalize] = useState(false);
    const [mainTab, setMainTab] = useState("chart");
    const [chartSub, setChartSub] = useState("trend");
    const [overlayIndicator, setOverlayIndicator] = useState("0");
    // null이면 "전체 기간"을 의미 (아래 렌더에서 YM_MIN/YM_MAX로 대체)
    const [ymStart, setYmStart] = useState(null);
    const [ymEnd, setYmEnd] = useState(null);

    useEffect(() => {
      fetch("./data/mla_domestic.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then((data) => {
          // 90CL(usImported90cl)은 원본에서 별도 필드라, 나머지 지표들과 같은
          // indicators/indicatorNames 구조로 합쳐서 아래 로직을 그대로 재사용함.
          const indicators = { ...data.indicators, "90cl": (data.usImported90cl || []).map((r) => ({ date: r.date, value: r.value })) };
          const indicatorNames = { ...data.indicatorNames, "90cl": { desc: "US Imported 90CL Beef Indicator", unit: "US c/lb", species: "Cattle" } };
          setRaw({ ...data, indicators, indicatorNames });
        })
        .catch((e) => setError(String(e)));
    }, []);

    // EU 수출현황과 동일하게 연월(YYYYMM) 정수 단위로 전체 가용 기간을 계산.
    // raw가 아직 없어도(로딩중) 안전하게 빈 값을 반환 - 훅은 항상 호출돼야 함.
    const { ALL_YM, YM_MIN, YM_MAX } = useMemo(() => {
      const set = new Set();
      const inds = raw?.indicators || {};
      Object.values(inds).forEach((series) => series.forEach((r) => {
        const [y, m] = r.date.split("-");
        set.add(+y * 100 + +m);
      }));
      const all = [...set].sort((a, b) => a - b);
      return { ALL_YM: all, YM_MIN: all[0] ?? null, YM_MAX: all[all.length - 1] ?? null };
    }, [raw]);
    const ymLabel = (ym) => ym == null ? "—" : `${Math.floor(ym / 100)}년 ${ym % 100}월`;
    const addYm = (ym, delta) => {
      let y = Math.floor(ym / 100), m = ym % 100;
      m += delta;
      while (m > 12) { m -= 12; y++; }
      while (m < 1) { m += 12; y--; }
      return y * 100 + m;
    };

    // Hooks 규칙: raw가 없을 때 일찍 return해버리면 이 아래 훅들이 아예 호출이
    // 안 됐다가, 데이터가 로드된 다음 렌더에서 갑자기 훅 개수가 늘어나
    // "Rendered more hooks than during the previous render"(#310) 에러가 남.
    // 그래서 훅 호출은 항상 이 위치에서 raw 유무와 상관없이 실행하고,
    // 화면을 안 그리는 것(early return)은 모든 훅 호출이 끝난 뒤에만 함.
    const chartCategories = useMemoLite(raw, selected, ymStart ?? YM_MIN, ymEnd ?? YM_MAX, normalize);

    // "연도별 겹쳐보기": 선택한 지표 하나를 연도별로 나눠서 1~12월 축 위에 겹쳐 그림.
    const overlayYears = useMemo(() => {
      const series = raw?.indicators?.[overlayIndicator] || [];
      return [...new Set(series.map((r) => r.date.slice(0, 4)))].sort();
    }, [raw, overlayIndicator]);
    const overlayCategories = useMemo(() => Array.from({ length: 12 }, (_, i) => `${i + 1}월`), []);
    const overlaySeries = useMemo(() => {
      const series = raw?.indicators?.[overlayIndicator] || [];
      return overlayYears.map((y, idx) => {
        const byMonth = {};
        series.forEach((r) => {
          if (r.date.slice(0, 4) !== y) return;
          const m = Number(r.date.slice(5, 7));
          // 월 단위 비교라 그 달의 마지막(가장 최근) 값을 대표값으로 사용
          byMonth[m] = r.value;
        });
        return { name: `${y}년`, color: PALETTE[idx % PALETTE.length], data: overlayCategories.map((_, i) => byMonth[i + 1] ?? null) };
      });
    }, [raw, overlayIndicator, overlayYears, overlayCategories]);
    const exportOverlayXlsx = () => {
      const header = ["월", ...overlaySeries.map((s) => s.name)];
      const rows = overlayCategories.map((c, i) => [c, ...overlaySeries.map((s) => s.data[i] != null ? s.data[i] : "")]);
      downloadXlsx([header, ...rows], `호주내수_${IND_SHORT[overlayIndicator] || overlayIndicator}_연도별겹쳐보기.xlsx`, "겹쳐보기");
    };

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const names = raw.indicatorNames || {};
    const ys = ymStart ?? YM_MIN, ye = ymEnd ?? YM_MAX;

    const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    // 표는 최신순(내림차순)으로, 차트는 시간 흐름 그대로(오름차순) 유지
    const tableIdx = chartCategories.categories.map((_, i) => i).reverse();
    const colAvg = (s) => {
      const vals = s.data.filter((v) => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const exportXlsx = () => {
      const cats = chartCategories.categories;
      const header = ["날짜", ...selected.map((id) => IND_SHORT[id] || id)];
      const rows = tableIdx.map((i) => [cats[i], ...selected.map((id) => {
        const s = chartCategories.series.find((s2) => s2.id === id);
        return s ? (s.data[i] != null ? s.data[i] : "") : "";
      })]);
      const avgRow = ["평균", ...selected.map((id) => {
        const s = chartCategories.series.find((s2) => s2.id === id);
        const a = s ? colAvg(s) : null;
        return a != null ? Math.round(a * 100) / 100 : "";
      })];
      downloadXlsx([header, ...rows, avgRow], "호주_내수지표.xlsx", "지표");
    };

    const exportSlaughterXlsx = () => {
      const cattle = raw.slaughter?.Cattle || [], sheep = raw.slaughter?.Sheep || [];
      const dateSet = [...new Set([...cattle.map((r) => r.date), ...sheep.map((r) => r.date)])].sort();
      const cMap = Object.fromEntries(cattle.map((r) => [r.date, r.headCount]));
      const sMap = Object.fromEntries(sheep.map((r) => [r.date, r.headCount]));
      const header = ["주(종료일)", "소 도축두수", "양 도축두수"];
      downloadXlsx([header, ...dateSet.map((d) => [d, cMap[d] ?? "", sMap[d] ?? ""])], "호주_주간도축량.xlsx", "도축량");
    };

    return React.createElement("div", { style: { padding: "clamp(14px,4vw,24px) clamp(10px,3vw,16px) 40px", maxWidth: 1040, margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "호주 축산물 내수현황"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        "매일 자동 갱신 \u00B7 수동작업 없음"
      ),

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        IND_ORDER.map((id) => {
          const meta = names[id];
          const series = raw.indicators?.[id] || [];
          const latest = series[series.length - 1];
          // 90CL은 주간 데이터라 "직전 1건"이 곧 전주, 나머지는 일간이라 7일 뒤로
          const weekAgo = id === "90cl" ? series[series.length - 2] : series[series.length - 8];
          const wowPct = latest && weekAgo ? (latest.value - weekAgo.value) / weekAgo.value * 100 : null;
          return React.createElement(Tile, {
            key: id,
            label: IND_SHORT[id] || meta?.desc || id,
            value: fmtVal(latest?.value, meta?.unit),
            sub: wowPct != null ? `1주 ${pctFmt(wowPct)}` : null,
            color: wowPct > 0 ? COLORS.rust : "#3a6ea5"
          });
        })
      ),

      React.createElement("div", { style: { background: "#eef0ec", borderRadius: 12, padding: "10px 14px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: COLORS.mute, letterSpacing: "0.05em", marginBottom: 4 } }, "지표"),
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
            IND_ORDER.map((id) => React.createElement(Toggle, { key: id, active: selected.includes(id), onClick: () => toggle(id) }, IND_SHORT[id])),
            React.createElement("div", { style: { flex: 1 } }),
            React.createElement(Toggle, { active: normalize, onClick: () => setNormalize((v) => !v), color: COLORS.amberSoft }, "지수화(기준일=100)"),
            React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "엑셀 다운로드")
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
            React.createElement(HoverAxisPicker, { label: "종료월", value: ye, onChange: (v) => { setYmEnd(+v); if (+v < ys) setYmStart(+v); }, options: [...ALL_YM].reverse().map((ym) => [ym, ymLabel(ym)]) }),
            (ys !== YM_MIN || ye !== YM_MAX || selected.length !== 1 || selected[0] !== "0" || normalize || mainTab !== "chart" || chartSub !== "trend") && React.createElement("button", {
              onClick: () => { setYmStart(null); setYmEnd(null); setSelected(["0"]); setNormalize(false); setMainTab("chart"); setChartSub("trend"); },
              style: { fontSize: 13, color: COLORS.rust, background: "none", border: `1px solid ${COLORS.rust}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 700 }
            }, "필터 초기화")
          )
        )
      ),
      (() => {
        const units = new Set(selected.map((id) => names[id]?.unit).filter(Boolean));
        return selected.length > 1 && units.size > 1 && !normalize
          ? React.createElement("div", { style: { fontSize: 12, color: COLORS.rust, marginBottom: 10 } },
              `\u26A0 선택한 지표의 단위가 서로 달라요 (${[...units].join(", ")}) — 이대로 겹쳐보면 절대값 비교가 왜곡됩니다. "지수화" 켜는 걸 추천합니다.`)
          : React.createElement("div", { style: { marginBottom: 10 } });
      })(),

      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${COLORS.panelBorder}` } },
        React.createElement(SheetTab, { active: mainTab === "chart", onClick: () => setMainTab("chart"), label: "차트" }),
        React.createElement(SheetTab, { active: mainTab === "table", onClick: () => setMainTab("table"), label: "표" })
      ),

      mainTab === "chart" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 12 } },
          React.createElement(SubTab, { active: chartSub === "trend", onClick: () => setChartSub("trend"), label: "추이" }),
          React.createElement(SubTab, { active: chartSub === "overlay", onClick: () => setChartSub("overlay"), label: "연도별 겹쳐보기" })
        ),
        chartSub === "trend" && React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 24 } },
          chartCategories.series.length ? React.createElement(SvgLineChart, { categories: chartCategories.categories, series: chartCategories.series, formatAxisValue: (v) => v.toFixed(0) })
            : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 지표를 선택하세요.")
        ),
        chartSub === "overlay" && React.createElement(React.Fragment, null,
          React.createElement("div", { className: "radar-filter-row", style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 } },
            React.createElement(HoverAxisPicker, { label: "지표", value: overlayIndicator, onChange: setOverlayIndicator, options: IND_ORDER.map((id) => [id, IND_SHORT[id]]) }),
            React.createElement("button", { onClick: exportOverlayXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "엑셀 다운로드")
          ),
          React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 12 } },
            overlaySeries.length ? React.createElement(SvgLineChart, { categories: overlayCategories, series: overlaySeries, height: 340, formatAxisValue: (v) => v.toFixed(0) })
              : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "데이터가 없습니다.")
          ),
          React.createElement(ChartLegend, { series: overlaySeries })
        )
      ),

      mainTab === "table" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 8 } }, "최신 날짜가 맨 위입니다."),
        React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 } },
        chartCategories.series.length
          ? React.createElement("div", { style: { overflowX: "auto", maxHeight: 460, overflowY: "auto" } },
              React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13.5, width: "100%" } },
                React.createElement("thead", null, React.createElement("tr", null,
                  React.createElement("th", { style: { ...thStyle, position: "sticky", left: 0, top: 0, zIndex: 3, background: COLORS.head, minWidth: 90 } }, "날짜"),
                  chartCategories.series.map((s) => React.createElement("th", { key: s.id, style: { ...thStyle, position: "sticky", top: 0, zIndex: 2, background: COLORS.head, textAlign: "right", minWidth: 100 } }, s.name))
                )),
                React.createElement("tbody", null, tableIdx.map((i) => React.createElement("tr", { key: chartCategories.categories[i], style: { borderTop: `1px solid ${COLORS.panelBorder}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: COLORS.panel, fontWeight: 700 } }, chartCategories.categories[i]),
                  chartCategories.series.map((s) => React.createElement("td", { key: s.id, style: { ...tdStyle, textAlign: "right" } }, s.data[i] != null ? s.data[i].toFixed(2) : "—"))
                ))),
                React.createElement("tfoot", null, React.createElement("tr", { style: { borderTop: `2px solid ${COLORS.panelBorder2}` } },
                  React.createElement("td", { style: { ...tdStyle, position: "sticky", left: 0, background: "#ede4d8", fontWeight: 800 } }, "평균"),
                  chartCategories.series.map((s) => React.createElement("td", { key: s.id, style: { ...tdStyle, textAlign: "right", fontWeight: 800, color: COLORS.amberSoft } }, (() => { const a = colAvg(s); return a != null ? a.toFixed(2) : "—"; })()))
                ))
              )
            )
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 지표를 선택하세요.")
      )),

      React.createElement("h2", { style: { fontSize: 16, fontWeight: 800, color: COLORS.cream, marginBottom: 8 } }, "주간 도축량 (NLRS 자발적 조사)"),
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 10 } }, "매주 금요일 발표, 국가 합계(6개 주 합산) \u00B7 공급 선행지표"),
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 8 } },
        React.createElement("button", { onClick: exportSlaughterXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀")
      ),
      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
        React.createElement(SvgLineChart, {
          categories: (raw.slaughter?.Cattle || []).slice(-52).map((r) => r.date.slice(5)),
          series: [
            { name: "소(천두)", color: PALETTE[0], data: (raw.slaughter?.Cattle || []).slice(-52).map((r) => r.headCount / 1000) },
            { name: "양(천두)", color: PALETTE[1], data: (raw.slaughter?.Sheep || []).slice(-52).map((r) => r.headCount / 1000) }
          ],
          formatAxisValue: (v) => v.toFixed(0)
        })
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `최근 데이터 기준: ${raw.sourceMostRecentData || "—"} \u00B7 수집: ${fmtUpdatedAt(raw.collectedAt) || "—"}`
      )
    );
  };

  function useMemoLite(raw, selected, ys, ye, normalize) {
    return useMemo(() => {
      if (!raw) return { categories: [], series: [] };
      const indicators = raw.indicators || {};
      const inRange = (r) => {
        const [y, m] = r.date.split("-");
        const ym = +y * 100 + +m;
        return (ys == null || ym >= ys) && (ye == null || ym <= ye);
      };
      const base = (indicators[selected[0]] || Object.values(indicators)[0] || []).filter(inRange);
      const dates = base.map((r) => r.date);
      const series = selected.filter((id) => indicators[id]).map((id) => {
        const byDate = Object.fromEntries(indicators[id].filter(inRange).map((r) => [r.date, r.value]));
        let data = dates.map((d) => byDate[d] ?? null);
        if (normalize) {
          const base0 = data.find((v) => v != null && isFinite(v) && v !== 0);
          if (base0) data = data.map((v) => v == null ? null : v / base0 * 100);
        }
        return { id, name: IND_SHORT[id] || id, color: PALETTE[IND_ORDER.indexOf(id) % PALETTE.length], data };
      });
      return { categories: dates, series };
    }, [raw, selected, ys, ye, normalize]);
  }
})();
