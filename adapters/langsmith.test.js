/*
 * LangSmith adapter: one row per behaviour, each a feedback export as
 * GET /api/v1/feedback answers it and the partial results the adapter must
 * translate it into. The example report covers the happy path end to end;
 * this table pins the edges — declaration order, verdict rules, evaluator
 * errors, skips, aggregation and the warnings that keep a partial export from
 * reading as the whole history.
 *
 *   node --test adapters/langsmith.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { extract } = require("./langsmith");

let n = 0;
// One feedback row as the API returns it (FeedbackSchema): a root run's
// feedback, written by evaluate(), which marks every evaluator `model`.
const fb = (key, score, extra = {}) => {
  const id = ++n;
  return {
    id: `f${id}`, key, score, value: null, comment: null, correction: null,
    run_id: `r${id}`, trace_id: `r${id}`, session_id: "sess-1", is_root: true,
    created_at: "2026-09-01T10:00:00.123456+00:00", modified_at: "2026-09-01T10:00:00.123456+00:00",
    start_time: null, comparative_experiment_id: null, feedback_group_id: null,
    feedback_source: { type: "model", metadata: { __run: { run_id: `ev${id}` } }, user_id: null },
    extra: null, ...extra,
  };
};
const aac = (id, more = {}) => ({ extra: { aac: id, ...more } });
const src = (type, metadata = {}) => ({ feedback_source: { type, metadata, user_id: null } });
const M = { mechanisms: ["M3"] };

// Only the fields a case turns on; the rest is checked once, below.
const brief = (r) => ({ case: r.case, outcome: r.outcome, ...(r.ran === false ? { ran: false } : {}) });

const CASES = [
  // --- declaration ---
  {
    name: "extra.aac declares the obligation",
    input: [fb("faithful", true, aac("AAC-0029"))],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "extra.aac as a list declares several",
    input: [fb("faithful", true, aac(["AAC-0029", "AAC-0030"]))],
    want: [{ case: "AAC-0029", outcome: "pass" }, { case: "AAC-0030", outcome: "pass" }],
  },
  {
    name: "feedback_source.metadata.aac (source_info / evaluator_info) declares it",
    input: [fb("faithful", true, src("model", { aac: "AAC-0029" }))],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "extra wins over feedback_source.metadata",
    input: [fb("faithful", true, { ...src("api", { aac: "AAC-0030" }), ...aac("AAC-0029") })],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "an identifier in the feedback key",
    input: [fb("AAC-0031 abstains when unsupported", true)],
    want: [{ case: "AAC-0031", outcome: "pass" }],
  },
  {
    name: "extra.aac wins over an identifier in the key",
    input: [fb("AAC-0031 abstains", true, aac("AAC-0029"))],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "a mapping file names the key exactly",
    input: [fb("watch_w01", false), fb("watch_w010", false)],
    opts: { mapping: { "AAC-0028": ["watch_w01"] } },
    want: [{ case: "AAC-0028", outcome: "fail" }],
  },
  {
    name: "no identifier anywhere: ignored, not guessed",
    input: [fb("conciseness", true)],
    want: [],
  },

  // --- verdict ---
  {
    name: "a boolean score false is a fail",
    input: [fb("faithful", false, aac("AAC-0029"))],
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    // LangSmith keeps booleans and numbers in one field; 1 might be a 0-5 scale.
    name: "a numeric 1 is unknown unless the key is declared binary",
    input: [fb("faithful", 1, aac("AAC-0029"))],
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "a numeric 0 on a key declared binary is a fail",
    input: [fb("faithful", 0, aac("AAC-0029"))],
    opts: { binary: ["faithful"] },
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "a key declared binary still has no verdict for 0.5",
    input: [fb("faithful", 0.5, aac("AAC-0029"))],
    opts: { binary: ["faithful"] },
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "a key asserting a defect, inverted by aac.pass",
    input: [fb("hallucination", true, aac("AAC-0029", { "aac.pass": false }))],
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "a key asserting a defect, inverted by the source's `inverted`",
    input: [fb("hallucination", 0, aac("AAC-0029"))],
    opts: { binary: ["hallucination"], inverted: ["hallucination"] },
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    // 0.12 might be a failure under someone's threshold. Not ours to pick.
    name: "a continuous score has no verdict, whatever the number",
    input: [fb("faithfulness", 0.12, aac("AAC-0029"))],
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "a categorical value has no verdict, even one that reads like one",
    input: [fb("grade", null, { value: "incorrect", ...aac("AAC-0029") })],
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "the writer's aac.outcome is the verdict, whatever the score",
    input: [fb("faithfulness", 0.12, aac("AAC-0029", { "aac.outcome": "fail" }))],
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "aac.outcome in feedback_source.metadata counts too",
    input: [fb("faithfulness", 0.12, { ...src("api", { aac: "AAC-0029", "aac.outcome": "pass" }) })],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "an evaluator that raised (extra.error) is an error",
    input: [fb("faithful", null, { comment: "TimeoutError()", ...aac("AAC-0029", { error: true }) })],
    want: [{ case: "AAC-0029", outcome: "error" }],
  },
  {
    name: "aac.outcome skipped is not coverage",
    input: [fb("faithful", true, aac("AAC-0029", { "aac.outcome": "skipped" }))],
    want: [{ case: "AAC-0029", outcome: "unknown", ran: false }],
  },
  {
    name: "a skip beside feedback that ran does not decide the outcome",
    input: [
      fb("faithful", true, aac("AAC-0029")),
      fb("faithful", true, aac("AAC-0029", { "aac.outcome": "skipped" })),
    ],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },

  // --- aggregation ---
  {
    name: "many rows fold into one result: worst outcome wins",
    input: [
      fb("faithful", true, aac("AAC-0029")),
      fb("faithful", false, aac("AAC-0029")),
      fb("faithful", true, aac("AAC-0029")),
    ],
    want: [{ case: "AAC-0029", outcome: "fail" }],
  },
  {
    name: "different mechanisms stay apart for the merge to combine",
    input: [
      fb("faithful", true, aac("AAC-0029")),
      fb("reviewed", true, { ...src("app"), ...aac("AAC-0029") }),
    ],
    opts: { mechanisms: { model: ["M3"], app: ["M6"] } },
    want: [{ case: "AAC-0029", outcome: "pass" }, { case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "the same feedback id twice (overlapping pages) counts once",
    input: [[fb("faithful", true, { id: "dup", ...aac("AAC-0029") })],
      [fb("faithful", false, { id: "dup", ...aac("AAC-0029") })]],
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },

  // --- envelopes ---
  {
    name: "an array of saved pages",
    input: [[fb("a", true, aac("AAC-0001"))], [fb("b", true, aac("AAC-0002"))]],
    want: [{ case: "AAC-0001", outcome: "pass" }, { case: "AAC-0002", outcome: "pass" }],
  },
  {
    name: "resultsPath overrides the search",
    input: { odd: { nesting: [fb("a", true, aac("AAC-0001"))] } },
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

test("one feedback object per line (an SDK loop's dump) reads like an array", () => {
  const lines = [fb("a", true, aac("AAC-0001")), fb("b", false, aac("AAC-0002"))].map((f) => JSON.stringify(f)).join("\n");
  assert.deepEqual(extract(lines, M).map(brief), [{ case: "AAC-0001", outcome: "pass" }, { case: "AAC-0002", outcome: "fail" }]);
});

/* Where a mechanism and stage come from — never from feedback_source.type alone. */
const PROVENANCE = [
  {
    name: "a list applies to every source type",
    row: fb("a", true, aac("AAC-0001")),
    opts: { mechanisms: ["M5"] },
    want: { mechanisms: ["M5"], stages: ["S5"] },
  },
  {
    name: "a map is keyed by feedback source type",
    row: fb("a", true, { ...src("app"), ...aac("AAC-0001") }),
    opts: { mechanisms: { model: ["M3"], app: ["M6"] } },
    want: { mechanisms: ["M6"], stages: ["S5"] },
  },
  {
    // evaluate() writes an exact-match function as `model`: the writer corrects it.
    name: "aac.mechanism and aac.stage win over the source block",
    row: fb("a", true, aac("AAC-0001", { "aac.mechanism": "M1", "aac.stage": "S3" })),
    opts: { mechanisms: { model: ["M3"] }, stages: ["S5"] },
    want: { mechanisms: ["M1"], stages: ["S3"] },
  },
  {
    name: "the source's stages set the stage for an experiment export",
    row: fb("a", true, aac("AAC-0001")),
    opts: { mechanisms: ["M3"], stages: ["S3"] },
    want: { mechanisms: ["M3"], stages: ["S3"] },
  },
  {
    name: "feedback from a comparative experiment defaults to S3",
    row: fb("a", true, { comparative_experiment_id: "cmp-1", ...aac("AAC-0001") }),
    opts: { mechanisms: ["M3"] },
    want: { mechanisms: ["M3"], stages: ["S3"] },
  },
];

