#!/usr/bin/env node
/*
 * Catalog linter. Runs in CI on every change.
 *
 * Beyond schema validation this enforces the two disciplines that keep the
 * catalog a join table rather than a framework:
 *
 *   1. Identifiers are permanent. No reuse, no gaps, no renumbering.
 *   2. Normative text names no products. The catalog cites other people's
 *      work; it never restates it and never advertises for anyone.
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv = require("ajv/dist/2020");

const ROOT = path.join(__dirname, "..");
const load = (p) => yaml.load(fs.readFileSync(path.join(ROOT, p), "utf8"));

const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/case.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const arch = load("taxonomy/archetypes.yaml");
const real = load("taxonomy/realization.yaml");
const ARCH_IDS = new Set(arch.archetypes.map((a) => a.id));
const DIMS = new Set(real.dimensions);
const MECH = new Set(real.mechanisms.map((m) => m.id));
const STAGES = new Set(real.stages.map((s) => s.id));

/*
 * Products that must never appear in a case's normative text. Naming a vendor
 * in an obligation turns a neutral catalog into a recommendation, and dates the
 * document the moment the market moves. Products belong only in the informative
 * realization examples, which are versioned separately.
 */
const PRODUCTS = [
  "langsmith", "langfuse", "braintrust", "phoenix", "ragas", "deepeval",
  "promptfoo", "geval", "g-eval", "litellm", "portkey", "helicone", "openai",
  "anthropic", "claude", "gpt-4", "gpt-5", "gemini", "llama", "weave", "vanta",
  "drata", "guardrails ai", "nemo", "lakera", "garak", "pyrit", "langgraph",
  "crewai", "pytest", "vitest", "label studio", "argilla",
];

const files = fs.readdirSync(path.join(ROOT, "catalog")).filter((f) => f.endsWith(".yaml")).sort();
const byId = new Map();

