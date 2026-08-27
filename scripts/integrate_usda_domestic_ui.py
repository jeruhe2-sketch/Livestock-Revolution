"""One-time integration patch for the existing monolithic index.html.

Only inserts the new external USDA domestic app and a fifth sidebar route.
Existing Quarantine/EuTrade/Usda/Warehouse IIFEs are not edited.
"""
from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")

SCRIPT = '<script src="./scripts/usda_domestic_app.js?v=1"></script>\n'
marker = '<script>\n\nwindow.QuarantineApp'
if SCRIPT not in s:
    if marker not in s:
        raise SystemExit("index.html insertion marker not found")
    s = s.replace(marker, SCRIPT + marker, 1)

old_hash = '    if (h === "#usda") return "usda";\n    return "quarantine";'
new_hash = '    if (h === "#usda") return "usda";\n    if (h === "#usdedomestic") return "usdedomestic";\n    return "quarantine";'
if 'h === "#usdedomestic"' not in s:
    if old_hash not in s:
        raise SystemExit("ShellApp hash marker not found")
    s = s.replace(old_hash, new_hash, 1)

old_nav = '''    NavItem,\n    {\n      active: view === "warehouse",\n      onClick: () => selectView("warehouse"),\n      icon: "\\u{1F3ED}",\n      label: "\\uC885\\uD569\\uCC3D\\uACE0\\uD604\\uD669"\n    }\n  ))),'''
new_nav = '''    NavItem,\n    {\n      active: view === "warehouse",\n      onClick: () => selectView("warehouse"),\n      icon: "\\u{1F3ED}",\n      label: "\\uC885\\uD569\\uCC3D\\uACE0\\uD604\\uD669"\n    }\n  , /* USDA 국내 */ React.createElement(\n    NavItem,\n    {\n      active: view === "usdedomestic",\n      onClick: () => selectView("usdedomestic"),\n      icon: "\\u{1F1FA}\\u{1F1F8}",\n      label: "\\uBBF8\\uAD6D \\uCD95\\uC0B0\\uBB3C \\uB0B4\\uC218 \\uD604\\uD669"\n    }\n  ))),'''
if 'view === "usdedomestic"' not in s:
    # Match the literal source as it exists in index.html.
    old_nav = '''    NavItem,\n    {\n      active: view === "warehouse",\n      onClick: () => selectView("warehouse"),\n      icon: "\\u{1F3ED}",\n      label: "\\uC885\\uD569\\uCC3D\\uACE0\\uD604\\uD669"\n    }\n  ))),'''
    if old_nav not in s:
        raise SystemExit("sidebar marker not found")
    new_nav = '''    NavItem,\n    {\n      active: view === "warehouse",\n      onClick: () => selectView("warehouse"),\n      icon: "\\u{1F3ED}",\n      label: "\\uC885\\uD569\\uCC3D\\uACE0\\uD604\\uD669"\n    }\n  ), /* USDA domestic */ React.createElement(\n    NavItem,\n    {\n      active: view === "usdedomestic",\n      onClick: () => selectView("usdedomestic"),\n      icon: "\\u{1F1FA}\\u{1F1F8}",\n      label: "\\uBBF8\\uAD6D \\uCD95\\uC0B0\\uBB3C \\uB0B4\\uC218 \\uD604\\uD669"\n    }\n  ))),'''
    s = s.replace(old_nav, new_nav, 1)

old_render = 'view === "usda" && /* @__PURE__ */ React.createElement(ErrorBoundary, { label: "\\uBBF8\\uAD6D \\uCD95\\uC0B0\\uBB3C \\uc218\\uCD9C\\uD604\\uD669" }, /* @__PURE__ */ React.createElement(UsdaTradeApp, null)), view === "warehouse"'
new_render = 'view === "usda" && /* @__PURE__ */ React.createElement(ErrorBoundary, { label: "\\uBBF8\\uAD6D \\uCD95\\uC0B0\\uBB3C \\uc218\\uCD9C\\uD604\\uD669" }, /* @__PURE__ */ React.createElement(UsdaTradeApp, null)), view === "usdedomestic" && /* @__PURE__ */ React.createElement(ErrorBoundary, { label: "\\uBBF8\\uAD6D \\uCD95\\uC0B0\\uBB3C \\uB0B4\\uC218 \\uD604\\uD669" }, /* @__PURE__ */ React.createElement(UsdaDomesticApp, null)), view === "warehouse"'
if 'React.createElement(UsdaDomesticApp, null)' not in s:
    if old_render not in s:
        raise SystemExit("ShellApp render marker not found")
    s = s.replace(old_render, new_render, 1)

p.write_text(s, encoding="utf-8")
print("index.html patched for USDA domestic dashboard")