for (const c of PROVENANCE) {
  test(`provenance: ${c.name}`, () => {
    const [r] = extract([c.row], c.opts);
    assert.deepEqual({ mechanisms: r.mechanisms, stages: r.stages }, c.want);
  });
}

/* What the adapter reports instead of passing over silently. */
const full = (k) => Array.from({ length: k }, () => fb("a", true, aac("AAC-0001")));
const WARNINGS = [
  {
    name: "a file with no feedback",
    input: { something: "else" },
    want: [/no LangSmith feedback found/],
  },
  {
    name: "one saved page holding exactly the API's limit",
    input: full(100),
    want: [/full page \(100 rows\)/],
  },
  {
    name: "saved pages whose last is as full as the first",
    input: [full(3), full(3)],
    want: [/full page \(3 rows\)/],
  },
  {
    name: "saved pages ending on a short page are complete",
    input: [full(3), full(1)],
    want: [],
  },
  {
    name: "pageSize names a smaller limit the export was saved with",
    input: full(25),
    opts: { pageSize: 25 },
    want: [/full page \(25 rows\)/],
  },
  {
    name: "rows trimmed of extra and feedback_source",
    input: [(({ extra, feedback_source, ...rest }) => rest)(fb("AAC-0001 a", true))],
    want: [/in-band aac declarations are lost/],
  },
  {
    name: "a declared row with no mechanism is dropped, loudly",
    input: [fb("a", true, aac("AAC-0001"))],
    opts: { mechanisms: undefined },
    want: [/no mechanism/],
  },
  {
    name: "a source with no mapped mechanism for this feedback source type",
    input: [fb("a", true, { ...src("api"), ...aac("AAC-0001") })],
    opts: { mechanisms: { model: ["M3"] } },
    want: [/no mechanism/],
  },
  {
    name: "a mapping entry that matches no feedback key",
    input: [fb("watch_w01", false)],
    opts: { mapping: { "AAC-0028": ["watch_w01", "watch_w99"] } },
    want: [/not in the export: watch_w99/],
  },
  {
    name: "a complete, declared export warns about nothing",
    input: [fb("a", true, aac("AAC-0001"))],
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

test("evidence is bounded, failing feedback first, with the totals in the note", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => fb("faithful", true, aac("AAC-0029"))),
    fb("faithful", false, { comment: "cites a page that does not say it", ...aac("AAC-0029") }),
  ];
  const [r] = extract(rows, { mechanisms: ["M3"], maxRefs: 3, url: "https://smith.langchain.com/o/tenant-1/" });
  assert.equal(r.outcome, "fail");
  assert.equal(r.evidence.length, 3);
  assert.deepEqual(r.evidence[0], {
    type: "experiment",
    ref: `faithful @ trace:${rows[6].run_id}`,
    url: `https://smith.langchain.com/o/tenant-1/projects/p/sess-1/r/${rows[6].run_id}`,
    at: "2026-09-01T10:00:00Z",
  });
  assert.equal(r.note, "langsmith faithful: 7 feedback (1 fail, 6 pass); 3 of 7 shown | cites a page that does not say it");
});

test("app feedback is annotation evidence; a child run links with its trace", () => {
  const [r] = extract([fb("reviewed", true, {
    run_id: "run-9", trace_id: "tr-9", is_root: false, ...src("app"), ...aac("AAC-0085"),
  })], { mechanisms: { app: ["M6"] }, url: "https://smith.langchain.com/o/tenant-1" });
  assert.deepEqual(r.evidence, [{
    type: "annotation", ref: "reviewed @ run:run-9",
    url: "https://smith.langchain.com/o/tenant-1/projects/p/sess-1/r/run-9?trace_id=tr-9", at: "2026-09-01T10:00:00Z",
  }]);
});

test("summary-evaluator feedback on the experiment itself links to the project", () => {
  const [r] = extract([fb("f1_overall", true, { run_id: null, trace_id: null, is_root: false, ...aac("AAC-0025") })],
    { mechanisms: ["M2"], url: "https://smith.langchain.com/o/tenant-1" });
  assert.deepEqual(r.evidence[0].ref, "f1_overall @ project:sess-1");
  assert.deepEqual(r.evidence[0].url, "https://smith.langchain.com/o/tenant-1/projects/p/sess-1");
});
