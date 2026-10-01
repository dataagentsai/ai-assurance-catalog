const test = require("node:test");
const assert = require("node:assert");
const { owed } = require("./owed");

// A small catalog: one A6 case, the four judge cases (A10), one A10 router case,
// and one retired judge case that must never be owed.
const cases = new Map(
  [
    { id: "AAC-0001", status: "active", archetypes: ["A6"] },
    { id: "AAC-0084", status: "active", archetypes: ["A10"] },
    { id: "AAC-0085", status: "active", archetypes: ["A10"] },
    { id: "AAC-0086", status: "active", archetypes: ["A10"] },
    { id: "AAC-0089", status: "active", archetypes: ["A10"] },
    { id: "AAC-0090", status: "active", archetypes: ["A10"] },
  ].map((c) => [c.id, c])
);
const JUDGE = ["AAC-0084", "AAC-0085", "AAC-0086", "AAC-0090"];

const cases_ = [
  {
    name: "archetype alone, deterministic evidence: nothing extra",
    archetypes: ["A6"],
    evidence: [{ case: "AAC-0001", mechanisms: ["M1"] }],
    want: ["AAC-0001"],
    byMechanism: [],
  },
  {
    name: "a rubric-graded check brings the judge cases, not the router case",
    archetypes: ["A6"],
    evidence: [{ case: "AAC-0001", mechanisms: ["M3"] }],
    want: ["AAC-0001", ...JUDGE],
    byMechanism: JUDGE,
  },
  {
    name: "reference-based grading is still a judge",
    archetypes: ["A6"],
    evidence: [{ case: "AAC-0001", mechanisms: ["M4"] }],
    want: ["AAC-0001", ...JUDGE],
    byMechanism: JUDGE,
  },
  {
    name: "a subject that declared A10 owes them by archetype, with no mechanism note",
    archetypes: ["A6", "A10"],
    evidence: [{ case: "AAC-0001", mechanisms: ["M3"] }],
    want: ["AAC-0001", ...JUDGE, "AAC-0089"],
    byMechanism: [],
  },
  {
    name: "evidence for a case the subject does not owe pulls nothing in",
    archetypes: ["A6"],
    evidence: [{ case: "AAC-0999", mechanisms: ["M3"] }],
    want: ["AAC-0001"],
    byMechanism: [],
  },
  {
    name: "no evidence at all: archetype cases only",
    archetypes: ["A6"],
    evidence: [],
    want: ["AAC-0001"],
    byMechanism: [],
  },
];

for (const c of cases_) {
  test(c.name, () => {
    const got = owed(cases, c.archetypes, c.evidence);
    assert.deepStrictEqual([...got.keys()].sort(), [...c.want].sort());
    const notes = [...got].filter(([, why]) => why).map(([id]) => id).sort();
    assert.deepStrictEqual(notes, [...c.byMechanism].sort());
  });
}
