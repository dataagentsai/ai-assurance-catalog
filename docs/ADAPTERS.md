# Adapters

Adapters read what your test tooling **already produced** and translate it into
a coverage report. They run nothing, score nothing, and judge nothing.

That constraint is the strategy, not modesty. An adapter for a test runner makes
that runner more valuable and makes this project visibly dependent on it, which
turns a potential rival into a beneficiary. Building our own scorer would
acquire six competitors overnight. See [NON-GOALS.md](NON-GOALS.md).

## Shipped

| Adapter | Reads | Typical mechanism |
|---|---|---|
| `junit` | junit XML from any runner | M1 deterministic assertion, M5 trace assertion |
| `promptfoo` | promptfoo JSON output | M3 model-graded, M2 programmatic metric |
| `deepeval` | DeepEval test run JSON | M3 model-graded |
| `langfuse` | Langfuse scores API export (v2 or v3) | declared per Langfuse source — see below |

`docs/VERSIONING.md` requires two independent implementations before `1.0.0` —
the same bar the IETF applies before advancing a specification, for the same
reason. A format proven by a single implementation silently encodes that
implementation's assumptions as normative, and you only find out when the
second one arrives. The third arrived with one such assumption to correct:
DeepEval reports a case whose every metric was skipped as passed (see below).

## Declaring which obligation a test discharges

The unit of adoption is one identifier in one test. That is the whole ask.

**junit** — a recorded property, or an identifier in the test name:

```python
def test_agent_stops_at_step_budget(record_property):
    record_property("aac", "AAC-0055")
    ...

def test_aac_0055_stops_at_step_budget():   # equivalent, no plugin needed
    ...
```

The property form is preferred: a rename cannot silently break the link. Both
accept several identifiers for one test.

**promptfoo** — test metadata, or an assertion metric name:

```yaml
tests:
  - description: golden set across 6 vendors
    metadata: { aac: AAC-0001 }
```

**DeepEval** — test case tags or metadata, a metric name, or the test name:

```python
LLMTestCase(input=q, actual_output=a, retrieval_context=ctx,
            tags=["AAC-0029"])                 # or metadata={"aac": "AAC-0029"}

GEval(name="AAC-0030 citation supports claim", ...)   # this metric alone decides

def test_aac_0031_abstains(): ...                       # under `deepeval test run`
```

A tag or `metadata.aac` makes every metric on the case decide the outcome; an
identifier in a metric's name makes only that metric decide it. The adapter
reads the run DeepEval already saved — `test_run_*.json` in
`DEEPEVAL_RESULTS_FOLDER`, or `.deepeval/.latest_run_full.json` — and takes
each metric's verdict from its own `success` field. It never compares a score
with a threshold; a metric with no verdict is `unknown`. Metrics DeepEval marks
`flaky` do not decide the outcome, exactly as they do not decide DeepEval's.
Per-test overrides go in `metadata` as `aac.mechanism` and `aac.stage`.

**Langfuse** — score metadata, the score name, or a mapping file:

```python
langfuse.create_score(trace_id=t, name="absent-fields-null", value=True,
                      data_type="BOOLEAN", metadata={"aac": "AAC-0024"})
langfuse.create_score(trace_id=t, name="AAC-0017 accuracy by slice", value=0.93)
```

The adapter reads scores the project already holds, saved from the public API
as it answers — `GET /api/public/v3/scores?fields=details,subject` on Langfuse
v4, `GET /api/public/v2/scores` on v3. One page, an array of pages, or a bare
array. Without `fields=details` a v3 export has no `metadata` or `comment`, so no
in-band declaration survives it; the adapter warns. It also warns when the last
saved page still has a cursor (v3) or `page < totalPages` (v2): an export that
stopped early would otherwise read as the whole history.

An eval platform holds numbers, and most of them are not verdicts. So the
verdict rules are narrow, and every one is the platform's or the writer's:

1. `metadata["aac.outcome"]` — `pass`, `fail`, `error`, `unknown` or
   `skipped` — when the code that wrote the score stated a verdict. `skipped`
   is `ran: false`: a check that exists and did not run, never coverage.
2. A **BOOLEAN** score is its own verdict: true passes, false fails. The name
   is read as stating what should hold. Where it states a defect
   (`hallucination`), say so with `metadata["aac.pass"]: false`, or list the
   name under `inverted:` in the source block.
3. **NUMERIC, CATEGORICAL, TEXT, CORRECTION** are `unknown` — covered, since a
   check ran, but with no outcome. A faithfulness of 0.12 is a failure only
   under a threshold, and the threshold is the adopter's. An adapter that picked
   one would be a scorer. Write `aac.outcome` from the code that owns the
   threshold if the report should carry the verdict.

The **mechanism is not read from Langfuse's `source`.** `EVAL` covers both
LLM-as-a-judge and code evaluators, and the API accepts `source: ANNOTATION`
from a program, so no source names a mechanism faithfully. It comes from
`metadata["aac.mechanism"]`, or from the source block — a list, or a map keyed
by Langfuse source:

```yaml
  - adapter: langfuse
    path: reports/langfuse-scores.json
    mechanisms: { EVAL: [M3], ANNOTATION: [M6], API: [M5] }
    map: aac.langfuse.map.yaml        # score names, matched exactly
    inverted: [hallucination]
    url: https://cloud.langfuse.com/project/<id>   # evidence links to /traces/<id>
```

