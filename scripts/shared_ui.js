/* 축산레이더 · 공용 UI 컴포넌트
   여러 페이지(index.html의 EU/미국 수출·검역, aus_trade/cepea_domestic/
   eu_pigmeat_price/mla_domestic/usda_domestic_app.js)에서 거의 동일한 코드를
   각자 따로 복붙해서 쓰고 있던 걸 여기 한 곳으로 모음.
   - 버그 하나 고치면 모든 페이지에 한 번에 반영됨 (예: 터치 호버 지원)
   - 페이지마다 프롭이 조금씩 달라서(formatValue, yMin/yMax, activeColor,
     dashed 시리즈 등) 전부 옵션으로 받아 이전 각 파일의 동작을 그대로 재현하게 만듦.
   window.RadarUI 하나에 전부 담아서, 각 앱 파일에서
   `const { SvgLineChart, SheetTab, ... } = window.RadarUI;` 로 꺼내 쓴다.
   index.html에 다른 app 스크립트들보다 먼저 로드돼야 함. */
window.RadarUI = (function () {
  const { useState, useRef } = React;

  const COLORS = {
    bg: "#f4f5f2", panel: "#ffffff", panelBorder: "#d7dad4", panelBorder2: "#b9bdb4",
    amber: "#b96a2e", amberSoft: "#8a5a30", cream: "#1f2420", mute: "#5b615c",
    sage: "#2e7d4f", rust: "#a34a3f", head: "#eef0ec"
  };

  const thStyle = { textAlign: "left", padding: "9px 10px", fontSize: 12.5, color: COLORS.mute, fontWeight: 700, borderBottom: `1px solid ${COLORS.panelBorder}`, whiteSpace: "nowrap" };
  const tdStyle = { padding: "8px 10px", color: COLORS.cream };

  // ── 공용 포맷 함수 ──
  function fmtUpdatedAt(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return null; }
  }
  function pctFmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    const s = v > 0 ? "+" : "";
    return `${s}${v.toFixed(1)}%`;
  }
  function defaultNumFmt(v) { return v == null || !isFinite(v) ? "—" : Number(v).toFixed(1); }
  function downloadXlsx(aoa, filename, sheetName) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    XLSX.writeFile(wb, filename);
  }

  // ── 모바일 판별 훅 (주요지표 페이지에서 먼저 쓰던 것, 다른 페이지 모바일 작업에도 재사용) ──
  function useIsMobile() {
    const { useState: useStateLocal, useEffect: useEffectLocal } = React;
    const [isMobile, setIsMobile] = useStateLocal(() => (typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false));
    useEffectLocal(() => {
      const mq = window.matchMedia("(max-width: 640px)");
      const handler = (e) => setIsMobile(e.matches);
      if (mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
      return () => { if (mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler); };
    }, []);
    return isMobile;
  }

  /* ── 호버(+터치) 툴팁 라인차트 ──
     프롭:
       formatValue        - 축/툴팁 공통 포맷터 (기본: 소수1자리)
       formatAxisValue    - 축 전용 포맷터 (없으면 formatValue, 그것도 없으면 기본)
       formatTooltipValue - 툴팁 전용 포맷터 (없으면 formatValue, 그것도 없으면 기본)
       width              - SVG viewBox 너비 (기본 900. 기존 aus/eu_pigmeat_price는
                             760을 쓰고 있었으니 그 두 곳은 호출부에서 width:760 넘김)
       yMin, yMax         - 지정하면 자동계산 대신 이 값 사용 (usda_domestic이 쓰던 기능)
       maxDots            - 이 개수 이하일 때만 각 점에 동그라미 표시 (기본 60)
     시리즈 각 항목은 { name, color, data, dashed? } 형태. dashed:true면 점선으로 표시
     (cepea_domestic이 예측치/추정치 표시에 쓰던 기능). */
  function SvgLineChart({ categories, series, height = 260, formatValue, formatAxisValue, formatTooltipValue, width = 900, yMin, yMax, maxDots = 60 }) {
    const fmtAxis = formatAxisValue || formatValue || defaultNumFmt;
    const fmtTip = formatTooltipValue || formatValue || defaultNumFmt;
    const manyLabels = categories.length > 16;
    const padding = { top: 16, right: 16, bottom: manyLabels ? 40 : 26, left: 56 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allVals = series.flatMap((s) => s.data).filter((v) => v != null && isFinite(v));
    const autoMax = allVals.length ? Math.max(...allVals) : 1;
    const autoMin = allVals.length ? Math.min(0, Math.min(...allVals) * 0.97) : 0;
    const maxVal = yMax != null ? yMax : autoMax;
    const minVal = yMin != null ? yMin : autoMin;
    const topVal = yMax != null ? maxVal : maxVal * 1.05;
    const span = Math.max(0.01, topVal - minVal);
    const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;
    const yFor = (v) => padding.top + innerH - (v - minVal) / span * innerH;
    const xFor = (i) => padding.left + i * stepX;
    const gridLines = 4;
    const labelEvery = Math.max(1, Math.ceil(categories.length / (manyLabels ? 12 : 10)));
    const containerRef = useRef(null);
    const [hoverIdx, setHoverIdx] = useState(null);
    const handleMove = (e) => {
      if (!containerRef.current || categories.length === 0) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = containerRef.current.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      setHoverIdx(Math.round(frac * (categories.length - 1)));
    };
    const tooltipLeftPct = hoverIdx !== null && categories.length > 1 ? hoverIdx / (categories.length - 1) * 100 : 50;
    return React.createElement("div", { ref: containerRef, style: { position: "relative", touchAction: "pan-y" }, onMouseMove: handleMove, onMouseLeave: () => setHoverIdx(null), onTouchStart: handleMove, onTouchMove: handleMove, onTouchEnd: () => setHoverIdx(null) },
      React.createElement("svg", { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", height, display: "block", cursor: "crosshair" }, preserveAspectRatio: "none" },
        Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padding.top + innerH / gridLines * i;
          const val = topVal - (topVal - minVal) / gridLines * i;
          return React.createElement("g", { key: i },
            React.createElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: COLORS.panelBorder, strokeDasharray: "3 3" }),
            React.createElement("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", fontSize: "9", fill: COLORS.mute }, fmtAxis(val))
          );
        }),
        categories.map((c, i) => i % labelEvery === 0 && React.createElement("text", { key: i, x: xFor(i), y: height - 8, textAnchor: "middle", fontSize: "9", fill: COLORS.mute }, c)),
        hoverIdx !== null && React.createElement("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: COLORS.amberSoft, strokeWidth: "1", strokeDasharray: "2 2" }),
        series.map((s) => {
          const segs = []; let cur = [];
          s.data.forEach((v, i) => {
            if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur); cur = []; } return; }
            cur.push(`${cur.length ? "L" : "M"}${xFor(i)},${yFor(v)}`);
          });
          if (cur.length) segs.push(cur);
          return React.createElement("g", { key: s.name },
            segs.map((seg, si) => React.createElement("path", { key: si, d: seg.join(" "), fill: "none", stroke: s.color, strokeWidth: "2.2", strokeDasharray: s.dashed ? "5 4" : undefined })),
            categories.length <= maxDots && s.data.map((v, i) => v != null && isFinite(v) && React.createElement("circle", { key: i, cx: xFor(i), cy: yFor(v), r: i === hoverIdx ? 4 : 2, fill: s.color, opacity: s.dashed ? 0.6 : 1 }))
          );
        })
      ),
      // 화면 끝쪽 데이터를 가리킬 때 툴팁이 잘리지 않게 좌/우 끝에서 방향 전환
      hoverIdx !== null && React.createElement("div", {
        style: {
          position: "absolute", left: `${tooltipLeftPct}%`, top: 6,
          transform: `translateX(${tooltipLeftPct > 70 ? "-100%" : tooltipLeftPct < 5 ? "0%" : "-50%"})`,
          background: COLORS.cream, color: "#f7f8f5", borderRadius: 8, padding: "8px 10px",
          fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 10px rgba(0,0,0,.18)", zIndex: 5
        }
      },
        React.createElement("div", { style: { fontWeight: 700, marginBottom: 4 } }, categories[hoverIdx]),
        series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", justifyContent: "space-between", gap: 10 } },
          React.createElement("span", { style: { color: s.color } }, "\u25CF " + (series.length > 1 ? s.name : "")),
          React.createElement("span", null, fmtTip(s.data[hoverIdx]))
        ))
      )
    );
  }

  function ChartLegend({ series }) {
    if (series.length < 2) return null;
    return React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6, paddingBottom: 10 } },
      series.map((s) => React.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, color: COLORS.cream } },
        React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" } }), s.name
      ))
    );
  }

  const RANK_PALETTE = ["#b96a2e", "#3f7d64", "#2f6f96", "#8a7d3a", "#7d4f79", "#a34a3f", "#6b5a8f", "#3f8768", "#b8763e", "#5580a8"];

  // 가로 막대 랭킹. formatValue 없으면 기본 숫자 포맷.
  function BarRanking({ items, formatValue }) {
    const fmt = formatValue || ((v) => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString());
    const capped = items.length > 40 ? items.slice(0, 40) : items;
    const maxVal = Math.max(0.01, ...capped.map((i) => i.v));
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } },
        capped.map((it, idx) => React.createElement("div", { key: it.key, style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("div", { style: { width: 90, fontSize: 13.5, color: COLORS.cream, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.key),
          React.createElement("div", { style: { flex: 1, background: "#e5e7e2", borderRadius: 5, height: 20, position: "relative", overflow: "hidden" } },
            React.createElement("div", { style: { width: `${it.v / maxVal * 100}%`, height: "100%", background: RANK_PALETTE[idx % RANK_PALETTE.length], borderRadius: 5 } })
          ),
          React.createElement("div", { style: { width: 80, fontSize: 13.5, color: COLORS.amberSoft, fontFamily: "ui-monospace,monospace", flexShrink: 0 } }, fmt(it.v))
        ))
      ),
      items.length > 40 && React.createElement("div", { style: { fontSize: 12.5, color: COLORS.mute, marginTop: 10, textAlign: "center" } }, `상위 40개만 표시 중 (전체 ${items.length}개)`)
    );
  }

  // 전기간 대비 순위변동 랭킹 (호주/EU 수출현황의 "재배분" 탭에서 씀).
  // items: [{ key, delta, pct }] - delta는 절대량 변화, pct는 증감률(%, 신규면 null)
  function ShiftRanking({ items, formatValue }) {
    const fmt = formatValue || ((v) => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString());
    const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.delta)));
    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } },
      items.map((it) => React.createElement("div", { key: it.key, style: { display: "flex", alignItems: "center", gap: 8 } },
        React.createElement("div", { style: { width: 100, fontSize: 13, color: COLORS.cream, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.key),
        React.createElement("div", { style: { flex: 1, position: "relative", height: 22, background: "#e5e7e2", borderRadius: 5 } },
          React.createElement("div", { style: {
            position: "absolute", top: 0, bottom: 0,
            left: it.delta >= 0 ? "50%" : `${50 - Math.abs(it.delta) / maxAbs * 50}%`,
            width: `${Math.abs(it.delta) / maxAbs * 50}%`,
            background: it.delta >= 0 ? COLORS.sage : COLORS.rust, borderRadius: 4
          } }),
          React.createElement("div", { style: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#b9bdb4" } })
        ),
        React.createElement("div", { style: { width: 165, fontSize: 13, textAlign: "right", flexShrink: 0, fontFamily: "ui-monospace,monospace" } },
          React.createElement("span", { style: { color: it.delta >= 0 ? COLORS.sage : COLORS.rust, fontWeight: 700 } }, (it.delta >= 0 ? "+" : "") + fmt(it.delta)),
          " ", React.createElement("span", { style: { color: COLORS.mute, fontSize: 11.5 } }, it.pct != null ? `(${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(1)}%)` : "(신규)")
        )
      ))
    );
  }

  function SheetTab({ active, onClick, label }) {
    return React.createElement("button", {
      onClick, style: {
        padding: "9px 18px", fontSize: 15.5, fontWeight: 700, cursor: "pointer", background: "none", border: "none",
        borderBottom: active ? `2px solid ${COLORS.amber}` : "2px solid transparent",
        color: active ? COLORS.amber : COLORS.mute, marginBottom: -1
      }
    }, label);
  }

  function SubTab({ active, onClick, label }) {
    return React.createElement("button", {
      onClick, style: {
        padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? COLORS.amber : COLORS.panelBorder}`,
        background: active ? "rgba(217,139,63,0.14)" : COLORS.panel, color: active ? COLORS.amber : COLORS.mute
      }
    }, label);
  }

  // activeColor 지정하면 그 색으로, 아니면 기본 amber (cepea/usda_domestic이 쓰던 activeColor 프롭 지원)
  function ToggleBtn({ active, onClick, label, activeColor }) {
    const c = activeColor || COLORS.amber;
    return React.createElement("button", {
      onClick, style: {
        padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? c : COLORS.panelBorder}`,
        background: active ? `${c}22` : COLORS.panel, color: active ? c : COLORS.mute
      }
    }, label);
  }

  // mla_domestic이 쓰던 알약형 토글 (ToggleBtn과 모양만 다름, 같은 용도)
  function PillToggle({ active, onClick, children, color }) {
    return React.createElement("button", {
      onClick, style: {
        padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
        border: `1px solid ${active ? (color || COLORS.amber) : COLORS.panelBorder}`,
        background: active ? (color || COLORS.amber) : COLORS.panel,
        color: active ? "#ffffff" : COLORS.mute, fontWeight: 700, whiteSpace: "nowrap"
      }
    }, children);
  }

  // 데스크톱: 마우스 올리면 열리고 벗어나면 자동으로 닫힘.
  // 터치 기기: 탭해서 열고, 다른 곳 탭하면 닫힘 (hover 이벤트가 없으니 클릭으로 대체).
  // 둘 다 같은 컴포넌트로 처리 - 마우스가 있는 기기면 hover가 이미 다 해주니 클릭 핸들러는
  // 방해되지 않고, 터치 기기에서는 hover 자체가 안 일어나니 클릭이 유일한 진입점이 됨.
  function useHoverOrClick() {
    const { useState: useStateLocal, useRef: useRefLocal, useEffect: useEffectLocal } = React;
    const [open, setOpen] = useStateLocal(false);
    const closeTimer = useRefLocal(null);
    const rootRef = useRefLocal(null);
    // 터치 전용 기기는 tap 한 번에 mouseenter(호버 시뮬레이션)와 click이 연달아 발생해서,
    // 열렸다가(mouseenter) 바로 토글로 닫히는(click) 문제가 있었음. 진짜 마우스가 있는
    // 기기에서만 hover로 열고닫게 하고, 터치 기기는 click 토글만 쓰게 분리.
    const supportsHover = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches;
    const clearTimer = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
    const openNow = () => { clearTimer(); setOpen(true); };
    const closeSoon = () => { clearTimer(); closeTimer.current = setTimeout(() => setOpen(false), 180); };
    const toggleClick = (e) => { e.preventDefault(); setOpen((o) => !o); };
    useEffectLocal(() => {
      if (!open) return;
      const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }, [open]);
    useEffectLocal(() => clearTimer, []);
    return {
      open, setOpen, rootRef,
      onMouseEnter: supportsHover ? openNow : undefined,
      onMouseLeave: supportsHover ? closeSoon : undefined,
      onSummaryClick: toggleClick
    };
  }

  function HoverAxisPicker({ label, value, onChange, options }) {
    const { open, setOpen, rootRef, onMouseEnter, onMouseLeave, onSummaryClick } = useHoverOrClick();
    const found = options.find(([v]) => v === value);
    const currentLabel = found ? found[1] : value;
    return React.createElement("div", { ref: rootRef, style: { position: "relative", display: "inline-block" }, onMouseEnter, onMouseLeave },
      React.createElement("div", { onClick: onSummaryClick, style: { display: "flex", alignItems: "center", gap: 6, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" } },
        React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, label),
        React.createElement("span", { style: { fontSize: 14.5, fontWeight: 700, color: COLORS.amber } }, currentLabel),
        React.createElement("span", { style: { fontSize: 12, color: COLORS.mute } }, "\u25BE")
      ),
      open && React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, zIndex: 20, background: "#eef0ec", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 10, padding: 6, minWidth: 130, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" } },
        options.map(([v, l]) => React.createElement("button", {
          key: v, onClick: () => { onChange(v); setOpen(false); },
          style: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 6, fontSize: 14.5, cursor: "pointer", border: "none", background: v === value ? "rgba(217,139,63,0.18)" : "transparent", color: v === value ? COLORS.amberSoft : COLORS.cream, whiteSpace: "nowrap" }
        }, l))
      )
    );
  }

  function HoverMultiPicker({ label, options, selected, onToggle, onSelectAll, onClear }) {
    const { open, rootRef, onMouseEnter, onMouseLeave, onSummaryClick } = useHoverOrClick();
    return React.createElement("div", { ref: rootRef, style: { position: "relative", display: "inline-block" }, onMouseEnter, onMouseLeave },
      React.createElement("div", { onClick: onSummaryClick, style: { display: "flex", alignItems: "center", gap: 6, background: COLORS.panel, border: `1px solid ${selected.length ? COLORS.amber : COLORS.panelBorder}`, borderRadius: 8, padding: "6px 12px", color: selected.length ? COLORS.amber : COLORS.mute, fontSize: 14.5, fontWeight: 600, cursor: "pointer" } },
        label, " ", selected.length ? `(${selected.length})` : "전체", " ", React.createElement("span", { style: { fontSize: 12 } }, "\u25BE")),
      open && React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, zIndex: 20, background: "#eef0ec", border: `1px solid ${COLORS.panelBorder2}`, borderRadius: 10, padding: 10, width: 240, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
          React.createElement("span", { style: { fontSize: 13, color: COLORS.mute } }, options.length, "개 옵션"),
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("button", { onClick: onSelectAll, style: { fontSize: 13, color: COLORS.sage, background: "none", border: "none", cursor: "pointer", fontWeight: 700 } }, "전체 선택"),
            React.createElement("button", { onClick: onClear, style: { fontSize: 13, color: COLORS.rust, background: "none", border: "none", cursor: "pointer", fontWeight: 700 } }, "초기화")
          )
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
          options.map((o) => React.createElement("button", {
            key: o, onClick: () => onToggle(o),
            style: { padding: "4px 9px", borderRadius: 6, fontSize: 13.5, cursor: "pointer", border: `1px solid ${selected.includes(o) ? COLORS.amber : COLORS.panelBorder2}`, background: selected.includes(o) ? "rgba(217,139,63,0.18)" : "transparent", color: selected.includes(o) ? COLORS.amberSoft : COLORS.mute }
          }, o))
        )
      )
    );
  }

  function ChipGroup({ label, options, value, onChange }) {
    return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
      label && React.createElement("span", { style: { fontSize: 13, color: COLORS.mute, marginRight: 2 } }, label),
      options.map((o) => React.createElement("button", {
        key: o, onClick: () => onChange(o),
        style: { padding: "5px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", fontWeight: 700, border: `1px solid ${value === o ? COLORS.amber : COLORS.panelBorder}`, background: value === o ? COLORS.amber : COLORS.panel, color: value === o ? "#ffffff" : COLORS.mute }
      }, o))
    );
  }

  return {
    COLORS, thStyle, tdStyle,
    fmtUpdatedAt, pctFmt, downloadXlsx, useIsMobile,
    SvgLineChart, ChartLegend, BarRanking, ShiftRanking,
    SheetTab, SubTab, ToggleBtn, PillToggle,
    HoverAxisPicker, HoverMultiPicker, ChipGroup,
  };
})();
