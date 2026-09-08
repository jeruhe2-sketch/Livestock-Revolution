/* 축산레이더 · 주요지표
   이미 사이트에 있는 데이터 파일들(EU돈가/환율/호주EYCI·90CL/미국돈육)을 한 화면에
   요약 카드로 모아 보여주는 대시보드. 차트 없음, 숫자 위주.
   일별로 발표되는 지표(EYCI, 미국 돈육)는 전일/전주/전년대비를 모두 보여주고,
   주별로만 발표되는 지표(EU 돈가, 90CL, 환율)는 전주/전년대비만 보여줌
   (일별 데이터가 없어서 "전일"이 의미가 없기 때문).
   새로운 원자료 수집은 없고, 각자 탭이 이미 자동 갱신한 JSON을 프론트에서
   한 번 더 읽어 요약만 함 (LLM/수동작업 없음). */
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

  // ── 일별(또는 영업일별) 원자료: 날짜 문자열 기준으로 "N일 전 이하 중 가장 최근" 값을 찾음.
  // 이렇게 하면 주말/휴일로 데이터가 비어도(USDA는 영업일만 발표) 자연스럽게 직전 값을 잡는다.
  function findAtOrBefore(rows, dateKey, valueKey, targetDateStr) {
    let best = null;
    for (const r of rows) {
      const d = r[dateKey], v = r[valueKey];
      if (d == null || v == null || !isFinite(v)) continue;
      if (d <= targetDateStr && (!best || d > best.date)) best = { date: d, value: v };
    }
    return best;
  }
  function addDaysStr(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  // 일별 시계열용: 전일/전주/전년대비
  function dailyStats(rows, dateKey, valueKey) {
    const sorted = rows.filter((r) => r[dateKey] != null && r[valueKey] != null && isFinite(r[valueKey])).sort((a, b) => (a[dateKey] < b[dateKey] ? -1 : 1));
    if (!sorted.length) return { latest: null, latestDate: null, dod: null, wow: null, yoy: null };
    const last = sorted[sorted.length - 1];
    const latestDate = last[dateKey];
    const dodRef = findAtOrBefore(sorted.slice(0, -1), dateKey, valueKey, addDaysStr(latestDate, -1));
    const wowRef = findAtOrBefore(sorted, dateKey, valueKey, addDaysStr(latestDate, -7));
    const yoyRef = findAtOrBefore(sorted, dateKey, valueKey, addDaysStr(latestDate, -365));
    const pct = (ref) => (ref ? (last[valueKey] - ref.value) / ref.value * 100 : null);
    return { latest: last[valueKey], latestDate, dod: pct(dodRef), wow: pct(wowRef), yoy: pct(yoyRef) };
  }
  // 일별 시계열을 ISO 주차별로 리샘플(그 주의 마지막 값 사용) - 주별 소스와 비교기준을 맞출 때 사용
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
  // 주별 시계열용: 전주/전년대비만 (일별 데이터가 없어 "전일"은 계산 불가).
  // 소스마다 최신 발표 주차가 다를 수 있어서(예: EU는 2주 전까지만) 공통 주차가 아니라
  // "그 소스 자신의" 최신 주차를 기준으로 계산.
  function weeklyStats(weeklyMap) {
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
  // CME 선물 카드용 통계: 현재가 + 전일종가 기준 전일대비 (선물이라 주/년 이력 없음)
  function cmeStat(entry) {
    if (!entry) return { latest: null };
    return { latest: entry.price, dod: entry.prevClose ? (entry.price - entry.prevClose) / entry.prevClose * 100 : null };
  }
  // 카드 sub 텍스트: 일별 소스는 전일/전주/전년 3개, 주별 소스는 전주/전년 2개
  function subText(stats) {
    const parts = [];
    if ("dod" in stats && stats.dod != null) parts.push(`전일 ${pctFmt(stats.dod)}`);
    if (stats.wow != null) parts.push(`전주 ${pctFmt(stats.wow)}`);
    if (stats.yoy != null) parts.push(`전년 ${pctFmt(stats.yoy)}`);
    return parts.length ? parts.join(" · ") : null;
  }
  function subColorOf(stats) {
    const v = ("dod" in stats && stats.dod != null) ? stats.dod : stats.wow;
    return v > 0 ? COLORS.rust : v < 0 ? "#3a6ea5" : COLORS.mute;
  }

  function Card({ label, value, unit, sub, subColor, asOf, onClick }) {
    return React.createElement("div", {
      onClick,
      style: {
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12,
        padding: "16px 18px", cursor: onClick ? "pointer" : "default", minWidth: 220, flex: "1 1 220px"
      }
    },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 26, fontWeight: 800, color: COLORS.cream, lineHeight: 1.1 } },
        value, unit && React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: COLORS.mute, marginLeft: 5 } }, unit)
      ),
      sub && React.createElement("div", { style: { fontSize: 12.5, color: subColor || COLORS.mute, marginTop: 6, fontWeight: 700 } }, sub),
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
    const [usdaCutout, setUsdaCutout] = useState(null);
    const [cme, setCme] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      Promise.all([
        fetchJson("./data/eu_pigmeat_price.json"),
        fetchJson("./data/exchange_rates.json"),
        fetchJson("./data/fx_history.json"),
        fetchJson("./data/mla_domestic.json"),
        fetchJson("./data/usda_pork_domestic.json"),
        fetchJson("./data/usda_cutout.json"),
        fetchJson("./data/cme_futures.json"),
      ]).then(([euD, fxD, fxHistD, mlaD, usdaD, usdaCutoutD, cmeD]) => {
        setEu(euD); setFx(fxD); setFxHist(fxHistD); setMla(mlaD); setUsda(usdaD); setUsdaCutout(usdaCutoutD); setCme(cmeD); setLoaded(true);
      });
    }, []);

    // 주별 소스(EU돈가/90CL/환율)는 주차맵으로, 일별 소스(EYCI/미국돈육)는 원본 그대로 사용
    const weekly = useMemo(() => {
      const out = { fx: {}, eurKrw: {}, eu: {}, cl90: {} };
      if (fxHist?.weekly) {
        for (const [wk, r] of Object.entries(fxHist.weekly)) {
          if (r.usd && r.krw) {
            out.fx[wk] = { date: r.date, value: r.krw / r.usd }; // EUR/KRW ÷ EUR/USD = USD/KRW
            out.eurKrw[wk] = { date: r.date, value: r.krw }; // r.krw는 이미 EUR/KRW
          }
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
      if (mla?.usImported90cl) {
        out.cl90 = resampleWeekly(mla.usImported90cl, "date", "value");
      }
      return out;
    }, [eu, fxHist, mla]);

    const cardStats = useMemo(() => {
      const eyciRows = mla?.indicators?.["0"] || [];
      const usdaRows = usda?.data ? usda.data.map((r) => ({ date: r.date, value: r["1/4 Trim Butt VAC"]?.usdPerLb })) : [];
      const fxStats = weeklyStats(weekly.fx);
      // 환율은 이제 실시간 시세라 야후가 주는 전일종가(prevClose)로 진짜 전일대비를 계산.
      // (ECB 폴백이 걸린 경우 prevClose가 없어서 dod는 자동으로 빠짐)
      if (fx?.usdKrw != null && fx?.usdKrwPrevClose) {
        fxStats.dod = (fx.usdKrw - fx.usdKrwPrevClose) / fx.usdKrwPrevClose * 100;
      }
      const eurStats = weeklyStats(weekly.eurKrw);
      if (fx?.eurKrw != null && fx?.eurKrwPrevClose) {
        eurStats.dod = (fx.eurKrw - fx.eurKrwPrevClose) / fx.eurKrwPrevClose * 100;
      }
      return {
        fx: fxStats,
        eurFx: eurStats,
        eu: weeklyStats(weekly.eu),
        eyci: dailyStats(eyciRows, "date", "value"),
        usda: dailyStats(usdaRows, "date", "value"),
        cl90: weeklyStats(weekly.cl90),
        porkCutout: dailyStats(usdaCutout?.pork?.data || [], "date", "value"),
        beefCutoutChoice: dailyStats(usdaCutout?.beef?.data || [], "date", "choice"),
        beefCutoutSelect: dailyStats(usdaCutout?.beef?.data || [], "date", "select"),
        liveCattle: cmeStat(cme?.liveCattle),
        feederCattle: cmeStat(cme?.feederCattle),
        leanHog: cmeStat(cme?.leanHog),
      };
    }, [weekly, mla, usda, fx, usdaCutout, cme]);

    const goto = (hash) => {
      const viewName = hash.replace(/^#/, "");
      if (window.__radarSelectView) window.__radarSelectView(viewName);
      else window.location.hash = hash; // 혹시 못 찾으면 폴백 (완전히 안 되는 것보단 나음)
    };

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1080 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 20 } },
        "사이트 내 각 탭에서 자동 갱신되는 데이터를 한 화면에 모은 요약입니다. 카드를 클릭하면 해당 탭으로 이동합니다."
      ),

      !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "불러오는 중..."),

      loaded && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
          React.createElement(Card, {
            label: "USD/KRW", value: fx?.usdKrw != null ? fx.usdKrw.toLocaleString() : "—", unit: "원",
            sub: subText(cardStats.fx), subColor: subColorOf(cardStats.fx),
            asOf: `${fmtUpdatedAt(fx?.marketTime || fx?.updatedAt) || "—"} · ${fx?.source || ""}`
          }),
          React.createElement(Card, {
            label: "EUR/KRW", value: fx?.eurKrw != null ? fx.eurKrw.toLocaleString() : "—", unit: "원",
            sub: subText(cardStats.eurFx), subColor: subColorOf(cardStats.eurFx),
            asOf: `${fmtUpdatedAt(fx?.marketTime || fx?.updatedAt) || "—"} · ${fx?.source || ""}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#eupigmeatprice"),
            label: "EU 돈가 (S+E 평균)", value: cardStats.eu.latest != null ? cardStats.eu.latest.toFixed(2) : "—", unit: "\u20AC/100kg",
            sub: subText(cardStats.eu), subColor: subColorOf(cardStats.eu),
            asOf: `EU 집행위 \u00B7 ${cardStats.eu.latestWeek || "—"} (주간 발표, 전일대비 없음)`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "EYCI (호주 소값)", value: cardStats.eyci.latest != null ? cardStats.eyci.latest.toFixed(1) : "—", unit: "c/kg cwt",
            sub: subText(cardStats.eyci), subColor: subColorOf(cardStats.eyci),
            asOf: `MLA \u00B7 ${cardStats.eyci.latestDate || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 돈육 목전지", value: cardStats.usda.latest != null ? cardStats.usda.latest.toFixed(2) : "—", unit: "$/lb",
            sub: subText(cardStats.usda), subColor: subColorOf(cardStats.usda),
            asOf: `USDA LMR \u00B7 ${cardStats.usda.latestDate || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 돈육 컷아웃", value: cardStats.porkCutout.latest != null ? cardStats.porkCutout.latest.toFixed(2) : "—", unit: "$/cwt",
            sub: subText(cardStats.porkCutout), subColor: subColorOf(cardStats.porkCutout),
            asOf: `USDA LM_PK602 \u00B7 ${cardStats.porkCutout.latestDate || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 소고기 Choice 컷아웃", value: cardStats.beefCutoutChoice.latest != null ? cardStats.beefCutoutChoice.latest.toFixed(2) : "—", unit: "$/cwt",
            sub: subText(cardStats.beefCutoutChoice), subColor: subColorOf(cardStats.beefCutoutChoice),
            asOf: `USDA LM_XB459 \u00B7 ${cardStats.beefCutoutChoice.latestDate || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 소고기 Select 컷아웃", value: cardStats.beefCutoutSelect.latest != null ? cardStats.beefCutoutSelect.latest.toFixed(2) : "—", unit: "$/cwt",
            sub: subText(cardStats.beefCutoutSelect), subColor: subColorOf(cardStats.beefCutoutSelect),
            asOf: `USDA LM_XB459 \u00B7 ${cardStats.beefCutoutSelect.latestDate || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "90CL 수입육 지표", value: cardStats.cl90.latest != null ? cardStats.cl90.latest.toFixed(2) : "—", unit: "US c/lb",
            sub: subText(cardStats.cl90), subColor: subColorOf(cardStats.cl90),
            asOf: `MLA(Steiner) \u00B7 ${cardStats.cl90.latestWeek || "—"} (주간 발표, 전일대비 없음)`
          }),
          React.createElement(Card, {
            label: "CME Live Cattle 선물", value: cardStats.liveCattle.latest != null ? cardStats.liveCattle.latest.toFixed(2) : "—", unit: "\u00A2/lb",
            sub: subText(cardStats.liveCattle), subColor: subColorOf(cardStats.liveCattle),
            asOf: `${cme?.liveCattle?.contract || "—"} \u00B7 ${fmtUpdatedAt(cme?.marketTime) || "—"} · ${cme?.source || ""}`
          }),
          React.createElement(Card, {
            label: "CME Feeder Cattle 선물", value: cardStats.feederCattle.latest != null ? cardStats.feederCattle.latest.toFixed(2) : "—", unit: "\u00A2/lb",
            sub: subText(cardStats.feederCattle), subColor: subColorOf(cardStats.feederCattle),
            asOf: `${cme?.feederCattle?.contract || "—"} \u00B7 ${fmtUpdatedAt(cme?.marketTime) || "—"} · ${cme?.source || ""}`
          }),
          React.createElement(Card, {
            label: "CME Lean Hog 선물", value: cardStats.leanHog.latest != null ? cardStats.leanHog.latest.toFixed(2) : "—", unit: "\u00A2/lb",
            sub: subText(cardStats.leanHog), subColor: subColorOf(cardStats.leanHog),
            asOf: `${cme?.leanHog?.contract || "—"} \u00B7 ${fmtUpdatedAt(cme?.marketTime) || "—"} · ${cme?.source || ""}`
          })
        ),

        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "자동화 안 되는 지표 (수동 확인 필요)"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
          React.createElement(PendingCard, { label: "미국 소 도축(주간 두수)", note: "USDA LMR API는 도축용 소 '가격' 리포트만 있고 '두수' 통계는 없음. NASS Quick Stats API(무료지만 키 등록 필요)로 가야 함." })
        )
      ),

      React.createElement("p", { style: { fontSize: 12, color: COLORS.mute, marginTop: 20, lineHeight: 1.6 } },
        "이 화면은 새로 데이터를 수집하지 않고, 각 탭이 이미 자동 갱신한 파일을 한 번 더 읽어 보여줍니다. 상세 추이/차트는 각 탭에서 확인하세요."
      )
    );
  };
})();
