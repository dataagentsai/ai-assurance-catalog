# Patterns

**Informative. Nothing here is required for conformance.**

A pattern is a *diagnosis* — a known failure shape, how it presents, why it
happens, and which obligations would surface it. An obligation says "you must be
able to answer this question." A pattern says "here is a failure we have seen,
and here is what catches it."

Keeping them apart is what lets a case statement stay short. The pattern is the
answer to *why does this obligation exist?*, and that answer does not belong
inside the obligation.

## The relationship is crosswalk-shaped

Patterns map **into** the catalog exactly the way a crosswalk entry does. They
are not cases, they carry a separate identifier namespace, and they version
independently.

```yaml
- id: AACP-0001
  name: Retry amplification
  archetypes: [A1, A2, A3]
  symptom: Spend rises while request volume is flat.
  mechanism: >-
    Retries are recorded against the attempt rather than the task that caused
    them, so any metric with calls in the denominator averages it away.
  caught_by: [AAC-0008, AAC-0102, AAC-0104]
```

Identifiers are flat and permanent, with domain as metadata — the same rule the
catalog applies to archetypes, applied to ourselves. `patterns/cost.yaml` is a
presentational grouping, not part of any identity.

## An empty `caught_by` is a finding

This is the part that earns the directory.

A pattern nobody can catch is a **hole in the catalog**, not an omission in the
pattern. The schema permits `caught_by: []` only alongside a `gap_note` stating
what obligation is missing, and the linter reports every one of them prominently
rather than passing silently.

That makes this directory a coverage-validation engine pointed at the catalog.
The first pass already found two:

| Pattern | Missing obligation |
|---|---|
| `AACP-0006` Cancellation is not propagated | Nothing requires an abandoned request to stop costing money |
| `AACP-0007` Volatile prompt prefix defeats caching | Nothing requires prompt construction to preserve cache prefixes, or hit rate to be monitored |

Both are tracked in [CHANGELOG.md](../CHANGELOG.md). Closing a gap means writing
a case and adding its identifier here — after which the gap note is removed.

## A pattern can say how it shows: `signal`

Since 0.16.0 a pattern may carry a `signal` — what a monitor reads to see it in a
running system before the symptom does:

```yaml
signal:
  level: turn          # turn · conversation · window
  reads: [tool name, tool arguments, tool outcome]
  detect: A write tool is called again with the same arguments after it was refused.
  threshold: any
  severity: ticket     # page · ticket · trend
```

`turn` signals are decidable from one unit of work's record (AHC-0114),
`conversation` ones from the units of one session, and `window` ones are rates
against the system's own baseline, for whatever evaluates alert rules. The
signal is as informative as the pattern: a starting rule and a starting
threshold, to be tuned, never a conformance requirement.

This is what turns the directory into a rule catalog a monitor can implement:
[patterns/operations.yaml](operations.yaml) holds the ones that only exist in
production — contradictions between a reply and a tool result, writes retried
after a refusal, a user repeating themselves, a rule that starts refusing
everything, a deployment gone quiet.

## Scope, and an honest tension

[docs/NON-GOALS.md](../docs/NON-GOALS.md) commits this project to authoring no
taxonomies, on the grounds that incumbents own them and restating their work
makes rivals out of allies.

A pattern catalog *is* a taxonomy, so this directory stretches that rule. The
argument for it:

- **No incumbent owns this ground.** OWASP LLM10 is *Unbounded Consumption*, a
  security framing rather than an economic one. Nobody publishes operational
  cost or agent-trajectory anti-patterns for LLM systems.
- **It is explicitly non-normative** and lives outside `catalog/`, so it cannot
  be mistaken for an obligation or claimed as conformance.
- **It strengthens the discipline rather than diluting it** — every pattern must
  terminate in a case identifier or declare itself a gap. A pattern cannot exist
  here as free-floating commentary.

Where an incumbent *does* own the ground — prompt injection, data poisoning,
excessive agency — a pattern still cites the case, and the crosswalk carries the
reference to OWASP or ATLAS. Patterns do not restate threats.

## Contributing a pattern

The bar is narrower than it looks. A pattern must:

1. Describe something **observed in a real system**, not derived from first
   principles.
2. Have a **symptom written for someone who does not yet know the cause** — if
   the symptom only makes sense once you know the mechanism, it will not help
   anyone recognise it.
3. Terminate in `caught_by` identifiers **or** a `gap_note` naming the missing
   obligation.
4. Not restate a threat an incumbent framework already describes.

Run `npm run lint` before opening a pull request.
