/* 축산레이더 · 가축전염병(ASF 등) 발생현황
   두 소스를 합쳐서 보여줌:
   1) 해외(WOAH 즉시통보) - 축산라이브러리 레포(Livestock-Revolution-Second)의
      data/asf_alerts.json을 크로스레포로 가져옴 (Gmail 자동 파이프라인 산출물).
   2) 국내(검역본부) - data/domestic_disease.json (fetch_domestic_disease.py 산출물,
      API_KEY 발급 전까지는 파일이 없거나 비어있을 수 있음).
*/
window.DiseaseStatusApp = (function () {
  const { useState, useEffect } = React;
  const { COLORS, fmtUpdatedAt } = window.RadarUI;

  const OVERSEAS_URL = "https://raw.githubusercontent.com/jeruhe2-sketch/Livestock-Revolution-Second/main/data/asf_alerts.json";

  // 회사 실제 거래 원산지 - 매칭되면 강조 표시
  const WATCHED_COUNTRIES = ["스페인", "브라질"];

  function Badge({ text, tone }) {
    const palette = {
      danger: { bg: "#fbeceb", fg: COLORS.rust },
      warn: { bg: "#faf3e6", fg: COLORS.amberSoft },
      ok: { bg: "#eaf3ee", fg: COLORS.sage },
      neutral: { bg: COLORS.head, fg: COLORS.mute },
    }[tone] || { bg: COLORS.head, fg: COLORS.mute };
    return React.createElement("span", {
      style: { fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: palette.bg, color: palette.fg }
    }, text);
  }

  function Card({ children }) {
    return React.createElement("div", {
      style: { background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 10, padding: "14px 16px" }
    }, children);
  }

  return function DiseaseStatusApp() {
    const [overseas, setOverseas] = useState(null);
    const [overseasError, setOverseasError] = useState(null);

    useEffect(() => {
      fetch(OVERSEAS_URL, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("no-file"); return r.json(); })
        .then(setOverseas)
        .catch((e) => setOverseasError(String(e)));
    }, []);

    const overseasAlerts = overseas?.alerts || [];
    const urgentAlerts = overseasAlerts.filter((a) => a.urgent);

    return React.createElement("div", { style: { padding: "24px 28px", maxWidth: 900 } },
      React.createElement("h1", { style: { fontSize: "clamp(18px,5.5vw,23px)", fontWeight: 800, margin: "5px 0 4px", color: COLORS.cream } }, "가축전염병 발생현황"),
      React.createElement("div", { style: { fontSize: 13, color: COLORS.mute, marginBottom: 20 } },
        "해외(WOAH 즉시통보) 발생현황을 확인합니다."
      ),

      urgentAlerts.length > 0 && React.createElement("div", {
        style: { display: "flex", gap: 10, alignItems: "flex-start", background: "#fbeceb", border: `1px solid #e7bdb8`, borderRadius: 10, padding: "12px 14px", marginBottom: 20 }
      },
        React.createElement("div", { style: { fontSize: 18 } }, "\u26A0\uFE0F"),
        React.createElement("div", null,
          React.createElement("div", { style: { fontWeight: 800, color: COLORS.rust, marginBottom: 2 } }, `공급사 원산지 관련 알림 ${urgentAlerts.length}건`),
          React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute } }, "스페인/브라질 등 실제 거래 원산지가 언급된 WOAH 알림입니다. 아래 목록을 확인하세요.")
        )
      ),

      React.createElement("h2", { style: { fontSize: 15, fontWeight: 800, color: COLORS.cream, margin: "0 0 10px" } }, "\u{1F30F} 해외 (WOAH 즉시통보)"),
      overseasError && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, marginBottom: 20 } }, "아직 데이터가 없습니다 (파이프라인 최초 알림 대기 중)."),
      !overseasError && !overseas && React.createElement("div", { style: { color: COLORS.mute, fontSize: 13, marginBottom: 20 } }, "불러오는 중..."),
      overseas && React.createElement(React.Fragment, null,
        overseasAlerts.length === 0
          ? React.createElement(Card, null, React.createElement("div", { style: { color: COLORS.mute, fontSize: 13 } }, "아직 수신된 알림이 없습니다."))
          : React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 } },
              overseasAlerts.slice(0, 20).map((a, i) => React.createElement(Card, { key: a.message_id || i },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 } },
                  React.createElement("div", { style: { fontSize: 13.5, color: COLORS.cream, fontWeight: 600, lineHeight: 1.5 } }, a.subject || "(제목 없음)"),
                  a.urgent
                    ? React.createElement(Badge, { text: `\u26A0 ${a.matched_country || "관련"}`, tone: "danger" })
                    : React.createElement(Badge, { text: a.disease || "기타", tone: "neutral" })
                ),
                React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginTop: 6 } }, a.received_at || "")
              ))
            ),
        React.createElement("div", { style: { fontSize: 12, color: COLORS.mute, marginBottom: 24 } }, `최근 갱신: ${fmtUpdatedAt(overseas.updated_at) || "—"}`)
      ),

      React.createElement("div", { style: { fontSize: 11.5, color: COLORS.mute, marginTop: 24, borderTop: `1px solid ${COLORS.panelBorder}`, paddingTop: 10 } },
        "해외 데이터는 WOAH(세계동물보건기구) 즉시통보 이메일을 30분 이내 반영합니다."
      )
    );
  };
})();
