/* 축산레이더 · 주요지표
   이미 사이트에 있는 데이터 파일들(EU돈가/환율/호주EYCI/미국돈육)을 한 화면에 모아
   요약해서 보여주는 롤업 배너. 새로운 원자료 수집은 없고, 이미 각자 탭에서
   자동 갱신되는 JSON들을 프론트에서 한 번 더 읽어 요약만 함 (LLM/수동작업 없음).

   CME Live Cattle 선물, Steiner 90CL 지표는 유료/구독 데이터라 자동화된 무료 API가
   없어서 여기 포함하지 않음 (수입육 시황 브리핑 스킬이 계속 수동 확인). */
window.KeyIndicatorsApp = (function () {
  const { useState, useEffect } = React;

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

  function Card({ label, value, unit, sub, subColor, asOf, source, onClick, pending }) {
    return React.createElement("div", {
      onClick,
      style: {
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 12,
        padding: "16px 18px", cursor: onClick ? "pointer" : "default", minWidth: 200, flex: "1 1 200px",
        opacity: pending ? 0.55 : 1
      }
    },
      React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginBottom: 8, fontWeight: 700 } }, label),
      React.createElement("div", { style: { fontSize: 26, fontWeight: 800, color: COLORS.cream, lineHeight: 1.1 } },
        value, unit && React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: COLORS.mute, marginLeft: 5 } }, unit)
      ),
      sub && React.createElement("div", { style: { fontSize: 13, color: subColor || COLORS.mute, marginTop: 6, fontWeight: 700 } }, sub),
      (asOf || source) && React.createElement("div", { style: { fontSize: 11, color: COLORS.mute, marginTop: 8 } }, [asOf, source].filter(Boolean).join(" · "))
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
    const [mla, setMla] = useState(null);
    const [usda, setUsda] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      Promise.all([
        fetchJson("./data/eu_pigmeat_price.json"),
        fetchJson("./data/exchange_rates.json"),
        fetchJson("./data/mla_domestic.json"),
        fetchJson("./data/usda_pork_domestic.json"),
      ]).then(([euD, fxD, mlaD, usdaD]) => {
        setEu(euD); setFx(fxD); setMla(mlaD); setUsda(usdaD); setLoaded(true);
      });
    }, []);

    const goto = (hash) => { window.location.hash = hash; };

    // EU 돈가: EU 평균, S+E 등급 최신 주 평균
    let euCard = null;
    if (eu) {
      const euRows = eu.data.filter((r) => r[3] === "EU");
      const latestWeek = euRows.length ? Math.max(...euRows.map((r) => r[0] * 100 + r[1])) : null;
      const wk = latestWeek != null ? euRows.filter((r) => r[0] * 100 + r[1] === latestWeek) : [];
      const avg = wk.length ? wk.reduce((s, r) => s + r[4], 0) / wk.length : null;
      const yr = latestWeek != null ? Math.floor(latestWeek / 100) : null;
      const wkNo = latestWeek != null ? latestWeek % 100 : null;
      euCard = { avg, label: yr ? `${yr}-W${String(wkNo).padStart(2, "0")}` : null, source: eu.sourceMostRecentData };
    }

    // 호주 EYCI
    let eyci = null, eyciWow = null;
    if (mla && mla.indicators && mla.indicators["0"]) {
      const s = mla.indicators["0"];
      const latest = s[s.length - 1];
      const weekAgo = s[s.length - 8];
      eyci = latest;
      eyciWow = latest && weekAgo ? (latest.value - weekAgo.value) / weekAgo.value * 100 : null;
    }

    // 미국 돈육 (목전지 - 가장 물량 많은 컷)
    let usdaCut = null;
    if (usda && usda.data && usda.data.length) {
      const last = usda.data[usda.data.length - 1];
      usdaCut = last["1/4 Trim Butt VAC"];
    }

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 1040 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", letterSpacing: "-0.01em", color: COLORS.cream } }, "주요지표"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 20 } },
        "사이트 내 각 탭에서 자동 갱신되는 데이터를 한 화면에 모은 요약입니다. 클릭하면 해당 탭으로 이동합니다."
      ),

      !loaded && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "불러오는 중..."),

      loaded && React.createElement(React.Fragment, null,
        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "환율"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
          React.createElement(Card, {
            label: "USD/KRW", value: fx?.usdKrw != null ? fx.usdKrw.toLocaleString() : "—", unit: "원",
            asOf: fmtUpdatedAt(fx?.updatedAt), source: fx?.source
          }),
          React.createElement(Card, {
            label: "EUR/KRW", value: fx?.eurKrw != null ? fx.eurKrw.toLocaleString() : "—", unit: "원",
            asOf: fmtUpdatedAt(fx?.updatedAt), source: fx?.source
          })
        ),

        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "해외 내수 시세"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
          React.createElement(Card, {
            onClick: () => goto("#eupigmeatprice"),
            label: "EU 돈가 (S+E 평균)", value: euCard?.avg != null ? euCard.avg.toFixed(2) : "—", unit: "\u20AC/100kg",
            sub: euCard?.label ? euCard.label : null,
            asOf: `EU 집행위 \u00B7 ${euCard?.source || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#mladomestic"),
            label: "EYCI (호주 소값)", value: eyci?.value != null ? eyci.value.toFixed(1) : "—", unit: "c/kg cwt",
            sub: eyciWow != null ? `1주 ${pctFmt(eyciWow)}` : null,
            subColor: eyciWow > 0 ? COLORS.rust : "#3a6ea5",
            asOf: `MLA \u00B7 ${eyci?.date || "—"}`
          }),
          React.createElement(Card, {
            onClick: () => goto("#usdedomestic"),
            label: "미국 돈육 목전지", value: usdaCut ? usdaCut.usdPerLb.toFixed(2) : "—", unit: "$/lb",
            asOf: `USDA LMR \u00B7 ${usda?.data?.[usda.data.length - 1]?.date || "—"}`
          })
        ),

        React.createElement("h2", { style: { fontSize: 14, fontWeight: 800, color: COLORS.mute, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" } }, "자동화 안 되는 지표 (수동 확인 필요)"),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
          React.createElement(PendingCard, { label: "CME Live Cattle 선물", note: "CME 실시간/지연 시세는 유료 라이선스 필요. 무료 API 없음." }),
          React.createElement(PendingCard, { label: "미국 90CL 수입육 지표", note: "Steiner Consulting 구독 데이터. MLA API report/9에서 republish하지만 별도 검증 필요." }),
          React.createElement(PendingCard, { label: "미국 소 도축(주간)", note: "USDA 리포트 slug 확인 후 추가 예정." })
        )
      ),

      React.createElement("p", { style: { fontSize: 12, color: COLORS.mute, marginTop: 20, lineHeight: 1.6 } },
        "이 화면은 새로 데이터를 수집하지 않고, 각 탭이 이미 자동 갱신한 파일을 한 번 더 읽어 보여줍니다. 상세 내역/차트/엑셀 다운로드는 각 탭에서 확인하세요."
      )
    );
  };
})();
