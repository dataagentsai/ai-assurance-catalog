/*
 * Langfuse adapter: one row per behaviour, each a scores export as the public
 * API answers it and the partial results the adapter must translate it into.
 * The example report covers the happy path end to end; this table pins the
 * edges — both API versions, declaration order, verdict rules, skips,
 * aggregation and the warnings that keep a partial export from reading as
 * the whole history.
 *
 *   node --test adapters/langfuse.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { extract } = require("./langfuse");

let n = 0;
// A v3 score (Langfuse v4): value typed by dataType, entity under `subject`.
const v3 = (name, dataType, value, extra = {}) => ({
  id: `s${++n}`, projectId: "p", name, source: "EVAL", dataType, value,
  timestamp: "2026-09-01T10:00:00.000Z", environment: "production",
  comment: null, configId: null, metadata: {}, subject: { kind: "trace", id: `t${n}` }, ...extra,
});
// A v2 score (Langfuse v3): numeric value, stringValue beside it, traceId on top.
const v2 = (name, dataType, value, stringValue, extra = {}) => ({
  id: `s${++n}`, name, source: "API", dataType, value, ...(stringValue ? { stringValue } : {}),
  traceId: `t${n}`, observationId: null, timestamp: "2026-09-01T10:00:00.000Z",
  comment: null, configId: null, metadata: {}, ...extra,
});
const page = (data, meta = { limit: 50 }) => ({ data, meta });
const aac = (id, more = {}) => ({ metadata: { aac: id, ...more } });
const M = { mechanisms: ["M3"] };

// Only the fields a case turns on; the rest is checked once, below.
const brief = (r) => ({ case: r.case, outcome: r.outcome, ...(r.ran === false ? { ran: false } : {}) });

const CASES = [
  // --- declaration ---
  {
    name: "metadata.aac declares the obligation",
    input: page([v3("faithful", "BOOLEAN", true, aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "metadata.aac as a list declares several",
    input: page([v3("faithful", "BOOLEAN", true, aac(["AAC-0029", "AAC-0030"]))]),
    want: [{ case: "AAC-0029", outcome: "pass" }, { case: "AAC-0030", outcome: "pass" }],
  },
  {
    name: "an identifier in the score name",
    input: page([v3("AAC-0031 abstains when unsupported", "BOOLEAN", true)]),
    want: [{ case: "AAC-0031", outcome: "pass" }],
  },
  {
    name: "metadata.aac wins over an identifier in the name",
    input: page([v3("AAC-0031 abstains", "BOOLEAN", true, aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "a mapping file names the score exactly",
    input: page([v3("watch.W-01", "BOOLEAN", false), v3("watch.W-010", "BOOLEAN", false)]),
    opts: { mapping: { "AAC-0028": ["watch.W-01"] } },
    want: [{ case: "AAC-0028", outcome: "fail" }],
  },
  {
    name: "no identifier anywhere: ignored, not guessed",
    input: page([v3("tone", "BOOLEAN", true)]),
    want: [],
  },

  // --- verdict ---
  {
    name: "v2 BOOLEAN: 0 is false, a fail",
    input: page([v2("faithful", "BOOLEAN", 0, "False", aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "v2 BOOLEAN read from stringValue when value is absent",
    input: page([v2("faithful", "BOOLEAN", undefined, "True", aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "a name asserting a defect, inverted by metadata aac.pass",
    input: page([v3("hallucination", "BOOLEAN", true, aac("AAC-0029", { "aac.pass": false }))]),
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "a name asserting a defect, inverted by the source's `inverted`",
    input: page([v3("hallucination", "BOOLEAN", false, aac("AAC-0029"))]),
    opts: { inverted: ["hallucination"] },
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    // 0.12 might be a failure under someone's threshold. Not ours to pick.
    name: "NUMERIC has no verdict: unknown whatever the number",
    input: page([v3("faithfulness", "NUMERIC", 0.12, aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "CATEGORICAL has no verdict, even a category that reads like one",
    input: page([v3("grade", "CATEGORICAL", "incorrect", aac("AAC-0029"))]),
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "the writer's aac.outcome is the verdict, whatever the type",
    input: page([v3("faithfulness", "NUMERIC", 0.12, aac("AAC-0029", { "aac.outcome": "fail" }))]),
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "aac.outcome error is an error",
    input: page([v3("faithful", "BOOLEAN", true, aac("AAC-0029", { "aac.outcome": "error" }))]),
    want: [{ case: "AAC-0029", outcome: "error" }],
  },
  {
    name: "aac.outcome skipped is not coverage",
    input: page([v3("faithful", "BOOLEAN", true, aac("AAC-0029", { "aac.outcome": "skipped" }))]),
    want: [{ case: "AAC-0029", outcome: "unknown", ran: false }],
  },
  {
    name: "a skip beside scores that ran does not decide the outcome",
    input: page([
      v3("faithful", "BOOLEAN", true, aac("AAC-0029")),
      v3("faithful", "BOOLEAN", true, aac("AAC-0029", { "aac.outcome": "skipped" })),
    ]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },

  // --- aggregation ---
  {
    name: "many scores fold into one result: worst outcome wins",
    input: page([
      v3("faithful", "BOOLEAN", true, aac("AAC-0029")),
      v3("faithful", "BOOLEAN", false, aac("AAC-0029")),
      v3("faithful", "BOOLEAN", true, aac("AAC-0029")),
    ]),
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "different mechanisms stay apart for the merge to combine",
    input: page([
      v3("faithful", "BOOLEAN", true, aac("AAC-0029")),
      v3("reviewed", "BOOLEAN", true, { source: "ANNOTATION", ...aac("AAC-0029") }),
    ]),
    opts: { mechanisms: { EVAL: ["M3"], ANNOTATION: ["M6"] } },
    want: [{ case: "AAC-0029", outcome: "pass" }, { case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "the same score id twice (overlapping pages) counts once",
    input: [page([v3("faithful", "BOOLEAN", true, { id: "dup", ...aac("AAC-0029") })]),
      page([v3("faithful", "BOOLEAN", false, { id: "dup", ...aac("AAC-0029") })])],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },

  // --- envelopes ---
  {
    name: "an array of saved pages",
    input: [page([v3("a", "BOOLEAN", true, aac("AAC-0001"))]), page([v3("b", "BOOLEAN", true, aac("AAC-0002"))])],
    want: [{ case: "AAC-0001", outcome: "pass" }, { case: "AAC-0002", outcome: "pass" }],
  },
  {
    name: "a bare array of scores",
    input: [v3("a", "BOOLEAN", true, aac("AAC-0001"))],
    want: [{ case: "AAC-0001", outcome: "pass" }],
  },
  {
    name: "resultsPath overrides the search",
    input: { odd: { nesting: [v3("a", "BOOLEAN", true, aac("AAC-0001"))] } },
    opts: { resultsPath: "odd.nesting" },
    want: [{ case: "AAC-0001", outcome: "pass" }],
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const got = extract(JSON.stringify(c.input), { ...M, ...(c.opts || {}) }).map(brief);
    assert.deepEqual(got, c.want);
  });
}

/* Where a mechanism and stage come from — never from Langfuse's `source` alone. */
const PROVENANCE = [
  {
    name: "a list applies to every source",
    score: v3("a", "BOOLEAN", true, aac("AAC-0001")),
    opts: { mechanisms: ["M5"] },
    want: { mechanisms: ["M5"], stages: ["S5"] },
  },
  {
    name: "a map is keyed by Langfuse source",
    score: v3("a", "BOOLEAN", true, { source: "ANNOTATION", ...aac("AAC-0001") }),
    opts: { mechanisms: { EVAL: ["M3"], ANNOTATION: ["M6"] } },
    want: { mechanisms: ["M6"], stages: ["S5"] },
  },
  {
    name: "metadata aac.mechanism and aac.stage win",
    score: v3("a", "BOOLEAN", true, aac("AAC-0001", { "aac.mechanism": "M2 M5", "aac.stage": "S6" })),
    opts: { mechanisms: ["M3"], stages: ["S5"] },
    want: { mechanisms: ["M2", "M5"], stages: ["S6"] },
  },
  {
    name: "a score on an experiment defaults to S3",
    score: v3("a", "BOOLEAN", true, { subject: { kind: "experiment", id: "run-1" }, ...aac("AAC-0001") }),
    opts: { mechanisms: ["M3"] },
    want: { mechanisms: ["M3"], stages: ["S3"] },
  },
  {
    name: "a v2 score with a datasetRunId is an experiment too",
    score: v2("a", "BOOLEAN", 1, "True", { datasetRunId: "run-1", ...aac("AAC-0001") }),
    opts: { mechanisms: ["M3"] },
    want: { mechanisms: ["M3"], stages: ["S3"] },
  },
];

