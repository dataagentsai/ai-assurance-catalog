#!/usr/bin/env node
/*
 * Validates a coverage report against the schema and against the catalog.
 *
 * Horizontal code: this checks a document's shape and internal consistency. It
 * does not run tests, score anything, or decide whether a system is acceptable.
 * That judgement belongs to the release owner. See docs/NON-GOALS.md.
 *
 *   npm run validate-report -- path/to/report.json
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { owed } = require("./owed");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const ROOT = path.join(__dirname, "..");
const file = process.argv[2];
if (!file) { console.error("usage: validate-report.js <report.json>"); process.exit(2); }

const report = JSON.parse(fs.readFileSync(file, "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/coverage-report.schema.json"), "utf8"));
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));

const errors = [];
if (!ajv.validate(schema, report)) {
  for (const e of ajv.errors) errors.push(`schema ${e.instancePath || "/"} ${e.message}`);
}

// ---- resolve against the catalog ----
const cases = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "catalog")).filter((x) => x.endsWith(".yaml"))) {
  const c = yaml.load(fs.readFileSync(path.join(ROOT, "catalog", f), "utf8"));
  cases.set(c.id, c);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (report.catalog_version && report.catalog_version !== pkg.version) {
  console.log(`note: report claims catalog ${report.catalog_version}, this checkout is ${pkg.version}`);
}

// Owed by archetype, or by a mechanism the report's own evidence used — the
// same rule build-report applies (tools/owed.js).
const evidence = (report.results || [])
  .filter((r) => r.status === "covered")
  .map((r) => ({ case: r.case, mechanisms: r.mechanisms }));
const owing = owed(cases, report.subject?.archetypes, evidence);

const seen = new Set();
for (const r of report.results || []) {
  const c = cases.get(r.case);
  if (!c) { errors.push(`${r.case}: not in catalog`); continue; }
  if (seen.has(r.case)) errors.push(`${r.case}: duplicate result`);
  seen.add(r.case);
  if (c.status !== "active") console.log(`note: ${r.case} is ${c.status} in the catalog`);
  // An obligation the subject does not owe should be omitted, not reported.
  if (!owing.has(r.case)) errors.push(`${r.case}: not owed by archetypes ${(report.subject?.archetypes || []).join(",")} or by any mechanism its evidence used`);
}

/*
 * Silence is not an answer: every applicable obligation needs a row, including
 * the ones nobody has got to yet. Missing rows are the difference between a
 * claim and a selection.
 */
const applicable = [...owing.keys()].map((id) => cases.get(id));
const missing = applicable.filter((c) => !seen.has(c.id));
for (const m of missing) errors.push(`${m.id} applicable but absent — use status "not-covered" to say so`);

// ---- recompute the summary; a report may not claim what its rows do not support ----
const by = (s) => (report.results || []).filter((r) => r.status === s).length;
const computed = {
  applicable: applicable.length,
  covered: by("covered"),
  not_covered: by("not-covered"),
  accepted_risk: by("accepted-risk"),
  not_applicable: by("not-applicable"),
  failing: (report.results || []).filter((r) => r.status === "covered" && r.outcome === "fail").length,
  uncovered_musts: (report.results || []).filter(
    (r) => cases.get(r.case)?.level === "MUST" && r.status === "not-covered"
  ).length,
  uncovered_gates: (report.results || []).filter(
    (r) => cases.get(r.case)?.gate && r.status === "not-covered"
  ).length,
};
for (const [k, v] of Object.entries(report.summary || {})) {
  if (computed[k] !== v) errors.push(`summary.${k} claims ${v}, results give ${computed[k]}`);
}

// ---- report ----
const s = report.subject || {};
console.log(`${s.name || "?"} ${s.version || ""}  [${(s.archetypes || []).join(" ")}]  catalog ${report.catalog_version}`);
console.log(`  applicable      ${computed.applicable}`);
console.log(`  covered         ${computed.covered}${computed.failing ? `  (${computed.failing} failing)` : ""}`);
console.log(`  accepted risk   ${computed.accepted_risk}`);
console.log(`  not applicable  ${computed.not_applicable}`);
console.log(`  not covered     ${computed.not_covered}`);
if (computed.uncovered_musts) console.log(`  uncovered MUSTs ${computed.uncovered_musts}`);
if (computed.uncovered_gates) console.log(`  uncovered gates ${computed.uncovered_gates}`);

if (errors.length) {
  for (const e of errors) console.error(`  ERROR ${e}`);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
/*
 * Deliberately exits 0 with uncovered MUSTs present. Whether a claim is good
 * enough to ship is the release owner's decision, not this tool's — the tool's
 * job is to make the numbers true and legible.
 */
console.log("\nvalid");
