/* 축산레이더 · EU 돈가(도체) 현황 (v2)
   집행위 Agri-food Data Portal 공개 API(pigmeat/prices, 인증 불필요)로 GitHub Actions가
   매주 자동 수집한 data/eu_pigmeat_price.json을 그린다. LLM/수동작업 없이 완전 자동 갱신.
   기존 EU 수출현황·미국 내수현황·CEPEA 탭과 동일한 디자인 시스템(팔레트, 호버 라인차트,
   URL 상태동기화, 엑셀 다운로드, 링크복사)을 재사용함. */
window.EuPigmeatPriceApp = (function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };
  const PALETTE = ["#b96a2e", "#3a6ea5", "#a34a3f", "#2e7d4f", "#8a5a30", "#6b5ca5", "#c98a1a", "#4a8f8f", "#a55a9e", "#7a8a3a", "#c25b5b", "#356b8c"];
  const DEFAULT_COUNTRIES = ["EU", "DE", "ES", "DK", "NL", "FR", "PL"];
  const GRANULARITY_OPTIONS = [["week", "주별"], ["month", "월별"], ["year", "연도별"]];

  function fmtPrice(v) { return v == null || !isFinite(v) ? "—" : `€${Number(v).toFixed(2)}`; }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }
  function readParams() { return new URLSearchParams(window.location.search); }
  function downloadXlsx(aoa, filename, sheetName) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    XLSX.writeFile(wb, filename);
  }
  function isoWeek1Monday(year) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    jan4.setUTCDate(jan4.getUTCDate() - (dow - 1));
    return jan4;
  }
  function weekLabel(year, week) {
    const monday = new Date(isoWeek1Monday(year).getTime() + (week - 1) * 7 * 86400000);
    return `${monday.getUTCFullYear()}.${String(monday.getUTCMonth() + 1).padStart(2, "0")}.${String(monday.getUTCDate()).padStart(2, "0")}`;
  }
  function weekToMonthKey(year, week) {
    const monday = new Date(isoWeek1Monday(year).getTime() + (week - 1) * 7 * 86400000);
    const counts = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /* ── 호버 툴팁 라인차트 (EU/USDA/CEPEA 탭과 동일 패턴) ── */
  function SvgLineChart({ categories, series, height = 280, formatValue }) {
    const fmt = formatValue || ((v) => v == null ? "—" : `€${v.toFixed(2)}`);
    const width = 900;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 46 : 26, left: 56 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) : 1;
    const minVal = allVals.length ? Math.min(...allVals) * 0.97 : 0;
    const span = Math.max(0.01, maxVal * 1.05 - minVal);
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v - minVal) / span * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = manyLabels ? Math.ceil(categories.length / 10) : 1;
    const containerRef = useRef(null);
    const [hoverIdx, setHoverIdx] = useState(null);
    const handleMove = (e) => {
      if (!containerRef.current || categories.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setHoverIdx(Math.round(frac * (categories.length - 1)));
    };
    const tooltipLeftPct = hoverIdx !== null && categories.length > 1 ? hoverIdx / (categories.length - 1) * 100 : 50;
    return React.createElement("div", { ref: containerRef, style: { position: "relative" }, onMouseMove: handleMove, onMouseLeave: () => setHoverIdx(null) },
      React.createElement("svg", { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", height, display: "block", cursor: "crosshair" }, preserveAspectRatio: "none" },
        Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padding.top + innerH / gridLines * i;
          const val = maxVal * 1.05 - (maxVal * 1.05 - minVal) / gridLines * i;
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, `€${val.toFixed(0)}`)
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - (manyLabels ? 30 : 8), textAnchor: "middle", fontSize: "9", fill: COLORS.mute, transform: manyLabels ? `rotate(-35 ${xFor(i)} ${height - 30})` : undefined }, c)),
        hoverIdx !== null && React.createElement("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: COLORS.amberSoft, strokeWidth: "1", strokeDasharray: "2 2" }),
        series.map((s) => {
          const segs = [];
          let cur = [];
          s.data.forEach((v, i) => {
            if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur); cur = []; } return; }
            cur.push(`${cur.length ? "L" : "M"}${xFor(i)},${yFor(v)}`);
          });
          if (cur.length) segs.push(cur);
          return React.createElement("g", { key: s.name },
            segs.map((seg, si) => React.createElement("path", { key: si, d: seg.join(" "), fill: "none", stroke: s.color, strokeWidth: s.name === "EU" ? 3 : 2 })),
            categories.length <= 80 && s.data.map((v, i) => v != null && isFinite(v) && React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v), r: i === hoverIdx ? 4 : 1.6, fill: s.color }))
          );
        })
      ),
      hoverIdx !== null && React.createElement("div", {
        style: {
          position: "absolute", top: 4, left: `${tooltipLeftPct}%`,
          transform: `translateX(${tooltipLeftPct > 70 ? "-100%" : tooltipLeftPct < 5 ? "0%" : "-50%"})`,
          background: COLORS.cream, color: "#f7f8f5", borderRadius: 8, padding: "8px 10px",
          fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 10px rgba(0,0,0,.18)", zIndex: 5
        }
      },
        React.createElement("div", { style: { fontWeight: 700, marginBottom: 4 } }, categories[hoverIdx]),
        series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", justifyContent: "space-between", gap: 10 } },
          React.createElement("span", { style: { color: s.color } }, "\u25CF " + s.name),
          React.createElement("span", null, fmt(s.data[hoverIdx]))
        ))
      )
    );
  }

  function Tile({ label, value, sub, color }) {
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 128, flex: "1 1 128px" } },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, label),
      React.createElement("div", { style: { fontSize: 21, fontWeight: 800, color: COLORS.cream } }, value),
      sub && React.createElement("div", { style: { fontSize: 12, color, marginTop: 4 } }, sub)
    );
  }

  function Toggle({ active, onClick, children, color }) {
    return React.createElement("button", {
      onClick, style: {
        padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
        border: `1px solid ${active ? (color || COLORS.amber) : COLORS.panelBorder}`,
        background: active ? (color || COLORS.amber) : COLORS.panel,
        color: active ? "#ffffff" : COLORS.mute, fontWeight: 700, whiteSpace: "nowrap"
      }
    }, children);
  }

  return function EuPigmeatPriceApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    const initial = readParams();
    const [pigClass, setPigClass] = useState(initial.get("cls") || "S");
    const [granularity, setGranularity] = useState(initial.get("g") || "week");
    const [selected, setSelected] = useState(() => {
      const q = initial.get("c");
      return q ? q.split(",") : DEFAULT_COUNTRIES;
    });
    const [showAllCountries, setShowAllCountries] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
      fetch("./data/eu_pigmeat_price.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    useEffect(() => {
      const p = new URLSearchParams(window.location.search);
      p.set("cls", pigClass); p.set("g", granularity); p.set("c", selected.join(","));
      window.history.replaceState(null, "", window.location.pathname + "?" + p.toString() + window.location.hash);
    }, [pigClass, granularity, selected]);

    // 클래스 필터 + 국가별 시계열
    const byCountry = useMemo(() => {
      if (!raw) return {};
      const filtered = raw.data.filter((r) => r[2] === pigClass);
      const out = {};
      for (const [year, week, cls, msCode, price] of filtered) {
        (out[msCode] = out[msCode] || []).push({ year, week, price });
      }
      Object.values(out).forEach((arr) => arr.sort((a, b) => a.year - b.year || a.week - b.week));
      return out;
    }, [raw, pigClass]);

    // 주간 -> 월/연 집계 (평균)
    const aggregated = useMemo(() => {
      const out = {};
      for (const [code, arr] of Object.entries(byCountry)) {
        if (granularity === "week") { out[code] = arr; continue; }
        const buckets = {};
        for (const r of arr) {
          const key = granularity === "year" ? String(r.year) : weekToMonthKey(r.year, r.week);
          (buckets[key] = buckets[key] || []).push(r.price);
        }
        out[code] = Object.entries(buckets).sort((a, b) => a[0] < b[0] ? -1 : 1)
          .map(([key, vals]) => ({ key, price: vals.reduce((a, b) => a + b, 0) / vals.length }));
      }
      return out;
    }, [byCountry, granularity]);

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const allCountries = Object.keys(raw.msNames || {}).sort((a, b) => (a === "EU" ? -1 : b === "EU" ? 1 : raw.msNames[a].localeCompare(raw.msNames[b])));
    const shownList = showAllCountries ? allCountries : allCountries.slice(0, 14);

    const euSeries = byCountry.EU || [];
    const latest = euSeries[euSeries.length - 1];
    const prev = euSeries[euSeries.length - 2];
    const wowPct = latest && prev ? (latest.price - prev.price) / prev.price * 100 : null;
    const yearAgo = euSeries.find((r) => latest && r.year === latest.year - 1 && r.week === latest.week);
    const yoyPct = latest && yearAgo ? (latest.price - yearAgo.price) / yearAgo.price * 100 : null;

    const activeCountries = selected.filter((c) => allCountries.includes(c));
    const N = granularity === "week" ? 26 : granularity === "month" ? 24 : 100;
    const refSeries = granularity === "week" ? euSeries : (aggregated.EU || []);
    const categories = refSeries.slice(-N).map((r) => granularity === "week" ? weekLabel(r.year, r.week) : r.key);
    const chartSeries = activeCountries.map((c, i) => ({
      name: c, color: c === "EU" ? COLORS.amber : PALETTE[i % PALETTE.length],
      data: (aggregated[c] || []).slice(-N).map((r) => r.price)
    }));

    const toggleCountry = (c) => setSelected((s) => s.includes(c) ? s.filter((x) => x !== c) : [...s, c]);

    const copyLink = () => {
      navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    };

    const exportXlsx = () => {
      const header = ["구분", ...categories];
      const rows = activeCountries.map((c) => [raw.msNames[c] || c, ...(aggregated[c] || []).slice(-N).map((r) => r.price)]);
      downloadXlsx([header, ...rows], `EU_돈가_${pigClass}등급_${granularity}.xlsx`, "EU돈가");
    };

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1040 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "EU 돈가(도체) 현황"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 16 } },
        `EU 27개 회원국 + EU 평균 \u00B7 S/E 등급 \u00B7 2015년~현재 주간 데이터 \u00B7 매주 자동 갱신 (집행위 공개 API, 수동작업 없음)`
      ),

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 } },
        React.createElement(Tile, {
          label: `EU 평균 (${pigClass}등급, ${latest ? latest.year + "-W" + latest.week : "—"})`,
          value: fmtPrice(latest?.price),
          sub: wowPct != null ? `전주대비 ${pctFmt(wowPct)}` : null,
          color: wowPct > 0 ? COLORS.rust : "#3a6ea5"
        }),
        React.createElement(Tile, {
          label: "전년 동주대비",
          value: pctFmt(yoyPct),
          color: yoyPct > 0 ? COLORS.rust : "#3a6ea5"
        }),
        ...["DE", "ES", "FR", "DK", "NL", "PL"].filter((c) => byCountry[c]).map((c) => {
          const arr = byCountry[c] || []; const l = arr[arr.length - 1];
          return React.createElement(Tile, { key: c, label: raw.msNames[c] || c, value: fmtPrice(l?.price) });
        })
      ),

      React.createElement("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 } },
        React.createElement("div", { style: { display: "flex", gap: 6 } },
          ["S", "E"].filter((c) => (raw.pigClasses || ["S", "E"]).includes(c)).map((c) =>
            React.createElement(Toggle, { key: c, active: pigClass === c, onClick: () => setPigClass(c) }, `${c}등급`))
        ),
        React.createElement("div", { style: { display: "flex", gap: 6 } },
          GRANULARITY_OPTIONS.map(([k, label]) => React.createElement(Toggle, { key: k, active: granularity === k, onClick: () => setGranularity(k), color: COLORS.sage }, label))
        ),
        React.createElement("div", { style: { flex: 1 } }),
        React.createElement("button", { onClick: exportXlsx, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F4E5} 엑셀 다운로드"),
        React.createElement("button", { onClick: copyLink, style: { padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.panelBorder2}`, background: COLORS.panel, color: COLORS.cream, fontSize: 12, fontWeight: 700, cursor: "pointer" } }, copied ? "복사됨!" : "\u{1F517} 현재 상태 링크 복사")
      ),

      React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 } },
        shownList.map((c) => React.createElement(Toggle, { key: c, active: selected.includes(c), onClick: () => toggleCountry(c), color: c === "EU" ? COLORS.amber : COLORS.mute }, raw.msNames[c] || c))
      ),
      allCountries.length > 14 && React.createElement("button", {
        onClick: () => setShowAllCountries((v) => !v),
        style: { border: "none", background: "none", color: COLORS.amber, fontSize: 12, cursor: "pointer", padding: "2px 0 14px", fontWeight: 700 }
      }, showAllCountries ? "국가 목록 접기 \u25B2" : `+${allCountries.length - 14}개 회원국 더 보기 \u25BC`),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
        chartSeries.length ? React.createElement(SvgLineChart, { categories, series: chartSeries })
          : React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, textAlign: "center", padding: 40 } }, "표시할 국가를 선택하세요.")
      ),

      React.createElement("div", { style: { overflowX: "auto", border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, marginBottom: 16 } },
        React.createElement("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 12.5 } },
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", { style: { position: "sticky", left: 0, background: COLORS.head, padding: "8px 12px", textAlign: "left", borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" } }, "구분"),
              categories.slice(-10).map((c, i) => React.createElement("th", { key: i, style: { padding: "8px 10px", textAlign: "right", background: COLORS.head, borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" } }, c))
            )
          ),
          React.createElement("tbody", null,
            activeCountries.map((c) => React.createElement("tr", { key: c },
              React.createElement("td", { style: { position: "sticky", left: 0, background: COLORS.panel, padding: "6px 12px", borderBottom: `1px solid ${COLORS.panelBorder}`, fontWeight: c === "EU" ? 800 : 500, whiteSpace: "nowrap" } }, raw.msNames[c] || c),
              (aggregated[c] || []).slice(-10).map((r, i) => React.createElement("td", { key: i, style: { padding: "6px 10px", textAlign: "right", borderBottom: `1px solid ${COLORS.panelBorder}` } }, fmtPrice(r.price)))
            ))
          )
        )
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `최근 데이터 기준: ${raw.sourceMostRecentData || "—"} \u00B7 수집: ${fmtUpdatedAt(raw.collectedAt) || "—"} \u00B7 총 ${raw.data.length.toLocaleString()}행`
      ),
      React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 4 } },
        "출처: European Commission Agri-food Data Portal — api.tech.ec.europa.eu/agrifood/api/pigmeat/prices (인증 불필요 공개 API)"
      )
    );
  };
})();
