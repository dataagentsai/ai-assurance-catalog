# Crosswalks

Mappings from catalog identifiers to external frameworks.

**Done — all four.** Every item in each framework's considered scope appears
exactly once, either mapped or recorded as unmapped with the reason.

| File | Mapped | Unmapped | Obligations reached |
|---|---|---|---|
| `owasp-llm.yaml` | 10 | 0 | 35 |
| `nist-ai-rmf.yaml` | 29 (22 Core subcategories, 7 GenAI Profile risks) | 55 | 61 |
| `iso-42001.yaml` | 6 of 38 Annex A controls | 32 | 25 |
| `eu-ai-act.yaml` | 18 articles or paragraphs | 22 | 46 |

The unmapped counts are the honest result, not unfinished work. NIST AI RMF and
ISO 42001 govern organisations — policy, roles, impact assessment,
documentation — and a test obligation is evidence for only the handful of
items that turn on what a system demonstrably does.

Crosswalks release **out of band** from the catalog. An external framework
revising its own identifiers must never force a version bump in `catalog/` —
that decoupling is what keeps obligations citable across years while the
frameworks around them churn.

## Status

| File | Framework | Legal shape |
|---|---|---|
| `owasp-llm.yaml` | OWASP Top 10 for LLM Applications (2025) — **done** | Creative Commons — may quote |
| `nist-ai-rmf.yaml` | NIST AI RMF 1.0 Core + Generative AI Profile (AI 600-1) — **done** | US government, freely redistributable |
| `iso-42001.yaml` | ISO/IEC 42001:2023 Annex A — **done** | **Copyrighted and paywalled — cite clause identifiers only, never reproduce control text** |
| `eu-ai-act.yaml` | EU AI Act, Regulation (EU) 2024/1689 — **done** | Official Journal, public — may quote |

Four frameworks, four different licensing positions in one directory. Check
before quoting anything.

## Shape

```yaml
framework: owasp-llm-top-10
framework_version: "2025"
mappings:
  - external: LLM01
    external_name: Prompt Injection
    cases: [AAC-0004, AAC-0036, AAC-0058]
    relation: evidence-for
    note: >-
      AAC-0058 covers the tool-output vector specifically, which is the
      highest-yield variant against A6.
```

`relation` records how tight the mapping is:

- `evidence-for` — the case produces evidence supporting the external item.
  This is the default and is correct for nearly every ISO 42001 mapping.
- `tests-for` — the case directly tests the thing the external item describes.
  Appropriate for most OWASP entries.
- `partial` — the case covers one aspect; the external item needs more.

An external item no obligation provides evidence for goes under `unmapped`,
with a one-line reason, instead of being left out or padded with a loose
mapping:

```yaml
unmapped:
  - external: MEASURE 2.11
    external_name: Fairness and bias evaluated
    reason: Out of scope per docs/NON-GOALS.md.
```

The linter requires every unmapped entry to carry a reason and no cases, and
rejects an item listed twice across `mappings` and `unmapped`. Silence about an
item is indistinguishable from not having looked at it — the same rule the
coverage report applies to obligations.

**Never claim one-to-one equivalence with a management-system control.** ISO
42001 controls govern *processes* — roles, impact assessment, lifecycle
management. A test obligation is at best evidence that a process operated. An
auditor who sees a case claimed as equivalent to a control will discount the
whole crosswalk, and they will be right to.

## Why do this early

Running the catalog against an established threat list is free coverage
validation. The OWASP pass surfaced three missing obligations — system prompt leakage,
artifact provenance, and retrieval-corpus poisoning. All three are now written
as `AAC-0106`, `AAC-0107` and `AAC-0108`, and the crosswalk entries that found
them record that provenance in their notes.

The governance passes found two more candidates, recorded in `unmapped` rather
than written as obligations here: provenance marking of generated content (EU
AI Act Art. 50(2), NIST AI 600-1 §2.8), and a human-initiated stop reaching the
same safe path as a budget stop (noted under Art. 14(4)(e)).