for (const f of files) {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, "catalog", f), "utf8"));

  if (!validate(doc)) {
    for (const e of validate.errors) err(f, `schema ${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (`${doc.id}.yaml` !== f) err(f, `filename does not match id ${doc.id}`);
  if (byId.has(doc.id)) err(f, `duplicate id, also in ${byId.get(doc.id)._file}`);

  if (!DIMS.has(doc.dimension)) err(f, `unknown dimension "${doc.dimension}"`);
  for (const a of doc.archetypes) if (!ARCH_IDS.has(a)) err(f, `unknown archetype "${a}"`);
  for (const m of doc.mechanisms) if (!MECH.has(m)) err(f, `unknown mechanism "${m}"`);
  for (const s of doc.stages) if (!STAGES.has(s)) err(f, `unknown stage "${s}"`);

  // core is a presentational flag over an explicit archetype list; keep them honest
  const isAll = doc.archetypes.length === ARCH_IDS.size;
  if (doc.core && !isAll) err(f, "core: true but does not list every archetype");
  if (!doc.core && isAll) warn(f, "lists every archetype but core is false — intended?");

  // discipline: no vendors in normative text
  const normative = `${doc.title} ${doc.statement}`.toLowerCase();
  for (const p of PRODUCTS) {
    if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normative)) {
      err(f, `product name "${p}" in normative text — cite a mechanism class instead`);
    }
  }

  // an obligation that cannot fail anywhere is not an obligation
  if (doc.gate && doc.stages.every((s) => s === "S5" || s === "S6")) {
    err(f, "gate: true but only runs at S5/S6, which never block");
  }

  doc._file = f;
  byId.set(doc.id, doc);
}

// identifiers are permanent: sequential, no gaps, no reuse
const nums = [...byId.keys()].map((id) => parseInt(id.slice(4), 10)).sort((a, b) => a - b);
nums.forEach((n, i) => {
  if (n !== i + 1) err("catalog", `id sequence breaks at AAC-${String(n).padStart(4, "0")} (expected ${i + 1})`);
});

for (const [id, doc] of byId) {
  for (const s of doc.superseded_by || []) {
    if (!byId.has(s)) err(doc._file, `superseded_by references unknown ${s}`);
  }
}

/*
 * Crosswalks may only reference cases that exist, and must record how tight the
 * mapping is. `relation` exists to stop the failure that discredits a crosswalk
 * fastest: claiming a test obligation is equivalent to a management-system
 * control, when it is at best evidence that a process operated.
 */
const RELATIONS = new Set(["evidence-for", "tests-for", "partial"]);
const cwDir = path.join(ROOT, "crosswalks");
const crosswalks = [];
if (fs.existsSync(cwDir)) {
  for (const f of fs.readdirSync(cwDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const rel = `crosswalks/${f}`;
    const cw = yaml.load(fs.readFileSync(path.join(cwDir, f), "utf8"));
    if (!cw.framework) { err(rel, "missing framework"); continue; }
    const mapped = new Set();
    for (const m of cw.mappings || []) {
      if (!m.external) err(rel, "mapping missing external identifier");
      if (!RELATIONS.has(m.relation)) {
        err(rel, `${m.external}: relation must be one of ${[...RELATIONS].join(", ")}`);
      }
      if (!(m.cases || []).length) err(rel, `${m.external}: no cases mapped`);
      for (const c of m.cases || []) {
        if (!byId.has(c)) err(rel, `${m.external} references unknown case ${c}`);
        else mapped.add(c);
      }
    }
    crosswalks.push({ framework: cw.framework, entries: (cw.mappings || []).length, mapped: mapped.size });
  }
}

/*
 * Patterns are informative, but they are held to one hard rule: a pattern must
 * terminate in a case identifier or declare itself a gap. That is what makes
 * patterns/ coverage validation for the catalog rather than free commentary.
 */
const patternSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/pattern.schema.json"), "utf8"));
const validatePattern = ajv.compile(patternSchema);
const patterns = new Map();
const gaps = [];
const patDir = path.join(ROOT, "patterns");

if (fs.existsSync(patDir)) {
  for (const f of fs.readdirSync(patDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const rel = `patterns/${f}`;
    const doc = yaml.load(fs.readFileSync(path.join(patDir, f), "utf8"));
    if (!validatePattern(doc)) {
      for (const e of validatePattern.errors) err(rel, `schema ${e.instancePath || "/"} ${e.message}`);
      continue;
    }
    for (const p of doc.patterns) {
      if (patterns.has(p.id)) err(rel, `duplicate pattern id ${p.id}`);
      patterns.set(p.id, { ...p, _file: rel });
      for (const a of p.archetypes) if (!ARCH_IDS.has(a)) err(rel, `${p.id} unknown archetype "${a}"`);
      for (const c of p.caught_by) if (!byId.has(c)) err(rel, `${p.id} caught_by references unknown ${c}`);
      if (!p.caught_by.length) gaps.push({ id: p.id, name: p.name, file: rel });
    }
  }
  const pnums = [...patterns.keys()].map((id) => parseInt(id.slice(5), 10)).sort((a, b) => a - b);
  pnums.forEach((n, i) => {
    if (n !== i + 1) err("patterns", `id sequence breaks at AACP-${String(n).padStart(4, "0")} (expected ${i + 1})`);
  });
}

/*
 * Realizations are informative and may name products — the only layer that may.
 * They are still held to two rules: every case they describe must exist, and
 * every option must state which mechanism it realizes, so the concrete layer
 * stays tied to the spec rather than drifting into a tool directory.
 */
const realSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/realization.schema.json"), "utf8"));
const validateReal = ajv.compile(realSchema);
let realCases = 0, realOptions = 0;
const realDir = path.join(ROOT, "realizations");
if (fs.existsSync(realDir)) {
  for (const f of fs.readdirSync(realDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const rel = `realizations/${f}`;
    const doc = yaml.load(fs.readFileSync(path.join(realDir, f), "utf8"));
    if (!validateReal(doc)) {
      for (const e of validateReal.errors) err(rel, `schema ${e.instancePath || "/"} ${e.message}`);
      continue;
    }
    for (const [id, entry] of Object.entries(doc.cases)) {
      if (!byId.has(id)) { err(rel, `describes unknown case ${id}`); continue; }
      realCases += 1;
      realOptions += entry.options.length;
      for (const o of entry.options) if (!MECH.has(o.mechanism)) err(rel, `${id}: unknown mechanism ${o.mechanism}`);
      // Listing one way to build something is a recommendation by omission.
      if (entry.options.length < 2) warn(rel, `${id} lists a single option — is there really only one way?`);
    }
  }
}

// ---- report ----
// ---- guidance: commentary must point at something, and only at fields it owns.
//
// A file named for an id that does not exist renders nowhere and reports
// nothing — it is a check that can never fire, which is the failure mode this
// catalog keeps finding elsewhere. Cheap to refuse, so refuse it.
const GUIDE_FIELDS = new Set(["id", "plain", "why", "example", "detect", "not_this"]);
const guideDir = path.join(ROOT, "guidance");
let guided = 0;
if (fs.existsSync(guideDir)) {
  for (const f of fs.readdirSync(guideDir).filter((x) => x.endsWith(".yaml")).sort()) {
    const g = yaml.load(fs.readFileSync(path.join(guideDir, f), "utf8"));
    if (!g || !g.id) { errors.push(`guidance/${f} has no id`); continue; }
    if (g.id !== f.replace(/\.yaml$/, "")) errors.push(`guidance/${f} declares ${g.id}`);
    if (!byId.has(g.id)) { errors.push(`guidance/${f} explains ${g.id}, which is not in the catalog`); continue; }
    for (const k of Object.keys(g)) {
      if (!GUIDE_FIELDS.has(k)) errors.push(`guidance/${f}: unknown field ${k}`);
    }
    // Guidance may cite a neighbour, never invent one.
    for (const n of g.not_this || []) {
      if (!byId.has(n.id)) errors.push(`guidance/${f}: not_this cites ${n.id}, which does not exist`);
    }
    // The one substantive rule: commentary must not carry normative text. A
    // `statement` here would be a second authority that can disagree with the
    // catalog, which is the whole thing guidance/ is arranged to prevent.
    if ("statement" in g) errors.push(`guidance/${f} carries a statement — the catalog owns that`);
    guided += 1;
  }
}

const gates = [...byId.values()].filter((d) => d.gate).length;
const musts = [...byId.values()].filter((d) => d.level === "MUST").length;
const core = [...byId.values()].filter((d) => d.core).length;

console.log(`catalog: ${byId.size} cases  (${core} core, ${musts} MUST, ${gates} gates)`);
if (guided) console.log(`guidance: ${guided} explained, ${byId.size - guided} not yet`);
if (patterns.size) {
  console.log(`patterns: ${patterns.size} informative`);
  // Surfaced, never silent: an uncaught pattern is a hole in the catalog.
  for (const g of gaps) console.log(`  GAP   ${g.id} "${g.name}" — no obligation catches this (${g.file})`);
}
if (realCases) console.log(`realizations: ${realCases} cases, ${realOptions} concrete options`);
for (const c of crosswalks) {
  console.log(`crosswalk ${c.framework}: ${c.entries} entries -> ${c.mapped} cases`);
}
for (const w of warnings) console.log(`  warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`  ERROR ${e}`);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log("ok");
