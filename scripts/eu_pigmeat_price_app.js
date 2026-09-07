/* 축산레이더 · EU 돈가(도체) 현황
   집행위 Agri-food Data Portal 공개 API(pigmeat/prices, 인증 불필요)로 GitHub Actions가
   매주 자동 수집한 data/eu_pigmeat_price.json을 그린다. LLM/수동작업 없이 완전 자동 갱신.
   기존 EU 수출현황/미국 내수현황과 같은 라이트 테마 팔레트를 재사용. */
window.EuPigmeatPriceApp = (function () {
  const { useState, useEffect, useMemo } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };
  const COUNTRY_COLORS = { EU: COLORS.amber, DE: "#3a6ea5", ES: "#a34a3f", DK: "#2e7d4f", NL: "#8a5a30" };
  const WEEKS_TO_SHOW = 26;

  function fmtPrice(v) { return v == null || !isFinite(v) ? "—" : `€${Number(v).toFixed(2)}`; }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }

  function SimpleLineChart({ categories, series, height = 240 }) {
    const width = 900;
    const padding = { top: 16, right: 16, bottom: 28, left: 52 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const maxVal = allVals.length ? Math.max(...allVals) : 1;
    const minVal = allVals.length ? Math.min(...allVals) * 0.97 : 0;
    const span = Math.max(0.01, maxVal * 1.03 - minVal);
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v - minVal) / span * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const labelEvery = Math.max(1, Math.ceil(categories.length / 8));
    const gridLines = 4;
    return React.createElement("svg", { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", height, display: "block" } },
      Array.from({ length: gridLines + 1 }).map((_, i) => {
        const y = padding.top + innerH / gridLines * i;
        const val = maxVal * 1.03 - (maxVal * 1.03 - minVal) / gridLines * i;
        return React.createElement("g", { key: i },
          React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
          React.createElement("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, `€${val.toFixed(2)}`)
        );
      }),
      categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - 8, textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
      series.map((s) => {
        const segs = []; let cur = [];
        s.data.forEach((v, i) => {
          if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur); cur = []; } return; }
          cur.push(`${cur.length ? "L" : "M"}${xFor(i)},${yFor(v)}`);
        });
        if (cur.length) segs.push(cur);
        return React.createElement("g", { key: s.name },
          segs.map((seg, si) => React.createElement("path", { key: si, d: seg.join(" "), fill: "none", stroke: s.color, strokeWidth: s.name === "EU" ? 3 : 2 }))
        );
      })
    );
  }

  function Tile({ label, value, sub, color }) {
    return React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px", minWidth: 140, flex: "1 1 140px" } },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6 } }, label),
      React.createElement("div", { style: { fontSize: 22, fontWeight: 800, color: COLORS.cream } }, value),
      sub && React.createElement("div", { style: { fontSize: 12, color, marginTop: 4 } }, sub)
    );
  }

  return function EuPigmeatPriceApp() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState(null);
    const [visible, setVisible] = useState({ EU: true, DE: true, ES: true, DK: true, NL: true });

    useEffect(() => {
      fetch("./data/eu_pigmeat_price.json", { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setRaw)
        .catch((e) => setError(String(e)));
    }, []);

    const byCountry = useMemo(() => {
      if (!raw) return {};
      const out = {};
      for (const [year, week, msCode, price] of raw.data) {
        (out[msCode] = out[msCode] || []).push({ year, week, price });
      }
      Object.values(out).forEach((arr) => arr.sort((a, b) => a.year - b.year || a.week - b.week));
      return out;
    }, [raw]);

    if (error) return React.createElement("div", { style: { padding: 24, color: COLORS.rust } }, `데이터를 불러오지 못했습니다: ${error}`);
    if (!raw) return React.createElement("div", { style: { padding: 24, color: COLORS.mute } }, "불러오는 중...");

    const countries = Object.keys(raw.msNames || {});
    const euSeries = byCountry.EU || [];
    const latest = euSeries[euSeries.length - 1];
    const prev = euSeries[euSeries.length - 2];
    const wowPct = latest && prev ? (latest.price - prev.price) / prev.price * 100 : null;

    const categories = euSeries.slice(-WEEKS_TO_SHOW).map((r) => `${String(r.year).slice(2)}W${r.week}`);
    const chartSeries = countries.filter((c) => visible[c]).map((c) => ({
      name: c,
      color: COUNTRY_COLORS[c] || COLORS.mute,
      data: (byCountry[c] || []).slice(-WEEKS_TO_SHOW).map((r) => r.price)
    }));

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 980 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "EU 돈가(도체) 현황"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 18 } },
        `등급: ${raw.pigClass}(Superior) · 단위: ${raw.unit} · 매주 자동 갱신 (집행위 공개 API, 수동작업 없음)`
      ),

      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 } },
        React.createElement(Tile, {
          label: `EU 평균 (${latest ? latest.year + "-W" + latest.week : "—"})`,
          value: fmtPrice(latest?.price),
          sub: wowPct != null ? `전주대비 ${pctFmt(wowPct)}` : null,
          color: wowPct > 0 ? COLORS.rust : wowPct < 0 ? "#3a6ea5" : COLORS.mute
        }),
        ...countries.filter((c) => c !== "EU").map((c) => {
          const arr = byCountry[c] || [];
          const l = arr[arr.length - 1];
          return React.createElement(Tile, { key: c, label: raw.msNames[c] || c, value: fmtPrice(l?.price) });
        })
      ),

      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } },
        countries.map((c) => React.createElement("button", {
          key: c,
          onClick: () => setVisible((v) => ({ ...v, [c]: !v[c] })),
          style: {
            padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
            border: `1px solid ${visible[c] ? (COUNTRY_COLORS[c] || COLORS.amber) : COLORS.panelBorder}`,
            background: visible[c] ? (COUNTRY_COLORS[c] || COLORS.amber) : COLORS.panel,
            color: visible[c] ? "#ffffff" : COLORS.mute, fontWeight: 700
          }
        }, raw.msNames[c] || c))
      ),

      React.createElement("div", { style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: 16, marginBottom: 20 } },
        React.createElement(SimpleLineChart, { categories, series: chartSeries })
      ),

      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute } },
        `최근 데이터 기준: ${raw.sourceMostRecentData || "—"} · 수집: ${fmtUpdatedAt(raw.collectedAt) || "—"}`
      ),
      React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 4 } },
        "출처: European Commission Agri-food Data Portal (api.tech.ec.europa.eu/agrifood/api/pigmeat/prices)"
      )
    );
  };
})();
