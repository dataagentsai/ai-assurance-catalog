/*
 * DeepEval test run JSON -> partial coverage results.
 *
 * Translation only. Reads the test run DeepEval already wrote; never runs a
 * metric, never compares a score to a threshold. The verdict on each metric is
 * DeepEval's own `success` field, read as it stands.
 *
 * Where the file comes from. DeepEval serialises its TestRun model (camelCase
 * keys) in three places, all accepted:
 *
 *   DEEPEVAL_RESULTS_FOLDER=out deepeval test run test_x.py
 *       -> out/test_run_<YYYYMMDD_HHMMSS>.json        { testFile, testCases, ... }
 *   .deepeval/.latest_run_full.json                    same shape
 *   .deepeval/.latest_test_run.json                    { testRunData: { ... } }
 *
 * A file you wrote yourself from `evaluate()`'s result (`test_results` with
 * snake_case keys) is read too. The row lists are located rather than assumed,
 * as the promptfoo adapter does; point `resultsPath` at them if that fails.
 *
 * An obligation is declared on the test case, checked in this order:
 *
 *   1. `tags` or `metadata.aac` on the LLMTestCase / ConversationalTestCase:
 *        LLMTestCase(..., tags=["AAC-0029"])
 *        LLMTestCase(..., metadata={"aac": "AAC-0029"})
 *      Every metric on the case decides the outcome.
 *   2. An identifier in a metric's name — GEval(name="AAC-0029 faithfulness").
 *      Only that metric decides the outcome for that obligation.
 *   3. An identifier in the test case name (under `deepeval test run`, the
 *      pytest function name): def test_aac_0029_grounded(): ...
 *
 * A metric that did not run is not coverage. With `skip_on_missing_params`,
 * DeepEval drops a skipped metric from `metricsData` and leaves the test case's
 * `success` at its initial `true` — so a case whose every metric was skipped
 * reads as passed. Here it is `ran: false`, and the merge names it in the
 * not-covered row instead of counting it.
 */

const ID = /AAC[-_]?(\d{4})/gi;

const ids = (s) => {
  if (s === undefined || s === null) return [];
  const out = new Set();
  for (const v of Array.isArray(s) ? s : [s]) {
    for (const m of String(v).matchAll(ID)) out.add(`AAC-${m[1]}`);
  }
  return [...out];
};

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

const ROW_KEYS = [
  "testCases", "conversationalTestCases",
  "test_cases", "conversational_test_cases",
  "testResults", "test_results",
];

/*
 * Every test-case list in the document, LLM and conversational alike, plus the
 * run object that holds them (for `testFile`). A run wrapped under
 * `testRunData` is found the same way as a bare one.
 */
function locate(doc, resultsPath) {
  if (resultsPath) {
    const rows = resultsPath.split(".").reduce((o, k) => (o == null ? o : o[k]), doc);
    return { run: doc, rows: Array.isArray(rows) ? rows : [] };
  }
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) { const f = walk(v, depth + 1); if (f) return f; }
      return null;
    }
    const lists = ROW_KEYS.filter((k) => Array.isArray(node[k]));
    if (lists.length) return { run: node, rows: lists.flatMap((k) => node[k]) };
    for (const v of Object.values(node)) { const f = walk(v, depth + 1); if (f) return f; }
    return null;
  };
  return walk(doc, 0) || { run: doc, rows: [] };
}

/*
 * The outcome of a set of metrics, from DeepEval's own per-metric verdicts. A
 * metric marked flaky never decides a test case in DeepEval, so it does not
 * decide one here either. A metric with no verdict and no error is `unknown`:
 * the score and threshold are both in the file, and comparing them would be
 * scoring.
 */
function outcomeOf(metrics) {
  const deciding = metrics.filter((m) => !m.flaky);
  if (!deciding.length) return "unknown";
  if (deciding.some((m) => m.error)) return "error";
  if (deciding.some((m) => m.success === false)) return "fail";
  if (deciding.every((m) => m.success === true)) return "pass";
  return "unknown";
}

const noteOf = (metrics) =>
  metrics
    .filter((m) => !m.flaky && (m.error || m.success === false))
    .map((m) => `${m.name}: ${String(m.error || m.reason || "failed").trim()}`)
    .join(" | ")
    .slice(0, 300) || undefined;

const list = (v) =>
  v === undefined ? null
  : (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map(String).filter(Boolean);

function extract(json, opts = {}) {
  const doc = typeof json === "string" ? JSON.parse(json) : json;
  const { run, rows } = locate(doc, opts.resultsPath);
  const testFile = pick(run, "testFile", "test_file");
  const results = [];
  extract.warnings = [];

  if (!rows.length) {
    // Loud, not empty: a file with no rows found reads as zero coverage.
    extract.warnings.push("no DeepEval test cases found in the file; set resultsPath if the shape has moved");
    return results;
  }

  rows.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const name = String(pick(row, "name") || `test_case_${pick(row, "order") ?? i}`);
    const metadata = pick(row, "metadata", "additionalMetadata", "additional_metadata") || {};
    const metrics = (pick(row, "metricsData", "metrics_data") || []).filter((m) => m && typeof m === "object");

    // Which obligations, and which metrics speak for each.
    const claims = new Map();
    const inband = [...new Set([...ids(metadata.aac), ...ids(pick(row, "tags"))])];
    if (inband.length) {
      for (const c of inband) claims.set(c, metrics);
    } else {
      for (const m of metrics) {
        for (const c of ids(m.name)) claims.set(c, [...(claims.get(c) || []), m]);
      }
      for (const c of ids(name)) if (!claims.has(c)) claims.set(c, metrics);
    }
    if (!claims.size) return;

    const ref = testFile ? `${testFile}::${name}` : name;
    const mechanisms = list(metadata["aac.mechanism"]) || opts.mechanisms || ["M3"];
    const stages = list(metadata["aac.stage"]) || opts.stages || ["S3"];

    for (const [c, ms] of claims) {
      // No metric ran: every one was skipped, or none was attached.
      const ran = ms.length > 0;
      const outcome = ran ? outcomeOf(ms) : "unknown";
      const note = ran ? noteOf(ms) : undefined;
      results.push({
        ...(ran ? {} : { ran: false }),
        case: c,
        outcome,
        mechanisms,
        stages,
        evidence: [{ type: testFile ? "test" : "experiment", ref, ...(opts.url ? { url: opts.url } : {}) }],
        ...(note ? { note } : {}),
      });
    }
  });
  return results;
}

extract.warnings = [];

module.exports = { name: "deepeval", extract };
