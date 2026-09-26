# The coverage report

A machine-readable conformance claim: which obligations a system covers, how,
and with what evidence.

This is the artifact everything else exists to produce. The catalog is the
vocabulary; the report is the thing a release review, a GRC platform or an
auditor actually consumes. Schema:
[schema/coverage-report.schema.json](../schema/coverage-report.schema.json).

## Coverage and outcome are different questions

The single most important distinction in the format, and the one most easily
collapsed.

- **`status`** — does a check *exist*? This is what an auditor asks: do you
  verify this obligation at all.
- **`outcome`** — did it *pass*? This is what a release gate asks.

A `covered` obligation with `outcome: fail` is a **working control reporting a
real problem**. An obligation with `status: not-covered` is a blind spot. These
are not degrees of the same thing, and a format that merged them into one
red/green field would make the healthier of the two look worse.

```json
{ "case": "AAC-0055", "status": "covered", "outcome": "fail",
  "mechanisms": ["M1"],
  "evidence": [{ "type": "test", "ref": "tests/test_budget.py::test_max_steps" }] }
```

That row is good news wearing a red badge. Read it as: the control works, and
it has found something.

## Silence is not an answer

`results` must carry an entry for **every applicable obligation**. An obligation
with no entry is indistinguishable from one nobody thought about, which is
exactly the ambiguity this format exists to remove.

Four honest statuses, and `not-covered` is a legitimate one:

| Status | Meaning | Also requires |
|---|---|---|
| `covered` | A check exists and ran | `evidence`, `mechanisms` |
| `not-covered` | No check. Not yet done, and not deliberately accepted | — |
| `accepted-risk` | Deliberately not implemented | `owner`, `rationale`, `review_by` |
| `not-applicable` | The case's stated condition does not hold | `rationale` |

*Ran* is part of `covered`. A check that exists and was skipped did not run, so
on its own it leaves the obligation `not-covered`; the builder names the skipped
check in the row's `note`, so the gap reads as "skipped", not as "nobody thought
of it". A skipped live-model test that counted as coverage would claim exactly
the obligation it was skipped for want of.

`not-applicable` is for conditional obligations — the `MAY` cases whose
condition genuinely fails. A system that does not stream does not owe
`AAC-0092`. It is not a general escape hatch, and a reviewer will read a long
list of them as exactly what it looks like.

## Why the honest report is also the strongest one

Under a management-system audit, a gap that is **identified, owned and dated is
conformant**. Risk acceptance is a legitimate treatment. A gap nobody discovered
is a finding.

So a report showing 74 covered, 12 failing and 8 accepted risks with named
owners is a *stronger* submission than one showing all green — because the
all-green version invites the question of how you would know, and has no answer.
The honest artifact and the audit-optimal artifact are the same artifact. That
alignment is unusual and worth exploiting.

The corollary matters too: `evidence` is required on every `covered` row. A
coverage claim with nothing behind it is an assertion, and assertions are what
this format replaces.

## Generated, never assembled

Management-system auditing strongly prefers evidence that is a **byproduct of
the process** over evidence assembled for the review. Hand-assembled evidence
suggests the control runs at audit time; automatically generated, timestamped
evidence across many commits demonstrates that it operates continuously — which
is the whole point of a surveillance audit.

So: emit this from CI on every run and keep the series. A year of dated reports
is a categorically stronger class of evidence than a better-looking document,
and it cannot be produced retroactively.

## The summary cannot lie

`summary` is optional and **derived**. A validator recomputes every field from
`results` and rejects a mismatch, so a report cannot claim a headline its own
contents do not support.

```bash
npm run validate-report -- path/to/report.json
```

The validator also checks that every case identifier resolves against the stated
`catalog_version`, and reports uncovered MUSTs and uncovered gates separately
from the total — those are the two numbers that decide whether a claim holds.

## Versioning

`report_version` and `catalog_version` are independent and both required.

The format evolves on its own schedule; the obligations evolve on theirs. A
report without `catalog_version` is uninterpretable, because the set of
obligations it claims to cover is undefined — which is why the schema requires
it rather than defaulting it.

## Scope

The report says what a system covers. It is **not**:

- a pass/fail verdict on the system — that judgement belongs to the release
  owner and the thresholds behind it belong to the adopter
- a substitute for a Statement of Applicability, risk assessment or impact
  assessment, which govern *processes* rather than tests
- a certification of anything

Overclaiming here is the fastest way to have the whole thing dismissed by the
first auditor who reads it. Scope it honestly and it is credible evidence for
one band of controls — verification, validation, monitoring, logging.
