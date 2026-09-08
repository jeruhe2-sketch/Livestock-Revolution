/* 축산레이더 · 주요지표
   이미 사이트에 있는 데이터 파일들(EU돈가/환율/호주EYCI·90CL/미국돈육)을 한 화면에
   요약 카드로 모아 보여주는 대시보드. 차트 없이 숫자 위주 (요청에 따라 차트 제거,
   상세 추이는 각 탭에서 확인). 새로운 원자료 수집은 없고, 이미 각자 탭에서
   자동 갱신되는 JSON들을 프론트에서 한 번 더 읽어 요약만 함 (LLM/수동작업 없음). */
window.KeyIndicatorsApp = (function () {
  const { useState, useEffect, useMemo } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };

  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }
  function pctFmt(v) { if (v === null || v === undefined || !isFinite(v)) return "—"; const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(1)}%`; }
  function fetchJson(path) {
    return fetch(path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  // ISO 8601 주차 키 (예: "2026-W35"). fx_history.json의 weekly 키 포맷과 동일.
  function isoWeekKey(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  // 일별 시계열을 ISO 주차별로 리샘플(그 주의 마지막 값 사용)
  function resampleWeekly(rows, dateKey, valueKey) {
    const byWeek = {};
    for (const r of rows) {
      const d = new Date(r[dateKey] + "T00:00:00Z");
      const wk = isoWeekKey(d);
      const v = r[valueKey];
      if (v == null || !isFinite(v)) continue;
      if (!byWeek[wk] || r[dateKey] > byWeek[wk].date) byWeek[wk] = { date: r[dateKey], value: v };
    }
    return byWeek;
  }
  // 카드용 WoW/YoY: 소스마다 최신 발표 주차가 다를 수 있어서(예: EYCI는 이번주까지,
  // EU 돈가는 2주 전까지) 공통 주차 목록이 아니라 "그 소스 자신의" 최신 주차를 기준으로 계산.
  function wowYoy(weeklyMap) {
    const keys = Object.keys(weeklyMap).sort();
    if (!keys.length) return { latest: null, latestWeek: null, wow: null, yoy: null };
    const lastWeek = keys[keys.length - 1];
    const latest = weeklyMap[lastWeek];
    const wowWeek = keys[keys.length - 2];
    const yoyWeek = keys[keys.length - 53];
    const wowV = wowWeek ? weeklyMap[wowWeek] : null;
    const yoyV = yoyWeek ? weeklyMap[yoyWeek] : null;
    return {
      latest: latest ? latest.value : null,
      latestWeek: lastWeek,
      wow: latest && wowV ? (latest.value - wowV.value) / wowV.value * 100 : null,
      yoy: latest && yoyV ? (latest.value - yoyV.value) / yoyV.value * 100 : null,
    };
  }

  function Card({ label, value, unit, sub, subColor, asOf, onClick }) {
    return React.createElement("div", {
      onClick,
      style: {
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12,
        padding: "16px 18px", cursor: onClick ? "pointer" : "default", minWidth: 200, flex: "1 1 200px"
      }
    },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 26, fontWeight: 800, color: COLORS.cream, lineHeight: 1.1 } },
        value, unit && React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: COLORS.mute, marginLeft: 5 } }, unit)
      ),
      sub && React.createElement("div", { style: { fontSize: 13, color: subColor || COLORS.mute, marginTop: 6, fontWeight: 700 } }, sub),
      asOf && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 8 } }, asOf)
    );
  }

  function PendingCard({ label, note }) {
    return React.createElement("div", { style: { background: COLORS.head, border: `1px dashed ${COLORS.panelBorder2}`, borderRadius: 12, padding: "16px 18px", minWidth: 200, flex: "1 1 200px" } },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 15, color: COLORS.mute, fontWeight: 700 } }, "\u26A0 자동화 불가"),
      React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginTop: 6, lineHeight: 1.5 } }, note)
    );
  }

  return function KeyIndicatorsApp() {
    const [eu, setEu] = useState(null);
    const [fx, setFx] = useState(null);
    const [fxHist, setFxHist] = useState(null);
    const [mla, setMla] = useState(null);
    const [usda, setUsda] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      Promise.all([
        fetchJson("./data/eu_pigmeat_price.json"),
        fetchJson("./data/exchange_rates.json"),
        fetchJson("./data/fx_history.json"),
        fetchJson("./data/mla_domestic.json"),
        fetchJson("./data/usda_pork_domestic.json"),
      ]).then(([euD, fxD, fxHistD, mlaD, usdaD]) => {
        setEu(euD); setFx(fxD); setFxHist(fxHistD); setMla(mlaD); setUsda(usdaD); setLoaded(true);
      });
    }, []);

    // 4개 소스를 전부 "주차 -> 값" 맵으로 통일해서 카드의 WoW/YoY 계산에만 사용
    // (단위가 다 달라서 차트로 겹쳐그리지 않음 - 카드 숫자만 보여주는 대시보드)
    const weekly = useMemo(() => {
      const out = { fx: {}, eu: {}, eyci: {}, usda: {}, cl90: {} };
      if (fxHist?.weekly) {
        for (const [wk, r] of Object.entries(fxHist.weekly)) {
          if (r.usd && r.krw) out.fx[wk] = { date: r.date, value: r.krw / r.usd }; // EUR/KRW ÷ EUR/USD = USD/KRW
        }
      }
      if (eu?.data) {
        const byWeek = {};
        for (const [year, week, cls, msCode, price] of eu.data) {
          if (msCode !== "EU") continue;
          const wk = `${year}-W${String(week).padStart(2, "0")}`;
          (byWeek[wk] = byWeek[wk] || []).push(price);
        }
        for (const [wk, prices] of Object.entries(byWeek)) {
          out.eu[wk] = { value: prices.reduce((s, v) => s + v, 0) / prices.length };
        }
      }
      if (mla?.indicators?.["0"]) {
        out.eyci = resampleWeekly(mla.indicators["0"], "date", "value");
      }
      if (usda?.data) {
        const rows = usda.data.map((r) => ({ date: r.date, value: r["1/4 Trim Butt VAC"]?.usdPerLb }));
        out.usda = resampleWeekly(rows, "date", "value");
      }
      if (mla?.usImported90cl) {
        out.cl90 = resampleWeekly(mla.usImported90cl, "date", "value");
      }
      return out;
    }, [eu, fxHist, mla, usda]);

    const cardStats = useMemo(() => ({
      fx: wowYoy(weekly.fx),
      eu: wowYoy(weekly.eu),
      eyci: wowYoy(weekly.eyci),
      usda: wowYoy(weekly.usda),
      cl90: wowYoy(weekly.cl90),
    }), [weekly]);

    const goto = (hash) => { window.location.hash = hash; };

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1040 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 20 } },
        "사이트 내 각 탭에서 자동 갱신되는 데이터를 한 화면에 모은 요약입니다. 카드를 클릭하면 해당 탭으로 이동합니다."
      ),

      !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "불러오는 중..."),

      loaded && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
          React.createElement(Card, {
            label: "USD/KRW", value: fx?.usdKrw != null ? fx.usdKrw.toLocaleString() : "—", unit: "원",
            sub: cardStats.fx.wow != null ? `1주 ${pctFmt(cardStats.fx.wow)} · 1년 ${pctFmt(cardStats.fx.yoy)}` : null,
            subColor: cardStats.fx.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `${fmtUpdatedAt(fx?.updatedAt) || "—"} · ${fx?.source || ""}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#eupigmeatprice"),
            label: "EU 돈가 (S+E 평균)", value: cardStats.eu.latest != null ? cardStats.eu.latest.toFixed(2) : "—", unit: "\u20AC/100kg",
            sub: cardStats.eu.wow != null ? `1주 ${pctFmt(cardStats.eu.wow)} · 1년 ${pctFmt(cardStats.eu.yoy)}` : null,
            subColor: cardStats.eu.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `EU 집행위 \u00B7 ${cardStats.eu.latestWeek || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "EYCI (호주 소값)", value: cardStats.eyci.latest != null ? cardStats.eyci.latest.toFixed(1) : "—", unit: "c/kg cwt",
            sub: cardStats.eyci.wow != null ? `1주 ${pctFmt(cardStats.eyci.wow)} · 1년 ${pctFmt(cardStats.eyci.yoy)}` : null,
            subColor: cardStats.eyci.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `MLA \u00B7 ${cardStats.eyci.latestWeek || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 돈육 목전지", value: cardStats.usda.latest != null ? cardStats.usda.latest.toFixed(2) : "—", unit: "$/lb",
            sub: cardStats.usda.wow != null ? `1주 ${pctFmt(cardStats.usda.wow)} · 1년 ${pctFmt(cardStats.usda.yoy)}` : null,
            subColor: cardStats.usda.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `USDA LMR \u00B7 ${cardStats.usda.latestWeek || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "90CL 수입육 지표", value: cardStats.cl90.latest != null ? cardStats.cl90.latest.toFixed(2) : "—", unit: "US c/lb",
            sub: cardStats.cl90.wow != null ? `1주 ${pctFmt(cardStats.cl90.wow)} · 1년 ${pctFmt(cardStats.cl90.yoy)}` : null,
            subColor: cardStats.cl90.wow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `MLA(Steiner) \u00B7 ${cardStats.cl90.latestWeek || "—"}`
          })
        ),

        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "자동화 안 되는 지표 (수동 확인 필요)"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
          React.createElement(PendingCard, { label: "CME Live Cattle 선물", note: "CME 실시간/지연 시세는 유료 라이선스 필요. 무료 API 없음." }),
          React.createElement(PendingCard, { label: "미국 소 도축(주간)", note: "USDA 리포트 slug 확인 후 추가 예정." })
        )
      ),

      React.createElement("p", { style: { fontSize: 12, color: COLORS.mute, marginTop: 20, lineHeight: 1.6 } },
        "이 화면은 새로 데이터를 수집하지 않고, 각 탭이 이미 자동 갱신한 파일을 한 번 더 읽어 보여줍니다. 상세 추이/차트는 각 탭에서 확인하세요."
      )
    );
  };
})();