for (const c of PROVENANCE) {
  test(`provenance: ${c.name}`, () => {
    const [r] = extract(page([c.score]), c.opts);
    assert.deepEqual({ mechanisms: r.mechanisms, stages: r.stages }, c.want);
  });
}

/* What the adapter reports instead of passing over silently. */
const WARNINGS = [
  {
    name: "a file with no scores",
    input: { something: "else" },
    want: [/no Langfuse scores found/],
  },
  {
    name: "a v2 export that stopped before the last page",
    input: page([v2("a", "BOOLEAN", 1, "True", aac("AAC-0001"))], { page: 1, limit: 50, totalItems: 120, totalPages: 3 }),
    want: [/page 1 of 3/],
  },
  {
    name: "a v3 export whose last page still has a cursor",
    input: page([v3("a", "BOOLEAN", true, aac("AAC-0001"))], { limit: 50, cursor: "eyJ..." }),
    want: [/cursor/],
  },
  {
    name: "a v3 export without fields=details carries no metadata",
    input: page([(({ metadata, comment, ...rest }) => rest)(v3("a", "BOOLEAN", true))]),
    want: [/fields=details/],
  },
  {
    name: "a declared score with no mechanism is dropped, loudly",
    input: page([v3("a", "BOOLEAN", true, aac("AAC-0001"))]),
    opts: { mechanisms: undefined },
    want: [/no mechanism/],
  },
  {
    name: "a source with no mapped mechanism for this Langfuse source",
    input: page([v3("a", "BOOLEAN", true, { source: "API", ...aac("AAC-0001") })]),
    opts: { mechanisms: { EVAL: ["M3"] } },
    want: [/no mechanism/],
  },
  {
    name: "a mapping entry that matches no score",
    input: page([v3("watch.W-01", "BOOLEAN", false)]),
    opts: { mapping: { "AAC-0028": ["watch.W-01", "watch.W-99"] } },
    want: [/not in the export: watch.W-99/],
  },
  {
    name: "a complete, declared export warns about nothing",
    input: page([v3("a", "BOOLEAN", true, aac("AAC-0001"))]),
    want: [],
  },
];

