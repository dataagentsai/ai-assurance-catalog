#!/usr/bin/env node
/*
 * Renders the catalog to a single self-contained HTML page.
 *
 * The YAML in catalog/ is the master. This file produces a build artifact and
 * nothing in site/ should ever be edited by hand.
 *
 * Horizontal code only: this reads the catalog and writes a document. It does
 * not evaluate anything. See docs/NON-GOALS.md.
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const load = (p) => yaml.load(fs.readFileSync(path.join(ROOT, p), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const arch = load("taxonomy/archetypes.yaml");
const real = load("taxonomy/realization.yaml");

const cases = fs
  .readdirSync(path.join(ROOT, "catalog"))
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => yaml.load(fs.readFileSync(path.join(ROOT, "catalog", f), "utf8")))
  .filter((c) => c.status === "active");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cwDir = path.join(ROOT, "crosswalks");
const crosswalks = !fs.existsSync(cwDir) ? [] : fs
  .readdirSync(cwDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => yaml.load(fs.readFileSync(path.join(cwDir, f), "utf8")));

const realDir = path.join(ROOT, "realizations");
const realizations = {};
if (fs.existsSync(realDir)) {
  for (const f of fs.readdirSync(realDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const d = yaml.load(fs.readFileSync(path.join(realDir, f), "utf8"));
    Object.assign(realizations, d.cases);
  }
}
const approaches = real.approaches || [];

// Non-normative commentary, keyed by id. The catalog stays the authority; this
// only ever answers questions *about* a statement, never restates one. See
// guidance/README.md for why the fields are fixed rather than free prose.
const guideDir = path.join(ROOT, "guidance");
const guidance = {};
if (fs.existsSync(guideDir)) {
  for (const f of fs.readdirSync(guideDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const g = yaml.load(fs.readFileSync(path.join(guideDir, f), "utf8"));
    const trim = (v) => (typeof v === "string" ? v.trim() : v);
    guidance[g.id] = {
      plain: trim(g.plain),
      why: trim(g.why),
      example: trim(g.example),
      detect: trim(g.detect),
      not_this: (g.not_this || []).map((n) => ({ id: n.id, why: trim(n.why) })),
    };
  }
}

const patDir = path.join(ROOT, "patterns");
const patterns = !fs.existsSync(patDir) ? [] : fs
  .readdirSync(patDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .flatMap((f) => {
    const d = yaml.load(fs.readFileSync(path.join(patDir, f), "utf8"));
    return d.patterns.filter((p) => p.status === "active").map((p) => ({ ...p, domain: d.domain }));
  });

const data = {
  version: pkg.version,
  archetypes: arch.archetypes,
  mechanisms: real.mechanisms,
  stages: real.stages,
  levels: real.levels,
  dimensions: real.dimensions,
  approaches,
  realizations,
  guidance,
  cases: cases.map((c) => ({
    id: c.id, legacy: c.legacy_id, level: c.level, dim: c.dimension, gate: c.gate,
    core: c.core, arch: c.archetypes, title: c.title.trim(), text: c.statement.trim(),
    mech: c.mechanisms, stage: c.stages, tool: c.tool_class.trim(),
  })),
};

const CSS = `
:root{
  --paper:#F1F2ED; --surface:#FBFBF8; --sunk:#E9EBE3;
  --ink:#141917; --ink-2:#4E5852; --ink-3:#7C8781;
  --rule:#D3D7CC; --rule-2:#C0C6B8;
  --accent:#2C5D4A; --accent-soft:#DDE8E1;
  --must:#9E3B22; --should:#8A6608; --may:#5F6B65;
  --must-bg:#F4E2DC; --should-bg:#F2EAD3; --may-bg:#E6E9E3;
  --serif:ui-serif,Charter,"Iowan Old Style","Source Serif Pro",Georgia,serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#0E1211; --surface:#151A18; --sunk:#111614;
  --ink:#E6EAE4; --ink-2:#A2ADA6; --ink-3:#78837D;
  --rule:#28302C; --rule-2:#333D38;
  --accent:#74B294; --accent-soft:#1A2A22;
  --must:#E2896C; --should:#D2A63F; --may:#94A19A;
  --must-bg:#2B1A15; --should-bg:#2A2313; --may-bg:#1D2320;
}}
:root[data-theme="dark"]{
  --paper:#0E1211; --surface:#151A18; --sunk:#111614;
  --ink:#E6EAE4; --ink-2:#A2ADA6; --ink-3:#78837D;
  --rule:#28302C; --rule-2:#333D38;
  --accent:#74B294; --accent-soft:#1A2A22;
  --must:#E2896C; --should:#D2A63F; --may:#94A19A;
  --must-bg:#2B1A15; --should-bg:#2A2313; --may-bg:#1D2320;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px}
.prose{max-width:68ch}
p{margin:0 0 1em}
a{color:var(--accent);text-underline-offset:3px}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
code{font-family:var(--mono);font-size:.86em;background:var(--sunk);padding:.1em .35em;border-radius:3px}
.mast{border-bottom:1px solid var(--rule);background:var(--surface)}
.mast .wrap{padding-top:52px;padding-bottom:40px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 20px;display:flex;gap:14px;flex-wrap:wrap}
.eyebrow span:not(:first-child){color:var(--ink-3)}
h1{font-family:var(--mono);font-weight:600;font-size:clamp(30px,4.6vw,48px);line-height:1.08;letter-spacing:-.025em;margin:0 0 22px;text-wrap:balance;max-width:20ch}
.standfirst{font-size:20px;line-height:1.5;color:var(--ink-2);max-width:62ch;margin:0 0 28px}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);margin-top:32px}
.meta-grid div{background:var(--surface);padding:12px 14px}
.meta-grid dt{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 4px}
.meta-grid dd{margin:0;font-family:var(--mono);font-size:13px}
nav.toc{position:sticky;top:0;z-index:40;background:var(--paper);border-bottom:1px solid var(--rule);overflow-x:auto}
nav.toc .wrap{display:flex;padding-top:0;padding-bottom:0}
nav.toc ol{list-style:none;display:flex;gap:0;margin:0;padding:0;min-width:max-content}
nav.toc a{display:block;font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;color:var(--ink-2);padding:13px 16px 12px;border-bottom:2px solid transparent;white-space:nowrap}
nav.toc a:hover{color:var(--ink);border-bottom-color:var(--rule-2)}
nav.toc li:first-child a{padding-left:0}
section{padding:56px 0;border-bottom:1px solid var(--rule);scroll-margin-top:46px}
.snum{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--accent);text-transform:uppercase;display:block;margin-bottom:12px}
h2{font-family:var(--mono);font-weight:600;font-size:clamp(21px,2.6vw,28px);letter-spacing:-.015em;margin:0 0 18px;text-wrap:balance}
h3{font-family:var(--mono);font-weight:600;font-size:16px;margin:0}
.lede{font-size:19px;color:var(--ink-2);max-width:64ch;margin:0 0 26px}
.note{border-left:3px solid var(--accent);background:var(--surface);padding:16px 20px;margin:26px 0;max-width:68ch}
.note p:last-child{margin-bottom:0}
.note .tag{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);display:block;margin-bottom:6px}
.tbl-scroll{overflow-x:auto;margin:22px 0;border:1px solid var(--rule);background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:560px;font-family:var(--sans);font-size:14px}
th{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:11px 14px;border-bottom:1px solid var(--rule);font-weight:600}
td{padding:11px 14px;border-bottom:1px solid var(--rule);vertical-align:top;color:var(--ink-2);line-height:1.5}
tr:last-child td{border-bottom:none}
td.k{font-family:var(--mono);font-size:12.5px;color:var(--ink);white-space:nowrap;font-weight:600}
.arch-list{display:grid;gap:1px;background:var(--rule);border:1px solid var(--rule);margin-top:28px}
.arch{background:var(--surface);padding:18px 20px;display:grid;grid-template-columns:64px 1fr auto;gap:18px;align-items:start}
.arch .aid{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--accent);padding-top:2px}
.arch .abody strong{display:block;font-family:var(--mono);font-size:15px;margin-bottom:4px}
.arch .abody p{margin:0;font-size:15.5px;color:var(--ink-2);line-height:1.55;max-width:60ch}
.arch .abody em{color:var(--ink-3);font-style:normal;font-family:var(--mono);font-size:12.5px;display:block;margin-top:6px}
.arch .acount{font-family:var(--mono);font-size:11px;color:var(--ink-3);text-align:right;white-space:nowrap;padding-top:4px}
.arch .acount b{display:block;font-size:19px;color:var(--ink)}
@media(max-width:660px){.arch{grid-template-columns:1fr;gap:8px}.arch .acount{text-align:left}}
.controls{position:sticky;top:44px;z-index:30;background:var(--paper);padding:14px 0 12px;border-bottom:1px solid var(--rule)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tabs button{font-family:var(--mono);font-size:11.5px;cursor:pointer;background:var(--surface);color:var(--ink-2);border:1px solid var(--rule);padding:6px 11px;border-radius:2px}
.tabs button:hover{border-color:var(--rule-2);color:var(--ink)}
.tabs button[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:var(--surface)}
.filterbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.filterbar input[type=search]{font-family:var(--sans);font-size:13.5px;padding:7px 11px;flex:1 1 230px;background:var(--surface);border:1px solid var(--rule);color:var(--ink);border-radius:2px}
.filterbar label{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap}
.filterbar .count{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin-left:auto}
.grouphdr{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:34px 0 12px;border-bottom:1px solid var(--rule-2)}
.grouphdr .gid{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);text-transform:uppercase}
.grouphdr .ghint{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin-left:auto}
.cases{display:grid;gap:1px;background:var(--rule);border:1px solid var(--rule);border-top:none}
.case{background:var(--surface);padding:16px 18px;display:grid;grid-template-columns:1fr 268px;gap:26px}
@media(max-width:820px){.case{grid-template-columns:1fr;gap:12px}}
.case .lhs{min-width:0}
.caseline{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}
.cid{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--ink)}
.legacy{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.lvl{font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;padding:2px 6px;border-radius:2px;font-weight:600}
.lvl.MUST{color:var(--must);background:var(--must-bg)}
.lvl.SHOULD{color:var(--should);background:var(--should-bg)}
.lvl.MAY{color:var(--may);background:var(--may-bg)}
.dim{font-family:var(--mono);font-size:10.5px;color:var(--ink-3)}
.case h5{margin:0 0 5px;font-family:var(--serif);font-size:17px;font-weight:600;line-height:1.4;color:var(--ink)}
.case p{margin:0;font-size:15px;line-height:1.55;color:var(--ink-2);max-width:58ch}
.rhs{border-left:1px solid var(--rule);padding-left:22px;display:flex;flex-direction:column;gap:9px}
@media(max-width:820px){.rhs{border-left:none;border-top:1px dashed var(--rule);padding-left:0;padding-top:12px}}
.slot{display:grid;grid-template-columns:52px 1fr;gap:9px;align-items:start}
.slot .sk{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);padding-top:3px}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-family:var(--mono);font-size:11px;padding:2px 7px;border-radius:2px;background:var(--accent-soft);color:var(--accent);border:1px solid transparent;cursor:help;white-space:nowrap}
.chip.n{background:var(--sunk);color:var(--ink-2);border-color:var(--rule)}
.chip.gate{background:var(--must-bg);color:var(--must)}
.chip.howchip{background:transparent;border-color:var(--accent);color:var(--accent);cursor:default}
.apbar{display:flex;flex-wrap:wrap;gap:6px;margin:22px 0 4px}
.apbar button{font-family:var(--mono);font-size:11.5px;cursor:pointer;background:var(--surface);color:var(--ink-2);border:1px solid var(--rule);padding:6px 11px;border-radius:2px}
.apbar button:hover{border-color:var(--rule-2);color:var(--ink)}
.apbar button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--surface)}
#buildtbl table{min-width:900px}
#buildtbl td.cs{white-space:nowrap;font-family:var(--mono);font-size:12px;color:var(--ink);font-weight:600;vertical-align:top}
#buildtbl td.cs span{display:block;font-family:var(--serif);font-size:13px;font-weight:400;color:var(--ink-3);white-space:normal;max-width:22ch;margin-top:3px}
#buildtbl tr.newcase td{border-top:2px solid var(--rule-2)}
#buildtbl .tl{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);display:block;margin-top:4px}
/* Guidance. Visually quieter than the statement on purpose — it is commentary,
   and it should never compete with the normative text for the eye. */