A declared score with no mechanism is dropped with a warning rather than given
a default, because the mechanism decides what else the report owes: M3 evidence
makes the four judge obligations owed (see REPORT.md), which is intended — an
online LLM evaluator *is* a judge. Stages default to `S5` for a score on a
trace, observation or session and `S3` for one on an experiment (dataset run);
`aac.stage` or the source's `stages` override both.

Online scoring writes one score per sampled trace, so an obligation can carry
thousands. They fold into **one result per obligation and mechanism set**:
worst outcome wins, evidence is the first `maxRefs` (default 5) scored entities
with failing ones first, each linked to its trace, and the note carries the
totals — `langfuse faithful: 412 scores (3 fail, 409 pass); 5 of 412 shown`.

**A mapping file**, for suites that predate the catalog and cannot be annotated
in one diff:

```yaml
# aac.map.yaml
AAC-0055:
  - tests/test_agent_loop.py::test_step_limit_is_a_distinct_failure
  - tests/test_eval.py::test_max_steps_catches_flailing
```

```yaml
sources:
  - adapter: junit
    path: reports/junit.xml
    map: aac.map.yaml
```

This is the zero-friction on-ramp: no test changes, no plugin, a claim on the
first day. It is genuinely **weaker evidence** than an in-band marker, because a
renamed test breaks the link silently — so every pattern that matches no test is
reported. Treat those warnings as errors, or the mapping rots into a claim about
tests that no longer exist.

Parametrised tests are handled: a pattern naming the function matches every
parametrisation of it (`test_x[case a]`, `test_x[case b]`), and worst-outcome-
wins folds them into one verdict.

**What a score never says.** Langfuse holds the scores that were written, not
the checks that ran and found nothing to write. A watch that records only its
findings — a score when a rule fires, nothing when it holds — exports as
nothing but failures, and an obligation whose rule never fired reads as
not-covered. To be read as coverage, a check writes its passes too (a BOOLEAN
per evaluated trace), or states `aac.outcome` on a score it already writes.

## Per-test overrides

An adapter cannot infer the *mechanism* from a test result — a passing pytest
case might be a schema assertion or a trace assertion, and only the author
knows. So mechanisms and stages are declared per source in `aac.config.yaml`,
and overridden per test where a suite mixes them:

```xml
<properties>
  <property name="aac" value="AAC-0011"/>
  <property name="aac.mechanism" value="M5"/>
  <property name="aac.stage" value="S2 S4"/>
</properties>
```

## Configuration

`aac.config.yaml` lives in the adopting repository and declares three things:
what is being claimed about, where the adapter inputs are, and which obligations
are deliberately not implemented. Worked example:
[examples/aac.config.yaml](../examples/aac.config.yaml).

```bash
npm run build-report -- aac.config.yaml -o coverage-report.json
npm run validate-report -- coverage-report.json
```

## Merge rules

- **Worst outcome wins.** One failing check makes the obligation failing. An
  obligation covered by four tests where one fails is not 75% passing.
- **Evidence accumulates.** Every source that touched an obligation contributes
  a pointer, so a reviewer can follow all of them.
- **Declarations override adapters** for `accepted-risk` and `not-applicable`.
  A deliberate decision outranks an incidental test result.
- **A skipped check is not coverage.** A result marked `ran: false` (junit's
  `<skipped/>`) adds no evidence; an obligation with nothing else stays
  `not-covered`, with the skipped check named in its `note`. DeepEval's
  equivalent is quieter: with `skip_on_missing_params`, a skipped metric is
  dropped from `metricsData` and the test case keeps its initial
  `success: true`, so a case whose every metric was skipped reads as passed.
  The adapter marks a case with no metric results `ran: false`.
- **Everything else becomes `not-covered`.** No adapter evidence and no
  declaration produces an explicit row saying so.

That last rule is the one that matters. A blind spot cannot be hidden by
omitting it, which is the only reason a coverage number means anything.

Two situations are reported rather than passed over silently: a **missing source
file** (its obligations would otherwise read as not-covered with no explanation)
and a **declaration for an obligation the subject does not owe**, which almost
always means the archetype classification is wrong.

## Writing another adapter

```js
module.exports = {
  name: "yourtool",
  // raw file contents + the source block from aac.config.yaml
  extract(raw, opts) {
    return [{
      case: "AAC-0001",
      outcome: "pass",              // pass | fail | error | unknown
      mechanisms: opts.mechanisms || ["M2"],
      stages: opts.stages || ["S3"],
      evidence: [{ type: "experiment", ref: "run/123" }],
      // ran: false,                // a check that exists and was skipped:
                                    // named in the report, never coverage
    }];
  },
};
```

Register it in `tools/build-report.js` and add a fixture under
`examples/fixtures/`. CI rebuilds the example report and fails on any diff, so a
fixture is what keeps an adapter honest.

**Next: LangSmith.** Feedback exports (`key`, `score`, `value`,
`feedback_source`) fit the same rules — a verdict only where the feedback is
boolean or states one — and are the second eval-platform adapter to write.

Read the output envelope **defensively**. Tools move their JSON shape between
versions, and an adapter that pins one shape breaks on upgrade for no good
reason — the promptfoo adapter locates its result rows rather than assuming a
path, and accepts an explicit `resultsPath` override when that fails.
