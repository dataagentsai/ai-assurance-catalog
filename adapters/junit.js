/*
 * junit XML -> partial coverage results.
 *
 * Translation only. This reads what a test runner already produced; it never
 * runs anything and never decides whether a result is acceptable.
 *
 * A test declares which obligation it discharges in one of two ways, checked in
 * this order:
 *
 *   1. A recorded property (preferred, unambiguous):
 *        def test_max_steps(record_property):
 *            record_property("aac", "AAC-0055")
 *      emits <property name="aac" value="AAC-0055"/>
 *
 *   2. An identifier anywhere in the test or class name:
 *        def test_aac_0055_max_steps(): ...
 *
 *   3. An external mapping file, for suites that cannot be annotated yet:
 *        AAC-0055:
 *          - tests/test_agent_loop.py::test_step_limit_is_a_distinct_failure
 *
 * Both in-band forms are preferred, because a rename cannot silently break the
 * link. A mapping file has exactly that weakness, so every pattern that matches
 * no test is reported — that is what makes a rename loud instead of silent.
 */
const { XMLParser } = require("fast-xml-parser");

const ID = /AAC[-_]?(\d{4})/gi;

const ids = (s) => {
  if (!s) return [];
  const out = new Set();
  for (const m of String(s).matchAll(ID)) out.add(`AAC-${m[1]}`);
  return [...out];
};

const arr = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/*
 * Normalise a test reference so a mapping file can be written the way a human
 * refers to a test — `tests/test_loop.py::test_thing` — while junit reports it
 * as `tests.test_loop` + `test_thing`.
 */
const norm = (s) =>
  String(s).replace(/\.py\b/g, "").replace(/[/.:]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase();

function extract(xml, opts = {}) {
  // mapping: { "AAC-0055": ["tests/test_x.py::test_y", ...] }
  const mapping = opts.mapping || null;
  const byRef = new Map();
  const unmatched = new Set();
  if (mapping) {
    for (const [id, pats] of Object.entries(mapping)) {
      for (const p of pats) {
        const key = norm(p);
        if (!byRef.has(key)) byRef.set(key, []);
        byRef.get(key).push(id);
        unmatched.add(key);
      }
    }
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  const doc = parser.parse(xml);

  // A junit file is either <testsuites><testsuite>… or a bare <testsuite>.
  const suites = doc.testsuites ? arr(doc.testsuites.testsuite) : arr(doc.testsuite);
  const results = [];

  for (const suite of suites) {
    for (const tc of arr(suite && suite.testcase)) {
      const name = tc["@name"] || "";
      const cls = tc["@classname"] || "";
      const props = arr(tc.properties && tc.properties.property);

      // Property form wins, then identifiers in the name, then the mapping file.
      const declared = props.filter((p) => (p["@name"] || "").toLowerCase() === "aac");
      const inband = declared.length
        ? declared.flatMap((p) => ids(p["@value"]))
        : [...new Set([...ids(name), ...ids(cls)])];

      /*
       * Parametrised tests carry the case in the name — `test_x[not json]` —
       * so a mapping entry naming the function must match every parametrisation
       * of it. Worst-outcome-wins then folds them into one verdict.
       */
      const key = norm(`${cls}.${name}`);
      const base = norm(`${cls}.${name.replace(/\[.*\]$/s, "")}`);
      const mapped = [...new Set([...(byRef.get(key) || []), ...(base !== key ? byRef.get(base) || [] : [])])];
      if (byRef.has(key)) unmatched.delete(key);
      if (byRef.has(base)) unmatched.delete(base);

      const cases = [...new Set([...inband, ...mapped])];
      if (!cases.length) continue;

      // Per-test overrides, so a repository can mix mechanisms in one suite.
      const prop = (k) => {
        const p = props.find((x) => (x["@name"] || "").toLowerCase() === k);
        return p ? String(p["@value"]).split(/[,\s]+/).filter(Boolean) : null;
      };

      /*
       * A skipped test is a check that exists and did not run. REPORT.md defines
       * `covered` as a check that exists *and ran*, so a skip is marked `ran:
       * false` and the merge leaves it out of the verdict. Read as `unknown` it
       * made a skipped live-model test claim coverage of the obligation it
       * would have checked.
       */
      const skipped = tc.skipped !== undefined && tc.error === undefined && tc.failure === undefined;
      const outcome =
        tc.error !== undefined ? "error"
        : tc.failure !== undefined ? "fail"
        : skipped ? "unknown"
        : "pass";

      const ref = cls ? `${cls}::${name}` : name;
      for (const c of cases) {
        results.push({
          ...(skipped ? { ran: false } : {}),
          case: c,
          outcome,
          mechanisms: prop("aac.mechanism") || opts.mechanisms || ["M1"],
          stages: prop("aac.stage") || opts.stages || ["S2"],
          evidence: [{ type: "test", ref }],
          ...(outcome === "fail" || outcome === "error"
            ? { note: String((tc.failure && (tc.failure["@message"] || tc.failure)) || (tc.error && (tc.error["@message"] || tc.error)) || "").trim().slice(0, 300) || undefined }
            : {}),
        });
      }
    }
  }
  // A mapping entry that matched nothing is almost always a renamed test. Left
  // silent it would read as lost coverage with no explanation.
  if (unmatched.size) {
    extract.warnings = [...unmatched].map((k) => `mapping pattern matched no test: ${k}`);
  } else {
    extract.warnings = [];
  }
  return results;
}

module.exports = { name: "junit", extract };