.guide{margin-top:12px;border-top:1px dashed var(--rule);padding-top:10px}
.guide>summary{cursor:pointer;font:600 12px/1.4 var(--sans);letter-spacing:.03em;
  text-transform:uppercase;color:var(--accent);list-style:none;display:inline-flex;
  align-items:center;gap:6px;padding:2px 0}
.guide>summary::-webkit-details-marker{display:none}
.guide>summary::before{content:"›";display:inline-block;transition:transform .15s ease;font-size:15px}
.guide[open]>summary::before{transform:rotate(90deg)}
.guide>summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}
.gbody{margin-top:10px;padding:12px 14px;background:var(--sunk);border-radius:6px}
.gpart{margin-bottom:14px}
.gpart:last-of-type{margin-bottom:8px}
.glabel{display:block;font:600 11px/1.4 var(--sans);letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:4px}
.gpart p{margin:0 0 7px;font:15px/1.62 var(--serif);color:var(--ink-2);max-width:64ch}
.gpart p:last-child{margin-bottom:0}
.gnot{display:flex;gap:10px;margin-bottom:8px}
.gnot a{font:600 12px/1.9 var(--mono);color:var(--accent);text-decoration:none;flex:0 0 auto}
.gnot a:hover{text-decoration:underline}
.gnot p{font-size:14px}
.gfoot{margin:0;padding-top:8px;border-top:1px solid var(--rule);
  font:11px/1.5 var(--sans);color:var(--ink-3)}
