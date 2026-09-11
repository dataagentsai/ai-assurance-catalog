# AI Assurance Catalog

**Test obligations for AI applications, by architecture archetype.**

Status: **working draft 0.11.4** — identifiers are stable from the first tagged
release. Nothing here is externally binding.

---

## The gap this fills

Four bodies of work surround AI assurance and none of them occupy its centre.

| Layer | Who owns it | What it gives you | What it doesn't |
|---|---|---|---|
| Governance | ISO/IEC 42001, NIST AI RMF, EU AI Act | *That* a system must be validated | Which tests |
| Threats | OWASP LLM Top 10, MITRE ATLAS | What can go wrong, ranked | Whether it applies to **your** architecture |
| Telemetry | OpenTelemetry GenAI conventions | How to record a model call | What to assert over it |
| Metrics | Ragas, DeepEval, promptfoo, eval platforms | How to score one property | Which properties you owe |

There is no open, versioned, machine-readable catalog binding
**application archetype → test obligation → realization mechanism.**
That binding is what an architect needs at design review, and it is the one
thing nobody publishes. This is that catalog.

## What it is

108 obligations. Each one states, in plain English, something that must be true
of a system — tagged with which architecture archetypes owe it, which classes of
machinery can produce a verdict, at which lifecycle stage, and whether failure
blocks.

```yaml
id: AAC-0055
level: MUST
dimension: reliability
gate: true
archetypes: [A6]
title: Hard termination under every condition
statement: >-
  Maximum steps, wall-clock and token budget are enforced by the harness — not
  requested in the prompt — and the stop path is tested including its
  partial-result behaviour.
mechanisms: [M1, M5]      # deterministic assertion, trace assertion
stages: [S2, S4]          # CI pre-merge, runtime gateway
tool_class: Test runner + gateway
```

Thirty-two of the 108 are **core** — owed by every AI application regardless of
shape. The rest are archetype deltas: what is *new* about that shape's risk
surface. That is why this is 108 cases and not several hundred.

## Where this sits

