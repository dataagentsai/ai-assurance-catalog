/*
 * DeepEval adapter: one row per behaviour, each a DeepEval test run as the
 * library serialises it and the partial results the adapter must translate it
 * into. The example report covers the happy path end to end; this table pins
 * the edges — envelopes, declaration order, skips, errors, flaky metrics.
 *
 *   node --test adapters/deepeval.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { extract } = require("./deepeval");

const metric = (name, success, extra = {}) => ({ name, threshold: 0.7, success, score: success ? 0.9 : 0.3, flaky: false, ...extra });
const tc = (name, extra = {}) => ({ name, input: "x", success: true, metricsData: [metric("Faithfulness", true)], ...extra });
const run = (testCases, extra = {}) => ({ testFile: "tests/test_eval.py", testCases, ...extra });

// Only the fields a case turns on; the rest is checked once, below.
const brief = (r) => ({ case: r.case, outcome: r.outcome, ...(r.ran === false ? { ran: false } : {}) });

const CASES = [
  {
    name: "tags declare the obligation",
    input: run([tc("test_grounded", { tags: ["AAC-0029"] })]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "metadata.aac declares the obligation, as a list",
    input: run([tc("test_grounded", { metadata: { aac: ["AAC-0029", "AAC-0030"] } })]),
    want: [{ case: "AAC-0029", outcome: "pass" }, { case: "AAC-0030", outcome: "pass" }],
  },
  {
    name: "older runs carry additionalMetadata instead of metadata",
    input: run([tc("test_grounded", { additionalMetadata: { aac: "AAC-0029" } })]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "identifier in the test name",
    input: run([tc("test_aac_0031_abstains")]),
    want: [{ case: "AAC-0031", outcome: "pass" }],
  },
  {
    name: "no identifier anywhere: ignored, not guessed",
    input: run([tc("test_tone")]),
    want: [],
  },
  {
    name: "a metric-name claim is decided by that metric alone",
    input: run([tc("test_fields", {
      success: false,
      metricsData: [metric("AAC-0025 field recall [GEval]", true), metric("Answer Relevancy", false)],
    })]),
    want: [{ case: "AAC-0025", outcome: "pass" }],
  },
  {
    name: "a tag claim is decided by every metric on the case",
    input: run([tc("test_fields", {
      tags: ["AAC-0025"],
      metricsData: [metric("Field recall", true), metric("Answer Relevancy", false)],
    })]),
    want: [{ case: "AAC-0025", outcome: "fail" }],
  },
  {
    name: "tags win over identifiers in metric names",
    input: run([tc("test_x", { tags: ["AAC-0001"], metricsData: [metric("AAC-0025 recall", true)] })]),
    want: [{ case: "AAC-0001", outcome: "pass" }],
  },
  {
    // DeepEval drops skipped metrics and leaves success at its initial true.
    name: "every metric skipped: success true with no metrics is not coverage",
    input: run([tc("test_x", { tags: ["AAC-0021"], success: true, metricsData: [] })]),
    want: [{ case: "AAC-0021", outcome: "unknown", ran: false }],
  },
  {
    name: "metricsData absent altogether is also a skip",
    input: run([{ name: "test_x", input: "x", success: true, tags: ["AAC-0021"] }]),
    want: [{ case: "AAC-0021", outcome: "unknown", ran: false }],
  },
  {
    name: "a metric that errored is an error, not a failure",
    input: run([tc("test_x", { tags: ["AAC-0029"], success: false, metricsData: [metric("Faithfulness", false, { error: "judge timed out" })] })]),
    want: [{ case: "AAC-0029", outcome: "error" }],
  },
  {
    name: "a flaky metric's failure does not decide, as in DeepEval",
    input: run([tc("test_x", { tags: ["AAC-0029"], metricsData: [metric("Faithfulness", true), metric("Tone", false, { flaky: true })] })]),
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "only flaky metrics ran: unknown, still coverage",
    input: run([tc("test_x", { tags: ["AAC-0029"], metricsData: [metric("Tone", true, { flaky: true })] })]),
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    // The score sits below the threshold, but comparing them would be scoring.
    name: "no verdict from DeepEval stays unknown whatever the score says",
    input: run([tc("test_x", { tags: ["AAC-0029"], metricsData: [{ name: "Faithfulness", threshold: 0.9, score: 0.1 }] })]),
    want: [{ case: "AAC-0029", outcome: "unknown" }],
  },
  {
    name: "conversational test cases are read alongside LLM ones",
    input: run([tc("test_a", { tags: ["AAC-0001"] })], {
      conversationalTestCases: [{ name: "test_goal", success: false, tags: ["AAC-0037"], metricsData: [metric("Conversation Completeness", false)], turns: [] }],
    }),
    want: [{ case: "AAC-0001", outcome: "pass" }, { case: "AAC-0037", outcome: "fail" }],
  },
  {
    name: ".latest_test_run.json wraps the run under testRunData",
    input: { testRunData: run([tc("test_x", { tags: ["AAC-0029"] })]), testRunLink: "https://example.invalid/run" },
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "a hand-dumped evaluate() result with snake_case keys",
    input: { test_results: [{ name: "test_case_0", success: true, additional_metadata: { aac: "AAC-0029" }, metrics_data: [metric("Faithfulness", true)] }] },
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
  {
    name: "resultsPath overrides the search",
    input: { odd: { nesting: [tc("test_x", { tags: ["AAC-0029"] })] } },
    opts: { resultsPath: "odd.nesting" },
    want: [{ case: "AAC-0029", outcome: "pass" }],
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const got = extract(JSON.stringify(c.input), c.opts || {}).map(brief);
    assert.deepEqual(got, c.want);
  });
}

test("evidence, mechanisms, stages and the failure note", () => {
  const [r] = extract(run([tc("test_dates", {
    tags: ["AAC-0023"],
    metadata: { "aac.mechanism": "M2 M3", "aac.stage": "S2" },
    metricsData: [metric("Date Fidelity", false, { reason: "read 04/07 as 7 April" })],
  })]), { url: "https://evals.example/run/1" });
  assert.deepEqual(r, {
    case: "AAC-0023",
    outcome: "fail",
    mechanisms: ["M2", "M3"],
    stages: ["S2"],
    evidence: [{ type: "test", ref: "tests/test_eval.py::test_dates", url: "https://evals.example/run/1" }],
    note: "Date Fidelity: read 04/07 as 7 April",
  });
});

test("without a testFile the evidence is an experiment, and defaults apply", () => {
  const [r] = extract({ testCases: [tc("test_x", { tags: ["AAC-0029"] })] });
  assert.deepEqual(r.evidence, [{ type: "experiment", ref: "test_x" }]);
  assert.deepEqual(r.mechanisms, ["M3"]);
  assert.deepEqual(r.stages, ["S3"]);
});

test("a file with no test cases warns instead of reading as zero coverage", () => {
  assert.deepEqual(extract({ something: "else" }), []);
  assert.equal(extract.warnings.length, 1);
  extract(run([tc("test_x", { tags: ["AAC-0029"] })]));
  assert.equal(extract.warnings.length, 0);
});