.chip.guidechip{background:transparent;border-color:var(--ink-3);color:var(--ink-3);cursor:default}
.how{margin-top:12px;border-top:1px dashed var(--rule);padding-top:10px}
.how summary{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);cursor:pointer;list-style:none}
.how summary::-webkit-details-marker{display:none}
.how summary::before{content:"▸ ";font-size:9px}
.how[open] summary::before{content:"▾ "}
.how ul{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}
.how li{display:grid;grid-template-columns:104px 1fr;gap:12px;align-items:start}
@media(max-width:620px){.how li{grid-template-columns:1fr;gap:3px}}
.how .ap{font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:var(--accent);background:var(--accent-soft);padding:2px 6px;border-radius:2px;text-align:center;cursor:help}
.how .body{font-size:14.5px;line-height:1.5;color:var(--ink-2);max-width:62ch}
.how .tools{font-family:var(--mono);font-size:11px;color:var(--ink-3);display:block;margin-top:3px}
.how .cav{display:block;margin-top:3px;font-size:13.5px;color:var(--ink-3)}
.how .cav::before{content:"caveat — ";font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.empty{background:var(--surface);border:1px solid var(--rule);padding:34px;text-align:center;font-family:var(--mono);font-size:13px;color:var(--ink-3)}
.matrix{overflow-x:auto;margin:26px 0;border:1px solid var(--rule);background:var(--surface)}
.matrix table{min-width:720px;font-family:var(--mono);font-size:12px}
.matrix th.rot{white-space:nowrap;font-size:9.5px;padding:11px 6px;text-align:center}
.matrix td{text-align:center;padding:7px 6px;font-variant-numeric:tabular-nums}
.matrix td:first-child,.matrix th:first-child{text-align:left;padding-left:14px;white-space:nowrap}
.matrix td:first-child{color:var(--ink);font-weight:600}
.cell{display:inline-block;min-width:22px;padding:2px 0;border-radius:2px}
.cell.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.cell.off{color:var(--ink-3);opacity:.4}
ul.plain{margin:16px 0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:12px;max-width:68ch}
ul.plain li{position:relative;padding-left:26px;color:var(--ink-2);font-size:16px;line-height:1.55}
ul.plain li::before{content:"—";position:absolute;left:0;top:0;color:var(--accent);font-family:var(--mono);font-size:13px;line-height:1.9}
ul.plain li strong{color:var(--ink)}
footer{padding:40px 0 64px;color:var(--ink-3);font-family:var(--mono);font-size:12px;line-height:1.7}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const CLIENT = `
const D = window.__AAC__;
const MECH_LABEL = Object.fromEntries(D.mechanisms.map(m => [m.id, m.name]));
const STAGE_LABEL = Object.fromEntries(D.stages.map(s => [s.id, s.name]));
const ARCH_NAME = Object.fromEntries(D.archetypes.map(a => [a.id, a.name]));
const core = D.cases.filter(c => c.core);
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

document.getElementById("m-arch").textContent = D.archetypes.length;
document.getElementById("m-cases").textContent = D.cases.length;
document.getElementById("m-core").textContent = core.length;
document.getElementById("m-gate").textContent = D.cases.filter(c => c.gate).length;
document.getElementById("m-how").textContent =
  Object.values(D.realizations||{}).reduce((n,e)=>n+e.options.length,0);

document.getElementById("arch-list").innerHTML = D.archetypes.map(a => {
  const n = D.cases.filter(c => !c.core && c.arch.includes(a.id)).length;
  return \`<div class="arch"><div class="aid">\${a.id}</div>
    <div class="abody"><strong>\${esc(a.name)}</strong><p>\${esc(a.summary)}</p>
    <em>\${a.examples.map(esc).join(" · ")}</em></div>
    <div class="acount"><b>\${n}</b>added cases</div></div>\`;
}).join("");

const tabs = document.getElementById("tabs");
tabs.innerHTML = [\`<button role="tab" data-a="ALL" aria-selected="true">All \${D.cases.length}</button>\`,
  \`<button role="tab" data-a="CORE" aria-selected="false">Core · every shape</button>\`]
  .concat(D.archetypes.map(a => \`<button role="tab" data-a="\${a.id}" aria-selected="false">\${a.id} · \${esc(a.name)}</button>\`)).join("");

let sel = "ALL";
const q = document.getElementById("q"), mustonly = document.getElementById("mustonly"),
      gateonly = document.getElementById("gateonly"), howonly = document.getElementById("howonly");
const chip = (cls, txt, title) => \`<span class="chip \${cls}" title="\${esc(title)}">\${esc(txt)}</span>\`;

const APPROACH = Object.fromEntries((D.approaches||[]).map(a => [a.id, a]));
function howHTML(id){
  const entry = (D.realizations||{})[id];
  if (!entry) return "";
  return \`<details class="how"><summary>How to build it — \${entry.options.length} ways</summary><ul>\${
    entry.options.map(o => \`<li>
      <span class="ap" title="\${esc((APPROACH[o.approach]||{}).summary||o.approach)}">\${esc(o.approach)}</span>
      <span class="body">\${esc(o.how)}
        <span class="tools">\${esc(o.tools.join(" · "))} · \${o.mechanism} \${esc(MECH_LABEL[o.mechanism]||"")}</span>
        \${o.caveat ? \`<span class="cav">\${esc(o.caveat)}</span>\` : ""}
      </span></li>\`).join("")
  }</ul></details>\`;
}

// Guidance is collapsed by default and the statement above it is not. The
// normative text has to stay the thing you read first; commentary that pushed it
// down the page would be teaching people to skip it.
function guideHTML(id){
  const g = (D.guidance||{})[id];
  if (!g) return "";
  const para = (s) => s.split(/\\n\\s*\\n/).map(p => \`<p>\${esc(p.trim())}</p>\`).join("");
  const part = (label, body) => body ? \`<div class="gpart"><span class="glabel">\${label}</span><div>\${para(body)}</div></div>\` : "";
  const others = (g.not_this||[]).map(n =>
    \`<div class="gnot"><a href="#\${n.id}">\${n.id}</a><div>\${para(n.why)}</div></div>\`).join("");
  return \`<details class="guide">
    <summary>Explain this one</summary>
    <div class="gbody">
      \${part("In plain words", g.plain)}
      \${part("Why it exists", g.why)}
      \${part("What going wrong looks like", g.example)}
      \${part("How you would know", g.detect)}
      \${others ? \`<div class="gpart"><span class="glabel">What this is <em>not</em></span><div class="gnots">\${others}</div></div>\` : ""}
      <p class="gfoot">Commentary, not the obligation. The statement above is the authority.</p>
    </div></details>\`;
}

function caseHTML(c){
  return \`<article class="case" id="\${c.id}">
    <div class="lhs"><div class="caseline">
      <span class="cid">\${c.id}</span>
      \${c.core ? chip("","core","Owed by every archetype") : c.arch.map(a => chip("", a, ARCH_NAME[a])).join("")}
      <span class="lvl \${c.level}">\${c.level}</span><span class="dim">\${c.dim}</span>
      \${(D.guidance||{})[c.id] ? \`<span class="chip guidechip" title="A plain-language explanation is available below">explained</span>\` : ""}
      \${(D.realizations||{})[c.id] ? \`<span class="chip howchip" title="Concrete build options are listed below">\${(D.realizations)[c.id].options.length} ways to build</span>\` : ""}
      \${c.legacy ? \`<span class="legacy">was \${c.legacy}</span>\` : ""}
    </div>
    <h5>\${esc(c.title)}</h5><p>\${esc(c.text)}</p>\${guideHTML(c.id)}\${howHTML(c.id)}</div>
    <div class="rhs">
      <div class="slot"><span class="sk">Mech</span><span class="chips">\${c.mech.map(m => chip("", m, MECH_LABEL[m])).join("")}</span></div>
      <div class="slot"><span class="sk">Stage</span><span class="chips">\${c.stage.map(s => chip("n", s, STAGE_LABEL[s])).join("")}</span></div>
      <div class="slot"><span class="sk">Tool</span><span class="chips">\${chip("n", c.tool, "Tool class, never a product")}</span></div>
      <div class="slot"><span class="sk">Gate</span><span class="chips">\${c.gate ? chip("gate","Blocks release/request","Failure stops the deploy or the request") : chip("n","Alert only","Raises a signal, does not block")}</span></div>
    </div></article>\`;
}

function render(){
  const term = q.value.trim().toLowerCase();
  const pass = c => {
    if (mustonly.checked && c.level !== "MUST") return false;
    if (gateonly.checked && !c.gate) return false;
    if (howonly.checked && !(D.realizations||{})[c.id]) return false;
    if (term && !(c.id + " " + c.title + " " + c.text + " " + c.dim + " " + c.tool + " " + (c.legacy||"")).toLowerCase().includes(term)) return false;
    return true;
  };
  let out = ""; const seen = new Set();
  const groups = sel === "ALL"
    ? [["CORE", "Core — owed by every shape", core]].concat(D.archetypes.map(a => [a.id, a.name, D.cases.filter(c => !c.core && c.arch.includes(a.id))]))
    : sel === "CORE"
      ? [["CORE", "Core — owed by every shape", core]]
      // The archetype's OWN obligations lead. Putting the 32 inherited core
      // rows first made selecting a shape look like the filter had done
      // nothing, because the top of the list never changed.
      : [[sel, ARCH_NAME[sel], D.cases.filter(c => !c.core && c.arch.includes(sel))],
         ["CORE", "Core — owed by every shape", core]];

  for (const [gid, gname, list0] of groups){
    const list = list0.filter(pass);
    if (!list.length) continue;
    list.forEach(c => seen.add(c.id));
    const inherited = sel !== "ALL" && sel !== "CORE" && gid === "CORE";
    out += \`<div class="grouphdr"><span class="gid">\${gid}</span><h3>\${esc(gname)}</h3>
      <span class="ghint">\${inherited ? "inherited in full by " + sel + " — every shape owes these" : list.length + " case" + (list.length === 1 ? "" : "s")}</span></div>
      <div class="cases">\${list.map(caseHTML).join("")}</div>\`;
  }
  document.getElementById("catalog-out").innerHTML = out || '<div class="empty">No obligations match that filter.</div>';
  const rows = (out.match(/class="case"/g) || []).length;
  document.getElementById("count").textContent =
    seen.size + " obligation" + (seen.size === 1 ? "" : "s") + (rows !== seen.size ? \` · \${rows} rows\` : "");
}

// A link to #AAC-0109 should behave like a page about AAC-0109: find it even if
// the current filter hides it, open its explanation, and put it on screen.
// Without this a shared link lands on whatever the last filter happened to be.
function reveal(){
  const id = decodeURIComponent(location.hash.slice(1));
  if (!/^AAC-\\d{4}$/.test(id)) return;
  const target = document.getElementById(id);
  if (!target){
    // Hidden by a filter rather than absent. Clear the filters and try once.
    if (sel === "ALL" && !q.value && !mustonly.checked && !gateonly.checked && !howonly.checked) return;
    sel = "ALL"; q.value = ""; mustonly.checked = gateonly.checked = howonly.checked = false;
    [...tabs.querySelectorAll("button")].forEach(x =>
      x.setAttribute("aria-selected", x.dataset.a === "ALL" ? "true" : "false"));
    render();
    return reveal();
  }
  const guide = target.querySelector("details.guide");
  if (guide) guide.open = true;
  target.scrollIntoView({block: "start"});
}
window.addEventListener("hashchange", reveal);
reveal();

tabs.addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  sel = b.dataset.a;
  [...tabs.querySelectorAll("button")].forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false"));
  render();
});
// Checkboxes emit both; listening for one only is a coin flip across browsers.
[q, mustonly, gateonly, howonly].forEach(el => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});
render();

// ---- build-options table, filterable by approach ----
const CASEBY = Object.fromEntries(D.cases.map(c => [c.id, c]));
const APS = (D.approaches||[]).map(a => a.id);
let apSel = "ALL";
const apbar = document.getElementById("apbar");
if (apbar) {
  const count = a => Object.values(D.realizations||{}).reduce((n,e)=>n+e.options.filter(o=>a==="ALL"||o.approach===a).length,0);
  apbar.innerHTML = [\`<button data-ap="ALL" aria-pressed="true">All \${count("ALL")}</button>\`]
    .concat(APS.map(a => \`<button data-ap="\${a}" aria-pressed="false">\${esc(a)} · \${count(a)}</button>\`)).join("");
  apbar.addEventListener("click", e => {
    const b = e.target.closest("button[data-ap]"); if (!b) return;
    apSel = b.dataset.ap;
    [...apbar.querySelectorAll("button")].forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    renderBuild();
  });
}
function renderBuild(){
  const el = document.getElementById("buildtbl"); if (!el) return;
  let body = "";
  for (const [id, entry] of Object.entries(D.realizations||{})) {
    const opts = entry.options.filter(o => apSel === "ALL" || o.approach === apSel);
    if (!opts.length) continue;
    const c = CASEBY[id] || {};
    opts.forEach((o, i) => {
      body += \`<tr class="\${i===0?"newcase":""}">
        <td class="cs">\${i===0 ? id + \`<span>\${esc(c.title||"")}</span>\` : ""}</td>
        <td><span class="chip">\${esc(o.approach)}</span></td>
        <td>\${esc(o.how)}<span class="tl">\${esc(o.tools.join(" · "))} · \${o.mechanism} \${esc(MECH_LABEL[o.mechanism]||"")}</span>
          \${o.caveat ? \`<div style="margin-top:5px;font-size:13.5px;color:var(--ink-3)">\${esc(o.caveat)}</div>\` : ""}</td>
      </tr>\`;
    });
  }
  el.innerHTML = \`<table><thead><tr><th style="width:210px">Obligation</th><th style="width:104px">Approach</th><th>What you actually do</th></tr></thead><tbody>\${body}</tbody></table>\`;
}
renderBuild();

const rows = D.archetypes.map(a => [a.id + " " + a.name, D.cases.filter(c => !c.core && c.arch.includes(a.id))]);
rows.push(["CORE (all shapes)", core]);
let mt = \`<table><thead><tr><th>Archetype</th>\${D.dimensions.map(d => \`<th class="rot">\${d}</th>\`).join("")}<th class="rot">total</th></tr></thead><tbody>\`;
for (const [label, list] of rows){
  const counts = D.dimensions.map(d => list.filter(c => c.dim === d).length);
  mt += \`<tr><td>\${esc(label)}</td>\${counts.map(n => \`<td><span class="cell \${n?"on":"off"}">\${n||"·"}</span></td>\`).join("")}<td><span class="cell on">\${list.length}</span></td></tr>\`;
}
document.getElementById("matrix").innerHTML = mt + "</tbody></table>";
`;

const mechRows = real.mechanisms.map((m) => `<tr><td class="k">${m.id}</td><td><strong>${esc(m.name)}</strong></td><td>${esc(m.summary)}</td></tr>`).join("");
const stageRows = real.stages.map((s) => `<tr><td class="k">${s.id}</td><td><strong>${esc(s.name)}</strong></td><td>${esc(s.summary)}</td></tr>`).join("");
const levelRows = real.levels.map((l) => `<tr><td class="k"><span class="lvl ${l.id}">${l.id}</span></td><td>${esc(l.summary)}</td></tr>`).join("");

const html = `<title>AI Assurance Catalog</title>
<style>${CSS}</style>
<header class="mast"><div class="wrap">
  <p class="eyebrow"><span>Working draft ${data.version}</span><span>Generated from catalog/</span><span>CC BY 4.0</span></p>
  <h1>AI Assurance Catalog</h1>
  <p class="standfirst">Test obligations for AI applications, organised by architecture archetype, mapped to the machinery that can discharge them.</p>
  <div class="prose"><p>Governance frameworks say a system must be validated. Threat taxonomies say what can go wrong. Telemetry conventions say how to record a call. Metric libraries say how to score one property. None of them tell an architect, at design review: <em>you are building this shape, therefore you owe these tests.</em> That binding is what this catalog is.</p></div>
  <dl class="meta-grid">
    <div><dt>Archetypes</dt><dd id="m-arch">—</dd></div>
    <div><dt>Obligations</dt><dd id="m-cases">—</dd></div>
    <div><dt>Core (all shapes)</dt><dd id="m-core">—</dd></div>
    <div><dt>Release gates</dt><dd id="m-gate">—</dd></div>
    <div><dt>Build options</dt><dd id="m-how">—</dd></div>
  </dl>
</div></header>
<nav class="toc" aria-label="Sections"><div class="wrap"><ol>
  <li><a href="#scope">Scope</a></li>
  <li><a href="#archetypes">Archetypes</a></li>
  <li><a href="#axes">Realization axes</a></li>
  <li><a href="#catalog">The catalog</a></li>
  <li><a href="#build">How to build it</a></li>
  <li><a href="#patterns">Patterns</a></li>
  <li><a href="#matrix">Coverage matrix</a></li>
  <li><a href="#using">Using it</a></li>
</ol></div></nav>
<main>
<section id="scope"><div class="wrap prose">
  <span class="snum">Section 1 — Scope</span>
  <h2>What this is, and what it refuses to be</h2>
  <p class="lede">A catalog of obligations organised by application shape, each mapped to how it can be physically realised.</p>
  <p>It is not a benchmark, a metric implementation, a control set, or a vendor comparison. It does not tell you what score is good enough — thresholds belong to you, because they depend on your risk appetite and your users. It tells you which questions you are obliged to have an answer to, and which class of machinery can produce that answer.</p>
  <p>Levels follow RFC 2119 usage and bind only within an adopting organisation.</p>
  <div class="tbl-scroll"><table><thead><tr><th style="width:110px">Level</th><th>Meaning</th></tr></thead><tbody>${levelRows}</tbody></table></div>
  <div class="note"><span class="tag">The inheritance rule</span><p>Obligations compose downward. Every archetype owes the <strong>core</strong> block in full, so each archetype section lists only what is <em>new</em> about its risk surface. That is why this is ${data.cases.length} obligations rather than several hundred.</p></div>
  <div class="note"><span class="tag">Identifiers</span><p>Identifiers are flat and permanent — archetype is metadata, never identity, so re-tagging a case never breaks a citation. Draft 0.1's archetype-scoped identifiers are shown as <code>was A6-01</code> for traceability and are not citable.</p></div>
</div></section>

<section id="archetypes"><div class="wrap">
  <div class="prose"><span class="snum">Section 2 — Taxonomy</span>
  <h2>Ten shapes, and the compositions of them</h2>
  <p class="lede">Archetypes are distinguished by who owns control flow and what the output touches — not by domain or sector.</p>
  <p>Those two questions are what actually change the test surface. A legal summariser and a medical summariser owe identical tests; a summariser and a tool-using agent do not. Real systems are usually two or three archetypes composed: classify each component, take the union, then test the seams between them.</p></div>
  <div class="arch-list" id="arch-list"></div>
</div></section>

<section id="axes"><div class="wrap">
  <div class="prose"><span class="snum">Section 3 — Realization axes</span>
  <h2>From English to machinery</h2>
  <p class="lede">Every obligation carries three tags: the mechanism that computes the verdict, the stage where it runs, and whether failure blocks.</p>
  <p>Keeping these orthogonal is the point. The same obligation — <em>output must not leak PII</em> — is a deterministic detector in CI, a blocking gateway filter at runtime, and a sampled model-graded check in production. One sentence, three realizations, different machinery. A catalog that fused them would force you to pick a vendor before you had finished thinking.</p></div>
  <div class="tbl-scroll"><table><thead><tr><th style="width:74px">Code</th><th style="width:190px">Mechanism</th><th>Good for, and where it breaks</th></tr></thead><tbody>${mechRows}</tbody></table></div>
  <div class="tbl-scroll"><table><thead><tr><th style="width:74px">Code</th><th style="width:190px">Stage</th><th>Trigger, budget, and who sees a failure</th></tr></thead><tbody>${stageRows}</tbody></table></div>
  <p class="prose" style="font-size:15.5px;color:var(--ink-2)">Tool classes name a <em>class</em>, never a product. Products date the moment the market moves, and naming one turns a neutral catalog into a recommendation — so the linter fails the build if a product name appears in an obligation.</p>
</div></section>

<section id="catalog"><div class="wrap">
  <div class="prose"><span class="snum">Section 4 — The catalog</span>
  <h2>Obligations, in plain English</h2>
  <p class="lede">Select a shape. Core is always owed; the archetype block is what that shape adds on top.</p></div>
  <div class="controls">
    <div class="tabs" id="tabs" role="tablist" aria-label="Archetype"></div>
    <div class="filterbar">
      <input type="search" id="q" placeholder="Filter by keyword, dimension or identifier…" aria-label="Filter obligations">
      <label><input type="checkbox" id="mustonly"> MUST only</label>
      <label><input type="checkbox" id="gateonly"> Gates only</label>
      <label><input type="checkbox" id="howonly"> Has build options</label>
      <span class="count" id="count"></span>
    </div>
  </div>
  <div id="catalog-out"></div>
</div></section>

<section id="matrix"><div class="wrap">
  <div class="prose"><span class="snum">Section 5 — Coverage matrix</span>
  <h2>Which shapes carry which risks</h2>
  <p class="lede">Archetype deltas only; the core row is listed separately since it would otherwise appear in every column.</p>
  <p>Read this as a design-review heat map. A dense column for your shape is where the test budget belongs. An empty cell for a risk you know you have means the classification is wrong.</p></div>
  <div class="matrix" id="matrix"></div>
</div></section>

${crosswalks.map((cw) => `<section><div class="wrap">
  <div class="prose"><span class="snum">Crosswalk — ${esc(cw.framework)}</span>
  <h2>What an existing framework maps to</h2>
  <p class="lede">Informative. ${cw.mappings.length} entries, mapped to obligations across the archetypes that actually owe them.</p>
  <p>The external framework is organised by <em>threat</em>; this catalog is organised by <em>application shape</em>. The mapping is many-to-many by construction, and that is the point — a single threat lands on several obligations across several archetypes, which is exactly what a threat list on its own cannot tell you.</p>
  <p>Crosswalks release out of band: a revision upstream must never force a version bump in the catalog. <code>relation</code> records how tight each mapping is, because claiming a test obligation is <em>equivalent</em> to a governance control is the fastest way to have a crosswalk dismissed.</p></div>
  <div class="tbl-scroll"><table style="min-width:860px"><thead><tr>
    <th style="width:78px">Entry</th><th style="width:190px">Name</th><th style="width:86px">Relation</th><th>Obligations</th>
  </tr></thead><tbody>
  ${cw.mappings.map((m) => `<tr>
    <td class="k">${esc(m.external)}</td>
    <td><strong>${esc(m.external_name || "")}</strong></td>
    <td><span class="chip n">${esc(m.relation)}</span></td>
    <td><span class="chips" style="margin-bottom:6px">${m.cases.map((c) => `<span class="chip">${c}</span>`).join("")}</span>
      ${m.note ? `<div style="font-size:13.5px;line-height:1.5;color:var(--ink-3)">${esc(m.note.trim())}</div>` : ""}</td>
  </tr>`).join("")}
  </tbody></table></div>
</div></section>`).join("")}

<section id="build"><div class="wrap">
  <div class="prose"><span class="snum">Section 6 — How to build it</span>
  <h2>From the obligation to the thing you actually write</h2>
  <p class="lede">Informative. Every obligation is reachable several ways, at very different cost, effort and lock-in — so each is listed with the trade-off it makes rather than a recommendation.</p>
  <p><strong>Approach</strong> answers <em>who provides the machinery</em>, and is orthogonal to mechanism and stage. Two of the six are worth knowing about before you read the rest: <code>gateway</code> is the only approach that can <em>prevent</em> rather than detect, and the only one that covers calls your application code forgot to route through the wrapper. <code>in-house</code> is chronically under-considered and frequently strongest — several entries below are a dozen lines and beat anything purchasable, because they assert what you meant rather than what a product happens to measure.</p>
  <p><strong>Verify every product claim before relying on it.</strong> These describe the kind of capability a category of product typically offered as of the date on each file. Names, features and pricing change without notice, and some entries are already wrong.</p></div>
  <div class="apbar" id="apbar"></div>
  <div class="tbl-scroll" id="buildtbl"></div>
</div></section>

<section id="patterns"><div class="wrap">
  <div class="prose"><span class="snum">Section 7 — Patterns</span>
  <h2>Why these obligations exist</h2>
  <p class="lede">Informative. ${patterns.length} known failure shapes, each terminating in the obligations that would surface it — or declaring itself a gap.</p>
  <p>A pattern is a diagnosis, not an obligation. Keeping the two apart is what lets a case statement stay short: the pattern carries the war story so the obligation does not have to. Nothing in this section is required for conformance.</p>
  <p>The rule that earns the section: a pattern must terminate in a case identifier or state what is missing. <strong>An uncaught pattern is a hole in the catalog</strong>, not an omission in the pattern — so this doubles as coverage validation, and the linter reports every one of them rather than passing silently.</p></div>
  <div class="tbl-scroll"><table style="min-width:820px"><thead><tr>
    <th style="width:96px">ID</th><th style="width:210px">Pattern</th><th>Symptom</th><th style="width:170px">Caught by</th>
  </tr></thead><tbody>
  ${patterns.map((p) => `<tr>
    <td class="k">${p.id}</td>
    <td><strong>${esc(p.name)}</strong><br><span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${esc(p.domain)} · ${p.archetypes.join(" ")}</span></td>
    <td>${esc(p.symptom.trim())}</td>
    <td>${p.caught_by.length
      ? `<span class="chips">${p.caught_by.map((c) => `<span class="chip">${c}</span>`).join("")}</span>`
      : `<span class="chip gate">gap — no case</span>`}</td>
  </tr>`).join("")}
  </tbody></table></div>
</div></section>

<section id="using"><div class="wrap prose">
  <span class="snum">Section 8 — Using it</span>
  <h2>Turning the catalog into a test plan</h2>
  <ul class="plain">
    <li><strong>Classify.</strong> Decompose the system into archetypes — most are two or three. Write the classification down; it is the assumption everything rests on and the thing most likely to be wrong.</li>
    <li><strong>Take the union.</strong> Core, plus the deltas for each archetype present, plus seam cases for every boundary between them.</li>
    <li><strong>Realize each obligation.</strong> Name the mechanism, the stage, the tool and whether it gates. An obligation with no named tool is not planned, it is aspirational.</li>
    <li><strong>Register what you will not do.</strong> Any MUST you skip becomes an explicit accepted risk with an owner and a review date. An honest gap beats a green dashboard — and under a management-system audit, an identified, owned, dated gap is conformant while an undiscovered one is a finding.</li>
    <li><strong>Bind identifiers into code.</strong> Put the case identifier in the test name and in a span attribute. Once coverage is queryable from your traces, this stops being a document and becomes a control.</li>
    <li><strong>Feed incidents back.</strong> Every production failure becomes a new frozen case tagged to the archetype that produced it.</li>
  </ul>
</div></section>
</main>
<footer><div class="wrap prose">
  <p>AI Assurance Catalog ${data.version} · generated from <code>catalog/</code> — do not edit this page by hand.<br>
  Specification CC BY 4.0 · tooling Apache 2.0 · identifiers are stable and citable from test names and span attributes.</p>
</div></footer>
<script>window.__AAC__ = ${JSON.stringify(data)};</script>
<script>${CLIENT}</script>
`;

/*
 * Every getElementById in the client script must have matching markup. A
 * missing id is not a cosmetic problem: the null deref throws before render()
 * is ever called, so the page renders its headings and no content at all.
 * This has happened once; the check exists so it cannot happen twice.
 */
{
  const wanted = [...CLIENT.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(wanted)].filter((id) => !html.includes(`id="${id}"`));
  if (missing.length) {
    console.error(`render: client script looks up ids with no markup: ${missing.join(", ")}`);
    process.exit(1);
  }
}

fs.mkdirSync(path.join(ROOT, "site"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "site", "index.html"), html);
console.log(`rendered ${data.cases.length} cases -> site/index.html (${(html.length / 1024).toFixed(0)} KB)`);
