#!/usr/bin/env node
/*
 * Builds a coverage report from adapter output plus declarations.
 *
 *   npm run build-report -- aac.config.yaml [-o report.json]
 *
 * Horizontal code: reads other tools' output, merges it, emits the report
 * format. Runs nothing, scores nothing, judges nothing.
 *
 * The rule this file exists to enforce: every applicable obligation gets a row.
 * Anything with no adapter evidence and no declaration becomes "not-covered"
 * automatically, so a blind spot cannot be hidden by omitting it — which is the
 * only way a coverage number means anything.
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { owed } = require("./owed");

const ROOT = path.join(__dirname, "..");
const ADAPTERS = {
  junit: require("../adapters/junit"),
  promptfoo: require("../adapters/promptfoo"),
  deepeval: require("../adapters/deepeval"),
  langfuse: require("../adapters/langfuse"),
};

const args = process.argv.slice(2);
const cfgPath = args.find((a) => !a.startsWith("-"));
const outIdx = args.indexOf("-o");
const outPath = outIdx > -1 ? args[outIdx + 1] : null;
if (!cfgPath) { console.error("usage: build-report.js <aac.config.yaml> [-o report.json]"); process.exit(2); }

const cfgDir = path.dirname(path.resolve(cfgPath));
const cfg = yaml.load(fs.readFileSync(cfgPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// ---- catalog ----
const cases = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "catalog")).filter((x) => x.endsWith(".yaml"))) {
  const c = yaml.load(fs.readFileSync(path.join(ROOT, "catalog", f), "utf8"));
  cases.set(c.id, c);
}
const owned = new Set(cfg.subject.archetypes);

// ---- adapters ----
const collected = new Map();
const warn = [];
for (const src of cfg.sources || []) {
  const adapter = ADAPTERS[src.adapter];
  if (!adapter) { console.error(`unknown adapter "${src.adapter}"`); process.exit(2); }
  const file = path.resolve(cfgDir, src.path);
  if (!fs.existsSync(file)) {
    // A missing source is reported, never silently treated as zero coverage.
    warn.push(`source ${src.adapter} not found at ${src.path} — its obligations will read as not-covered`);
    continue;
  }
  const raw = fs.readFileSync(file, "utf8");
  // A mapping file lets a suite that cannot be annotated yet still make a
  // claim. Weaker evidence than an in-band marker, so misses are reported.
  const opts = { ...src };
  if (src.map) opts.mapping = yaml.load(fs.readFileSync(path.resolve(cfgDir, src.map), "utf8"));
  for (const r of adapter.extract(raw, opts)) {
    if (!collected.has(r.case)) collected.set(r.case, []);
    collected.get(r.case).push(r);
  }
  for (const w of adapter.extract.warnings || []) warn.push(`${src.adapter}: ${w}`);
}

// ---- what is owed: by archetype, and by the mechanisms the evidence used ----
// A check graded by a model means the system contains a judge, and the judge
// owes what its mechanism owes (taxonomy/realization.yaml), whether or not the
// subject declared A10. Read from the evidence, as validate-report reads it.
const evidence = [...collected.values()].flat().filter((r) => r.ran !== false);
const owing = owed(cases, cfg.subject.archetypes, evidence);
const applicable = [...owing.keys()].sort();
const owedNote = (id) => owing.get(id) || null;

// ---- declarations: accepted risk, not-applicable, manual coverage ----
const declared = new Map((cfg.declarations || []).map((d) => [d.case, d]));

// ---- merge ----
const RANK = { error: 3, fail: 2, unknown: 1, pass: 0 };
const results = [];
for (const id of applicable) {
  const d = declared.get(id);
  const all = collected.get(id) || [];
  // A check that exists but did not run (a skipped test) is not coverage.
  // It is named in the not-covered row, so the gap reads as "skipped", not
  // as "nobody thought of it".
  const hits = all.filter((h) => h.ran !== false);
  const idle = all.filter((h) => h.ran === false).flatMap((h) => h.evidence.map((e) => e.ref));

  if (d && d.status !== "covered") {
    results.push({ case: id, ...d });
    continue;
  }
  if (!hits.length) {
    // Silence is not an answer.
    const why = [owedNote(id), idle.length ? `check exists but did not run: ${idle.join(", ")}` : null].filter(Boolean);
    results.push(d ? { case: id, ...d }
      : { case: id, status: "not-covered", ...(why.length ? { note: why.join(" | ").slice(0, 500) } : {}) });
    continue;
  }
  // Worst outcome wins: one failing check makes the obligation failing.
  const outcome = hits.reduce((a, h) => (RANK[h.outcome] > RANK[a] ? h.outcome : a), "pass");
  const notes = [owedNote(id), ...hits.filter((h) => h.note).map((h) => h.note)].filter(Boolean);
  results.push({
    case: id,
    status: "covered",
    outcome,
    mechanisms: [...new Set(hits.flatMap((h) => h.mechanisms))],
    stages: [...new Set(hits.flatMap((h) => h.stages))],
    evidence: hits.flatMap((h) => h.evidence),
    ...(notes.length ? { note: notes.join(" | ").slice(0, 500) } : {}),
    ...(d && d.owner ? { owner: d.owner } : {}),
  });
}

// Declarations for obligations the subject does not owe are a classification
// error worth surfacing — usually the archetype list is wrong.
for (const id of declared.keys()) {
  if (!applicable.includes(id)) warn.push(`declaration for ${id} which is not applicable to ${[...owned].join(",")}`);
}

const by = (s) => results.filter((r) => r.status === s).length;
const report = {
  report_version: "1.0",
  catalog_version: cfg.catalog_version || pkg.version,
  generated_at: cfg.generated_at || new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  ...(cfg.profile ? { profile: cfg.profile } : {}),
  subject: cfg.subject,
  results,
  summary: {
    applicable: results.length,
    covered: by("covered"),
    not_covered: by("not-covered"),
    accepted_risk: by("accepted-risk"),
    not_applicable: by("not-applicable"),
    failing: results.filter((r) => r.status === "covered" && r.outcome === "fail").length,
    uncovered_musts: results.filter((r) => cases.get(r.case).level === "MUST" && r.status === "not-covered").length,
    uncovered_gates: results.filter((r) => cases.get(r.case).gate && r.status === "not-covered").length,
  },
};

const json = JSON.stringify(report, null, 2) + "\n";
if (outPath) fs.writeFileSync(path.resolve(cfgDir, outPath), json);
else process.stdout.write(json);

for (const w of warn) console.error(`  warn  ${w}`);
console.error(
  `${report.subject.name} ${report.subject.version} [${report.subject.archetypes.join(" ")}] — ` +
  `${report.summary.covered}/${report.summary.applicable} covered, ` +
  `${report.summary.failing} failing, ${report.summary.not_covered} not covered`
);
