// Which obligations a subject owes — one rule, read by build-report and
// validate-report alike, so the report and its check cannot disagree.
//
// Two ways to owe a case:
//   - by archetype: the case names an archetype the subject declared;
//   - by mechanism: evidence in the report was produced by a mechanism whose
//     `owes` in taxonomy/realization.yaml names the case. A system that grades
//     with a model contains a judge, and the judge owes what the judge owes,
//     whether or not the subject declared A10.
//
// The mechanism rule reads the report's own evidence, never the adopter's
// config, so a validator holding only the report reaches the same answer.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");

function mechanismOwes() {
  const real = yaml.load(fs.readFileSync(path.join(ROOT, "taxonomy", "realization.yaml"), "utf8"));
  return new Map(real.mechanisms.map((m) => [m.id, m.owes || []]));
}

/**
 * @param cases       Map of case id -> case document
 * @param archetypes  the subject's declared archetypes
 * @param evidence    [{case, mechanisms}] for checks that ran
 * @returns Map of owed case id -> reason string, or null when owed by archetype
 */
function owed(cases, archetypes, evidence) {
  const declared = new Set(archetypes || []);
  const out = new Map();
  for (const c of cases.values()) {
    if (c.status === "active" && c.archetypes.some((a) => declared.has(a))) out.set(c.id, null);
  }
  const owes = mechanismOwes();
  const why = new Map();
  for (const e of evidence) {
    if (!out.has(e.case) || out.get(e.case) !== null) continue; // only evidence for an archetype-owed case
    for (const m of e.mechanisms || []) {
      for (const id of owes.get(m) || []) {
        if (out.get(id) === null || cases.get(id)?.status !== "active") continue;
        if (!why.has(id)) why.set(id, new Set());
        why.get(id).add(m);
      }
    }
  }
  for (const [id, ms] of why) {
    out.set(id, `owed by mechanism, not archetype: evidence here is graded by ${[...ms].sort().join(", ")}`);
  }
  return out;
}

module.exports = { owed };