This catalog is one part of a family. The others are the
[AI Assurance Catalog](https://github.com/dataagentsai/ai-assurance-catalog) —
what must be **TRUE** — and **AgentTwin**, which describes what a system must be
**FACED** with.

Two family-level documents govern form, and neither asks you to agree with
anything:

- **[The Spec Charter](https://github.com/dataagentsai/clean-ai-engineering/blob/main/SPEC-CHARTER.md)**
  — the routing rule that decides which artifact a statement belongs in, and the
  dependency invariant that keeps this catalog free of any one domain's rules.
- **[The Baseline](https://github.com/dataagentsai/clean-ai-engineering/blob/main/BASELINE.md)**
  — why this catalog says nothing about code review, branching or coverage. An
  agent is a software system; established practice is cited, never restated, and
  only the delta that non-determinism creates appears here.

The umbrella repository,
[clean-ai-engineering](https://github.com/dataagentsai/clean-ai-engineering),
states a point of view. **This catalog does not, and must remain usable by
someone who rejects all of it.**

## What it is not

This is a join table, not a framework. It deliberately authors none of the
following, and cites all of them:

- **Controls** — ISO 42001 and NIST own those
- **Threats** — OWASP and ATLAS own those
- **Metric implementations** — Ragas, DeepEval, G-Eval own those
- **Telemetry schemas** — OpenTelemetry owns that
- **Thresholds and SLOs** — the adopting team owns those
- **Test execution** — your existing runner owns that

See [docs/NON-GOALS.md](docs/NON-GOALS.md). The linter enforces part of this
mechanically: naming a product inside a case's normative text is a build error.

## From spec to concrete

An obligation that nobody knows how to build is a principle, not a test. So
[`realizations/`](realizations/) answers the next question — *what would I
actually do?* — with several options per obligation across six approaches:

| Approach | |
|---|---|
| `in-house` | a test or wrapper in your own repo — most portable, usually the strongest evidence |
| `open-source` | a library you run — promptfoo, DeepEval, garak, Presidio, NeMo Guardrails |
| `platform` | hosted eval and tracing — LangSmith, Langfuse, Braintrust, Phoenix |
| `gateway` | enforcement on the request path — LiteLLM, Portkey, Kong AI Gateway |
| `cloud-native` | managed services — Bedrock Guardrails, Azure AI Content Safety, Cloud DLP |
| `human` | annotation and review, which calibrates everything model-graded |

Browse them in **Section 6 of the site**, filterable by approach — or read the
YAML directly. **163 concrete options across 60 obligations** — the 32 core ones plus the three
archetypes where "how would I even test that?" bites hardest: `A6` tool-using
agents, `A10` judges and classifiers, `A3` grounded answerers. This is the
**only** layer where products may be named, it versions separately, and it
carries a `checked` date because it will go stale.

## Citing a case

The unit of adoption is one identifier in one test name. That costs nothing and
requires no buy-in to the rest.

```python
@pytest.mark.aac("AAC-0055")
def test_agent_stops_at_step_budget(): ...
```

```python
span.set_attribute("aac.case_id", "AAC-0055")
```

Identifiers are flat, permanent, and never reused — archetype is metadata, not
identity. See [docs/ID-POLICY.md](docs/ID-POLICY.md) for why, and for the
deprecation rules.

## Layout

```
catalog/        108 cases, one YAML file each — the normative master
taxonomy/       archetypes, mechanisms, stages, dimensions, levels
schema/         JSON Schema for a case, a pattern, and a coverage report
realizations/   how each obligation gets built — six approaches, named products
patterns/       informative anti-patterns mapping into the cases that catch them
crosswalks/     mappings to OWASP, NIST AI RMF, ISO 42001, EU AI Act
tools/          linter, renderer, report builder, validator, badge
action.yml      GitHub Action for adopters
adapters/       junit and promptfoo -> coverage report; translation only
examples/       fixtures, adopter config, and the report they build
docs/           identifier, versioning, realization, report, adapter and scope policy
```

The rendered site is a build artifact. **The YAML is the master**; never edit
generated output.

```bash
npm install
npm run lint      # schema + identifier + discipline checks
npm run render    # YAML -> site
npm run build-report -- examples/aac.config.yaml -o coverage-report.example.json
npm run validate-report -- examples/coverage-report.example.json
```

## Roadmap

- [x] **Phase 0** — normative core: catalog, schema, identifier policy, renderer
- [~] **Phase 1** — crosswalks: OWASP LLM Top 10 done; NIST AI RMF, ISO 42001, EU AI Act to go
- [x] **Phase 2** — coverage report schema (the artifact an auditor consumes)
- [x] **Phase 3** — adapters: junit and promptfoo shipped; DeepEval and eval-platform exports to go
- [x] **Phase 4** — reference implementation: [spark-cost-agent](https://github.com/basantchoudhary/spark-cost-agent/tree/main/aac) emits a real report from its own suite, 23/50 covered
- [x] **Phase 5** — ecosystem plugs: [OTel attribute convention](docs/OTEL.md), GitHub Action, badge

**Phases 0–2 are the whole specification and are complete.** Phase 3 code is
all translation — it reads what your test tooling already produced and emits the
report format defined in [docs/REPORT.md](docs/REPORT.md). Nothing in this
repository will ever evaluate anything itself; see
[docs/ADAPTERS.md](docs/ADAPTERS.md).

## Licence

Split deliberately, following the OWASP model:

- **Specification** — `catalog/`, `taxonomy/`, `crosswalks/`, `docs/`, `schema/` —
  [CC BY 4.0](LICENSE-SPEC.txt)
- **Code** — `tools/`, everything else — [Apache 2.0](LICENSE)

Apache 2.0 specifically for the patent grant, which is what corporate legal
looks for before allowing adoption.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The bar for a new case is that it states
an obligation no existing case covers, for a named archetype, with at least one
mechanism that could realistically produce a verdict. Cases that restate a
threat, name a product, or set a threshold are out of scope by construction.
