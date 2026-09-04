# Guidance

Non-normative commentary, one file per obligation, keyed by id.

**The catalog is the authority.** `catalog/AAC-0109.yaml` says what you must
satisfy; `guidance/AAC-0109.yaml` explains it. Guidance may never restate,
qualify or extend a `statement` — if the two ever disagree, the catalog wins and
the guidance is a bug.

That separation is the point rather than a formality. The statements are terse
because terse is what makes them enforceable and unambiguous, and terse is also
what makes them hard to meet for the first time. Both properties are wanted, so
they live in different files. The precedent is a standard and its companion
guide: one is normative and nearly unreadable, the other is what people actually
use, and nobody confuses them.

## Why structured fields rather than prose

Five fields, all optional:

| field | answers |
|---|---|
| `plain` | what it means in ordinary words |
| `why` | the failure it exists to prevent |
| `example` | one concrete instance of that failure |
| `detect` | how you would know you have it — what a test looks like |
| `not_this` | neighbouring obligations that do **not** cover this, and why |

Free-form prose was the obvious alternative and was rejected: a blank page
invites a second statement of the obligation, written slightly differently, which
is exactly the drift this directory must not create. Fields make the commentary
*answer questions about* the obligation rather than re-issue it.

`not_this` earns its place. AAC-0109's own statement does this work inline —
*"hard non-termination and path length are separate obligations and neither
covers this"* — and it is the most useful sentence in the entry. Most obligations
are misunderstood by being confused with their neighbours, not by being unclear
on their own.

## Coverage

Guidance is written where there is something real to say. An obligation with no
file renders normally and says guidance has not been written yet, which is honest
and beats a page of padding. Padding is worse than terseness: it hides the
statement without adding anything.