for (const c of WARNINGS) {
  test(`warns: ${c.name}`, () => {
    extract(c.input, { ...M, ...(c.opts || {}) });
    assert.equal(extract.warnings.length, c.want.length, extract.warnings.join("\n"));
    c.want.forEach((re, i) => assert.match(extract.warnings[i], re));
  });
}

test("evidence is bounded, failing scores first, with the totals in the note", () => {
  const scores = [
    ...Array.from({ length: 6 }, () => v3("faithful", "BOOLEAN", true, aac("AAC-0029"))),
    v3("faithful", "BOOLEAN", false, { comment: "cites a page that does not say it", ...aac("AAC-0029") }),
  ];
  const [r] = extract(page(scores), { mechanisms: ["M3"], maxRefs: 3, url: "https://lf.example/project/p/" });
  assert.equal(r.outcome, "fail");
  assert.equal(r.evidence.length, 3);
  assert.deepEqual(r.evidence[0], {
    type: "experiment",
    ref: `faithful @ trace:${scores[6].subject.id}`,
    url: `https://lf.example/project/p/traces/${scores[6].subject.id}`,
    at: "2026-09-01T10:00:00Z",
  });
  assert.equal(r.note, "langfuse faithful: 7 scores (1 fail, 6 pass); 3 of 7 shown | cites a page that does not say it");
});

test("an annotation score is annotation evidence; an observation's trace is linked", () => {
  const [r] = extract(page([v2("reviewed", "BOOLEAN", 1, "True", {
    source: "ANNOTATION", traceId: "tr-9", observationId: "ob-3", ...aac("AAC-0085"),
  })]), { mechanisms: { ANNOTATION: ["M6"] }, url: "https://lf.example/project/p" });
  assert.deepEqual(r.evidence, [{
    type: "annotation", ref: "reviewed @ observation:ob-3",
    url: "https://lf.example/project/p/traces/tr-9", at: "2026-09-01T10:00:00Z",
  }]);
});
