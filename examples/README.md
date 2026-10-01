# Examples

```
fixtures/junit.xml       a pytest run
fixtures/promptfoo.json  a promptfoo run
fixtures/deepeval.json   a DeepEval test run
aac.config.yaml          what is claimed, from where, and what is accepted
coverage-report.example.json   <- built from the four above
```

## The report is a build artifact, not a document

`coverage-report.example.json` is produced by the real adapters from the real
fixtures. Nothing about it is hand-written, and CI rebuilds it on every push and
fails on any diff — so the whole chain (fixture → adapter → merge → schema)
stays provably intact rather than drifting into documentation.

```bash
npm run build-example
npm run validate-report -- examples/coverage-report.example.json
```

Subject: an illustrative batch document classifier that emits a typed record per
invoice, classified `A1` + `A2`. That composition makes 43 obligations
applicable. It is **not a real system** — the Phase 4 reference implementation
replaces it with a report from a live repository's CI.

```
invoice-classifier a3f19c2  [A1 A2]  catalog 0.7.0
  applicable      43
  covered         28  (2 failing)
  accepted risk   4
  not applicable  3
  not covered     8
  uncovered MUSTs 4
  uncovered gates 1
```

## It is deliberately imperfect

An all-green example would teach the wrong lesson. This one carries every state
the format supports, because each one means something different to a reader:

- **2 failing** — `AAC-0023` (dates normalising to the wrong locale for 3 of 40
  gold records) and `AAC-0102` (candidate 18.4% more expensive per successful
  task, for +1.9% quality). Both are *working controls reporting real problems*,
  which is a materially better position than not checking. See
  [../docs/REPORT.md](../docs/REPORT.md).
- **4 accepted risks** — each with an owner and a review date. Under a
  management-system audit an identified, owned, dated gap is conformant; an
  undiscovered one is a finding.
- **3 not applicable** — the conditional `MAY` obligations whose condition
  genuinely fails: no streaming, no cache, single region.
- **8 not covered** — honest blind spots, four of them MUSTs and one also a
  release gate. Nobody has got to them and nobody has accepted them.

Those eight are not hand-listed anywhere. They appear because `build-report`
found no adapter evidence and no declaration, and wrote the row anyway. A blind
spot cannot be hidden by omitting it, which is the only reason the coverage
number means anything.

The shape is recognisable: a team with solid contract testing and a real eval
suite that has not yet wired up cost and latency observability. `AAC-0007`,
`AAC-0008`, `AAC-0100` and `AAC-0107` are exactly what falls through when
telemetry work trails test work.

## The summary cannot lie

`summary` is derived. The validator recomputes every field and rejects a
mismatch:

```
ERROR summary.covered claims 43, results give 28
ERROR summary.not_covered claims 0, results give 8
```

A report cannot claim a headline its own rows do not support. For an artifact
intended to reach a release review or an auditor, that property is the point.

## What the validator does not do

It exits 0 with uncovered MUSTs present.

Whether a claim is good enough to ship is the release owner's decision, and the
threshold behind it belongs to the adopting organisation. The tool's job is to
make the numbers true and legible, not to make the judgement.
