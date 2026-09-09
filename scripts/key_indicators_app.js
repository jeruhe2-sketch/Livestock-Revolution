/* 축산레이더 · 주요지표
   이미 사이트에 있는 데이터 파일들(EU돈가/환율(USD·EUR·AUD·BRL)/호주EYCI·90CL/
   미국돈육)을 한 화면에 요약 카드로 모아 보여주는 대시보드. 차트 없음, 숫자 위주.
   일별로 발표되는 지표(EYCI, 미국 돈육)는 전일/전주/전월/전년대비를 모두 보여주고,
   주별로만 발표되는 지표(EU 돈가, 90CL)는 전주/전월/전년대비만 보여줌
   (일별 데이터가 없어서 "전일"이 의미가 없기 때문). 환율은 자체적으로 1년치
   일별 이력을 받아오는 방식이라(fetch_exchange_rates.py) 전일도 포함됨.
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
  // 일별 시계열용: 전일/전주/전월/전년대비
  function dailyStats(rows, dateKey, valueKey) {
    const sorted = rows.filter((r) => r[dateKey] != null && r[valueKey] != null && isFinite(r[valueKey])).sort((a, b) => (a[dateKey] < b[dateKey] ? -1 : 1));
    if (!sorted.length) return { latest: null, latestDate: null, dod: null, wow: null, mom: null, yoy: null };
    const last = sorted[sorted.length - 1];
    const latestDate = last[dateKey];
    const dodRef = findAtOrBefore(sorted.slice(0, -1), dateKey, valueKey, addDaysStr(latestDate, -1));
    const wowRef = findAtOrBefore(sorted, dateKey, valueKey, addDaysStr(latestDate, -7));
    const momRef = findAtOrBefore(sorted, dateKey, valueKey, addDaysStr(latestDate, -30));
    const yoyRef = findAtOrBefore(sorted, dateKey, valueKey, addDaysStr(latestDate, -365));
    const pct = (ref) => (ref ? (last[valueKey] - ref.value) / ref.value * 100 : null);
    return { latest: last[valueKey], latestDate, dod: pct(dodRef), wow: pct(wowRef), mom: pct(momRef), yoy: pct(yoyRef) };
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
  // 주별 시계열용: 전주/전월/전년대비 (일별 데이터가 없어 "전일"은 계산 불가).
  // 소스마다 최신 발표 주차가 다를 수 있어서(예: EU는 2주 전까지만) 공통 주차가 아니라
  // "그 소스 자신의" 최신 주차를 기준으로 계산.
  function weeklyStats(weeklyMap) {
    const keys = Object.keys(weeklyMap).sort();
    if (!keys.length) return { latest: null, latestWeek: null, wow: null, mom: null, yoy: null };
    const lastWeek = keys[keys.length - 1];
    const latest = weeklyMap[lastWeek];
    const at = (idx) => (keys.length + idx >= 0 ? weeklyMap[keys[keys.length + idx]] : null);
    const wowV = at(-2), momV = at(-5) /* ~4.3주 전 ≈ 1개월 */, yoyV = at(-53);
    const pct = (ref) => (latest && ref ? (latest.value - ref.value) / ref.value * 100 : null);
    return { latest: latest ? latest.value : null, latestWeek: lastWeek, wow: pct(wowV), mom: pct(momV), yoy: pct(yoyV) };
  }
  // 환율(usd/eur/aud/brl) 카드용: 수집 스크립트가 이미 전일/전주/전월/전년을 계산해서 넣어줌
  function fxStat(fx, prefix) {
    if (!fx) return { latest: null };
    return { latest: fx[`${prefix}Krw`], dod: fx[`${prefix}KrwDod`], wow: fx[`${prefix}KrwWow`], mom: fx[`${prefix}KrwMom`], yoy: fx[`${prefix}KrwYoy`] };
  }
  // CME 선물 카드용 통계: 수집 스크립트가 이미 전일/전주/전월/전년을 계산해서 넣어줌
  function cmeStat(entry) {
    if (!entry) return { latest: null };
    return { latest: entry.price, dod: entry.dod, wow: entry.wow, mom: entry.mom, yoy: entry.yoy };
  }
  // 각 시세를 kg당 원화로 근사 환산 (해외 육류시세 + 축산선물만 - 요청대로 딱 이 범위)
  const LB_TO_KG = 0.453592;
  function approxKrwPerKg(value, kind, fx) {
    if (value == null || !fx) return null;
    switch (kind) {
      case "usd_per_lb": return fx.usdKrw ? (value / LB_TO_KG) * fx.usdKrw : null;
      case "usd_cents_per_lb": return fx.usdKrw ? ((value / 100) / LB_TO_KG) * fx.usdKrw : null;
      case "usd_per_cwt": return fx.usdKrw ? (value / (100 * LB_TO_KG)) * fx.usdKrw : null; // 1 cwt = 100 lb
      case "eur_per_100kg": return fx.eurKrw ? (value / 100) * fx.eurKrw : null;
      case "aud_cents_per_kg": return fx.audKrw ? (value / 100) * fx.audKrw : null;
      default: return null;
    }
  }
  function fmtKrwPerKg(v) {
    if (v == null || !isFinite(v)) return null;
    return `\u2248 ${Math.round(v).toLocaleString()}\uC6D0/kg`;
  }

  const STAT_ORDER = [["yoy", "전년"], ["mom", "전월"], ["wow", "전주"], ["dod", "전일"]];

  function StatGrid({ stats }) {
    return React.createElement("div", {
      style: {
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px",
        marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.panelBorder}`
      }
    },
      STAT_ORDER.map(([key, label]) => {
        const has = key in stats;
        const v = stats[key];
        const known = has && v != null;
        const color = !known ? COLORS.panelBorder2 : v > 0 ? COLORS.rust : v < 0 ? "#3a6ea5" : COLORS.mute;
        const arrow = !known ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "―";
        return React.createElement("div", {
          key: label,
          style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }
        },
          React.createElement("span", { style: { fontSize: 11, color: COLORS.mute, fontWeight: 700 } }, label),
          React.createElement("span", { style: { fontSize: 12.5, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" } },
            has ? (known ? `${arrow} ${pctFmt(v)}` : "—") : "·"
          )
        );
      })
    );
  }

  function Card({ label, value, unit, stats, onClick, accent, krwPerKg, updatedAt }) {
    const updatedStr = fmtUpdatedAt(updatedAt);
    return React.createElement("div", {
      onClick,
      className: onClick ? "radar-key-card radar-key-card--clickable" : "radar-key-card",
      style: {
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelBorder}`,
        borderRadius: 14, padding: "16px 18px 14px",
        cursor: onClick ? "pointer" : "default",
        minWidth: 200, flex: "1 1 200px",
        boxShadow: "0 1px 2px rgba(31,36,32,0.04)",
        transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease",
        borderTop: `3px solid ${accent || COLORS.panelBorder}`,
        "--accent": accent || COLORS.amber
      }
    },
      React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 6, fontWeight: 700, letterSpacing: "-0.01em" } }, label),
      React.createElement("div", { style: { fontSize: 24, fontWeight: 800, color: COLORS.cream, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" } },
        value, unit && React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: COLORS.mute, marginLeft: 5 } }, unit)
      ),
      fmtKrwPerKg(krwPerKg) && React.createElement("div", { style: { fontSize: 11.5, color: COLORS.amberSoft, marginTop: 2, fontWeight: 700 } }, fmtKrwPerKg(krwPerKg)),
      React.createElement(StatGrid, { stats }),
      updatedStr && React.createElement("div", { style: { fontSize: 10.5, color: COLORS.panelBorder2, marginTop: 10, fontWeight: 600 } }, `갱신 ${updatedStr}`)
    );
  }

  function SectionLabel({ children }) {
    return React.createElement("div", {
      style: {
        fontSize: 11.5, fontWeight: 800, color: COLORS.mute, textTransform: "uppercase",
        letterSpacing: "0.08em", margin: "22px 0 10px", display: "flex", alignItems: "center", gap: 8
      }
    },
      React.createElement("span", null, children),
      React.createElement("span", { style: { flex: 1, height: 1, background: COLORS.panelBorder } })
    );
  }

  const ACCENT = { fx: "#3a6ea5", meat: "#b96a2e", futures: "#2e7d4f" };
  const SECTIONS = [["fx", "환율"], ["meat", "해외 육류 시세"], ["futures", "CME 축산 선물"]];

  function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false));
    useEffect(() => {
      const mq = window.matchMedia("(max-width: 640px)");
      const handler = (e) => setIsMobile(e.matches);
      if (mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
      return () => { if (mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler); };
    }, []);
    return isMobile;
  }

  function MobileTabs({ sections, active, onChange, counts }) {
    return React.createElement("div", { style: { display: "flex", gap: 4, background: COLORS.head, borderRadius: 10, padding: 4, marginBottom: 14 } },
      sections.map(([key, label]) => React.createElement("button", {
        key,
        onClick: () => onChange(key),
        style: {
          flex: 1, padding: "9px 4px", borderRadius: 8, border: "none", cursor: "pointer",
          background: active === key ? COLORS.panel : "transparent",
          color: active === key ? COLORS.cream : COLORS.mute,
          fontWeight: 700, fontSize: 13, boxShadow: active === key ? "0 1px 3px rgba(31,36,32,0.12)" : "none"
        }
      }, label))
    );
  }

  function MobileRow({ entry }) {
    const label = entry.label, value = entry.value, unit = entry.unit, stats = entry.stats, onClick = entry.onClick, accent = entry.accent;
    return React.createElement("div", {
      onClick,
      style: {
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12,
        padding: "12px 14px", marginBottom: 8, cursor: onClick ? "pointer" : "default",
        borderLeft: `3px solid ${accent || COLORS.panelBorder}`
      }
    },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
        React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, fontWeight: 700, letterSpacing: "-0.01em" } }, label),
        React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color: COLORS.cream, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } },
          value, unit && React.createElement("span", { style: { fontSize: 11.5, fontWeight: 600, color: COLORS.mute, marginLeft: 4 } }, unit)
        )
      ),
      fmtKrwPerKg(entry.krwPerKg) && React.createElement("div", { style: { fontSize: 11, color: COLORS.amberSoft, fontWeight: 700, marginTop: 2 } }, fmtKrwPerKg(entry.krwPerKg)),
      React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" } },
        STAT_ORDER.map(([key, slabel]) => {
          const has = key in stats;
          const v = stats[key];
          const known = has && v != null;
          const color = !known ? COLORS.panelBorder2 : v > 0 ? COLORS.rust : v < 0 ? "#3a6ea5" : COLORS.mute;
          const arrow = !known ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "―";
          return React.createElement("div", { key: slabel, style: { fontSize: 11.5 } },
            React.createElement("span", { style: { color: COLORS.mute } }, slabel + " "),
            React.createElement("span", { style: { color: color, fontWeight: 700 } }, has ? (known ? (arrow + pctFmt(v)) : "—") : "·")
          );
        })
      ),
      onClick && React.createElement("div", { style: { fontSize: 11, color: accent || COLORS.amber, marginTop: 6, fontWeight: 700 } }, "자세히 보기 \u203A"),
      fmtUpdatedAt(entry.updatedAt) && React.createElement("div", { style: { fontSize: 10, color: COLORS.panelBorder2, marginTop: 6, fontWeight: 600 } }, `갱신 ${fmtUpdatedAt(entry.updatedAt)}`)
    );
  }

  return function KeyIndicatorsApp() {
    const isMobile = useIsMobile();
    const [mobileSection, setMobileSection] = useState("fx");
    const [eu, setEu] = useState(null);
    const [fx, setFx] = useState(null);
    const [mla, setMla] = useState(null);
    const [usda, setUsda] = useState(null);
    const [usdaCutout, setUsdaCutout] = useState(null);
    const [cme, setCme] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      Promise.all([
        fetchJson("./data/eu_pigmeat_price.json"),
        fetchJson("./data/exchange_rates.json"),
        fetchJson("./data/mla_domestic.json"),
        fetchJson("./data/usda_pork_domestic.json"),
        fetchJson("./data/usda_cutout.json"),
        fetchJson("./data/cme_futures.json"),
      ]).then(([euD, fxD, mlaD, usdaD, usdaCutoutD, cmeD]) => {
        setEu(euD); setFx(fxD); setMla(mlaD); setUsda(usdaD); setUsdaCutout(usdaCutoutD); setCme(cmeD); setLoaded(true);
      });
    }, []);

    // 주별 소스(EU돈가/90CL)는 주차맵으로, 일별 소스(EYCI/미국돈육)는 원본 그대로 사용.
    // 환율(usd/eur/aud/brl)은 exchange_rates.json 자체에 전일/전주/전월/전년이 이미
    // 계산돼 들어있어서(fetch_exchange_rates.py v3) 더 이상 fx_history.json이 필요 없음.
    const weekly = useMemo(() => {
      const out = { eu: {}, cl90: {} };
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
    }, [eu, mla]);

    const cardStats = useMemo(() => {
      const eyciRows = mla?.indicators?.["0"] || [];
      const usdaRows = usda?.data ? usda.data.map((r) => ({ date: r.date, value: r["1/4 Trim Bnls Butt VAC"]?.usdPerLb })) : [];
      return {
        usdFx: fxStat(fx, "usd"),
        eurFx: fxStat(fx, "eur"),
        audFx: fxStat(fx, "aud"),
        brlFx: fxStat(fx, "brl"),
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

    // 각 지표가 실제로 어느 파이프라인에서 왔는지 보여주기 위한 "최종 갱신" 시각.
    // 각 데이터 파일이 스스로 기록한 updatedAt/collectedAt을 그대로 사용 (LLM 추정 없음).
    const fxUpdatedAt = fx?.updatedAt;
    const cmeUpdatedAt = cme?.updatedAt;
    const euUpdatedAt = eu?.collectedAt;
    const mlaUpdatedAt = mla?.collectedAt;
    const usdaUpdatedAt = usda?.collectedAt;
    const usdaCutoutUpdatedAt = usdaCutout?.collectedAt;

    // 데스크톱 카드그리드/모바일 리스트가 같은 데이터를 쓰게 항목을 배열로 뽑아둠
    const entries = [
      { section: "fx", label: "USD/KRW", value: fx?.usdKrw != null ? fx.usdKrw.toLocaleString() : "—", unit: "원", stats: cardStats.usdFx, accent: ACCENT.fx, updatedAt: fxUpdatedAt },
      { section: "fx", label: "EUR/KRW", value: fx?.eurKrw != null ? fx.eurKrw.toLocaleString() : "—", unit: "원", stats: cardStats.eurFx, accent: ACCENT.fx, updatedAt: fxUpdatedAt },
      { section: "fx", label: "AUD/KRW", value: fx?.audKrw != null ? fx.audKrw.toLocaleString() : "—", unit: "원", stats: cardStats.audFx, accent: ACCENT.fx, updatedAt: fxUpdatedAt },
      { section: "fx", label: "BRL/KRW", value: fx?.brlKrw != null ? fx.brlKrw.toLocaleString() : "—", unit: "원", stats: cardStats.brlFx, accent: ACCENT.fx, updatedAt: fxUpdatedAt },
      { section: "meat", label: "EU 돈가 (S+E 평균)", value: cardStats.eu.latest != null ? cardStats.eu.latest.toFixed(2) : "—", unit: "\u20AC/100kg", stats: cardStats.eu, accent: ACCENT.meat, onClick: () => goto("#eupigmeatprice"), krwPerKg: approxKrwPerKg(cardStats.eu.latest, "eur_per_100kg", fx), updatedAt: euUpdatedAt },
      { section: "meat", label: "EYCI (호주 소값)", value: cardStats.eyci.latest != null ? cardStats.eyci.latest.toFixed(1) : "—", unit: "c/kg cwt", stats: cardStats.eyci, accent: ACCENT.meat, onClick: () => goto("#mladomestic"), krwPerKg: approxKrwPerKg(cardStats.eyci.latest, "aud_cents_per_kg", fx), updatedAt: mlaUpdatedAt },
      { section: "meat", label: "미국 돈육 목전지", value: cardStats.usda.latest != null ? cardStats.usda.latest.toFixed(2) : "—", unit: "$/lb", stats: cardStats.usda, accent: ACCENT.meat, onClick: () => goto("#usdedomestic"), krwPerKg: approxKrwPerKg(cardStats.usda.latest, "usd_per_lb", fx), updatedAt: usdaUpdatedAt },
      { section: "meat", label: "미국 돈육 컷아웃", value: cardStats.porkCutout.latest != null ? cardStats.porkCutout.latest.toFixed(2) : "—", unit: "$/cwt", stats: cardStats.porkCutout, accent: ACCENT.meat, onClick: () => goto("#usdedomestic"), krwPerKg: approxKrwPerKg(cardStats.porkCutout.latest, "usd_per_cwt", fx), updatedAt: usdaCutoutUpdatedAt },
      { section: "meat", label: "미국 소고기 Choice 컷아웃", value: cardStats.beefCutoutChoice.latest != null ? cardStats.beefCutoutChoice.latest.toFixed(2) : "—", unit: "$/cwt", stats: cardStats.beefCutoutChoice, accent: ACCENT.meat, onClick: () => goto("#usdedomestic"), krwPerKg: approxKrwPerKg(cardStats.beefCutoutChoice.latest, "usd_per_cwt", fx), updatedAt: usdaCutoutUpdatedAt },
      { section: "meat", label: "미국 소고기 Select 컷아웃", value: cardStats.beefCutoutSelect.latest != null ? cardStats.beefCutoutSelect.latest.toFixed(2) : "—", unit: "$/cwt", stats: cardStats.beefCutoutSelect, accent: ACCENT.meat, onClick: () => goto("#usdedomestic"), krwPerKg: approxKrwPerKg(cardStats.beefCutoutSelect.latest, "usd_per_cwt", fx), updatedAt: usdaCutoutUpdatedAt },
      { section: "meat", label: "90CL 수입육 지표", value: cardStats.cl90.latest != null ? cardStats.cl90.latest.toFixed(2) : "—", unit: "US c/lb", stats: cardStats.cl90, accent: ACCENT.meat, onClick: () => goto("#mladomestic"), krwPerKg: approxKrwPerKg(cardStats.cl90.latest, "usd_cents_per_lb", fx), updatedAt: mlaUpdatedAt },
      { section: "futures", label: "Live Cattle 선물", value: cardStats.liveCattle.latest != null ? cardStats.liveCattle.latest.toFixed(2) : "—", unit: "\u00A2/lb", stats: cardStats.liveCattle, accent: ACCENT.futures, krwPerKg: approxKrwPerKg(cardStats.liveCattle.latest, "usd_cents_per_lb", fx), updatedAt: cmeUpdatedAt },
      { section: "futures", label: "Feeder Cattle 선물", value: cardStats.feederCattle.latest != null ? cardStats.feederCattle.latest.toFixed(2) : "—", unit: "\u00A2/lb", stats: cardStats.feederCattle, accent: ACCENT.futures, krwPerKg: approxKrwPerKg(cardStats.feederCattle.latest, "usd_cents_per_lb", fx), updatedAt: cmeUpdatedAt },
      { section: "futures", label: "Lean Hog 선물", value: cardStats.leanHog.latest != null ? cardStats.leanHog.latest.toFixed(2) : "—", unit: "\u00A2/lb", stats: cardStats.leanHog, accent: ACCENT.futures, krwPerKg: approxKrwPerKg(cardStats.leanHog.latest, "usd_cents_per_lb", fx), updatedAt: cmeUpdatedAt },
    ];

    if (isMobile) {
      const counts = { fx: 0, meat: 0, futures: 0 };
      entries.forEach((e) => { counts[e.section]++; });
      return React.createElement("div", { style: { padding: "16px 14px 28px" } },
        React.createElement("h1", { style: { fontSize: 19, fontWeight: 800, margin: "2px 0 10px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
        !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, marginTop: 20 } }, "불러오는 중..."),
        loaded && React.createElement(React.Fragment, null,
          React.createElement(MobileTabs, { sections: SECTIONS, active: mobileSection, onChange: setMobileSection, counts }),
          entries.filter((e) => e.section === mobileSection).map((e, i) => React.createElement(MobileRow, { key: i, entry: e }))
        )
      );
    }

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1100 } },
      React.createElement("style", { dangerouslySetInnerHTML: { __html:
        ".radar-key-card--clickable:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(31,36,32,0.10);border-color:var(--accent) !important;}"
      } }),
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 8 } },
        "각 탭에서 자동 갱신되는 데이터 요약. 카드를 클릭하면 해당 탭으로 이동합니다."
      ),

      !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, marginTop: 20 } }, "불러오는 중..."),

      loaded && React.createElement(React.Fragment, null,
        SECTIONS.map(([key, label]) => React.createElement(React.Fragment, { key },
          React.createElement(SectionLabel, null, label),
          React.createElement("div", { style: { display: "flex", gap: 14, flexWrap: "wrap" } },
            entries.filter((e) => e.section === key).map((e, i) => React.createElement(Card, {
              key: i, label: e.label, value: e.value, unit: e.unit, stats: e.stats, accent: e.accent, onClick: e.onClick, krwPerKg: e.krwPerKg, updatedAt: e.updatedAt
            }))
          )
        ))
      )
    );
  };
})();
