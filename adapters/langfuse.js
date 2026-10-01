/*
 * Langfuse score export -> partial coverage results.
 *
 * Translation only. Reads scores a Langfuse project already holds — written by
 * its evaluators, by a human in an annotation queue, or by your own code
 * through the API — and never computes, compares or thresholds one. A score's
 * verdict is read as the platform holds it, or it is `unknown`.
 *
 * Where the file comes from: the public scores API, saved as it answers.
 *
 *   GET /api/public/v3/scores?fields=details,subject   (Langfuse v4; cursor pages)
 *   GET /api/public/v2/scores                          (Langfuse v3; page/totalPages)
 *
 * One response page `{ data, meta }`, an array of such pages, or a bare array
 * of scores. Both shapes of a score are read: v2 carries `value` as a number
 * with `stringValue` beside it and `traceId` at the top level; v3 carries
 * `value` typed by `dataType` (a boolean for BOOLEAN) and the scored entity
 * under `subject`. v3 returns `metadata` and `comment` only when `fields`
 * includes `details` — without it, no in-band declaration survives the export,
 * and the adapter says so.
 *
 * An obligation is declared on the score, checked in this order:
 *
 *   1. `metadata.aac` — "AAC-0028", or a list
 *   2. an identifier in the score name — "AAC-0028 order status matches store"
 *   3. a mapping file keyed by obligation, listing score names exactly
 *        AAC-0028: [watch.W-01]
 *
 * The verdict, checked in this order — never a threshold:
 *
 *   1. `metadata["aac.outcome"]`: pass | fail | error | unknown | skipped,
 *      as the writer of the score stated it. `skipped` is a check that exists
 *      and did not run: `ran: false`, never coverage.
 *   2. A BOOLEAN score: true is pass, false is fail — the score's name states
 *      what should hold. Where the name states what should NOT hold
 *      ("hallucination"), say so with `metadata["aac.pass"]: false`, or list
 *      the name under `inverted` in aac.config.yaml.
 *   3. Anything else — NUMERIC, CATEGORICAL, TEXT, CORRECTION — is `unknown`.
 *      Langfuse stores a number; the threshold that would make it a verdict
 *      belongs to the adopter, and comparing the two would be scoring.
 *
 * The mechanism is never inferred from Langfuse's `source`. EVAL covers both
 * LLM-as-a-judge and code evaluators, and the API accepts `source: ANNOTATION`
 * from a program, so no source names a mechanism faithfully. It comes from
 * `metadata["aac.mechanism"]`, or the source block's `mechanisms` — a list, or
 * a map keyed by Langfuse source (`{ EVAL: [M3], ANNOTATION: [M6], API: [M5] }`).
 * A declared score with neither is dropped with a warning: a guess here would
 * decide which judge obligations the report owes.
 *
 * Many scores per obligation is the normal case — an online evaluator scores
 * every sampled trace. They fold into one result per obligation, mechanism set
 * and stage set: worst outcome wins, as it does in the merge, and evidence is
 * bounded to `maxRefs` (default 5) scored entities, failing ones first, with
 * the totals in the note.
 */

const ID = /AAC[-_]?(\d{4})/gi;
const MAX_REFS = 5;
const RANK = { error: 3, fail: 2, unknown: 1, pass: 0 };
const OUTCOMES = new Set(["pass", "fail", "error", "unknown", "skipped"]);

const ids = (s) => {
  if (s === undefined || s === null) return [];
  const out = new Set();
  for (const v of Array.isArray(s) ? s : [s]) {
    for (const m of String(v).matchAll(ID)) out.add(`AAC-${m[1]}`);
  }
  return [...out];
};

const list = (v) =>
  v === undefined || v === null ? null
  : (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map(String).filter(Boolean);

/*
 * The score rows and the meta of the last page, so an export that stopped
 * before the last page is reported rather than read as the whole history.
 */
function locate(doc, resultsPath) {
  if (resultsPath) {
    const rows = resultsPath.split(".").reduce((o, k) => (o == null ? o : o[k]), doc);
    return { rows: Array.isArray(rows) ? rows : [], meta: null };
  }
  const isPage = (p) => p && typeof p === "object" && !Array.isArray(p) && Array.isArray(p.data);
  if (isPage(doc)) return { rows: doc.data, meta: doc.meta || null };
  if (Array.isArray(doc) && doc.length && doc.every(isPage)) {
    return { rows: doc.flatMap((p) => p.data), meta: doc[doc.length - 1].meta || null };
  }
  if (Array.isArray(doc)) return { rows: doc, meta: null };
  if (doc && Array.isArray(doc.scores)) return { rows: doc.scores, meta: doc.meta || null };
  return { rows: [], meta: null };
}

function partial(meta) {
  if (!meta) return null;
  if (meta.cursor) return "the export's last page carries a cursor: later pages were not saved";
  if (Number.isInteger(meta.page) && Number.isInteger(meta.totalPages) && meta.page < meta.totalPages) {
    return `the export ends at page ${meta.page} of ${meta.totalPages}: later pages were not saved`;
  }
  return null;
}

/* What the score is attached to, from either API version. */
function subjectOf(s) {
  if (s.subject && typeof s.subject === "object") {
    const k = s.subject.kind;
    return { kind: k, id: s.subject.id, trace: k === "trace" ? s.subject.id : s.subject.traceId };
  }
  if (s.datasetRunId) return { kind: "experiment", id: s.datasetRunId, trace: s.traceId };
  if (s.observationId) return { kind: "observation", id: s.observationId, trace: s.traceId };
  if (s.traceId) return { kind: "trace", id: s.traceId, trace: s.traceId };
  if (s.sessionId) return { kind: "session", id: s.sessionId };
  return { kind: "score", id: s.id };
}

/* The boolean a BOOLEAN score holds: v3 a boolean, v2 1/0 beside "True"/"False". */
function truth(s) {
  if (typeof s.value === "boolean") return s.value;
  if (s.value === 1 || s.value === 0) return s.value === 1;
  if (typeof s.stringValue === "string" && /^(true|false)$/i.test(s.stringValue)) {
    return s.stringValue.toLowerCase() === "true";
  }
  return null;
}

function verdict(s, metadata, inverted) {
  const stated = metadata["aac.outcome"];
  if (stated !== undefined && OUTCOMES.has(String(stated).toLowerCase())) return String(stated).toLowerCase();
  if (String(s.dataType).toUpperCase() !== "BOOLEAN") return "unknown";
  const t = truth(s);
  if (t === null) return "unknown";
  const passWhen = metadata["aac.pass"] !== undefined
    ? !/^(false|0)$/i.test(String(metadata["aac.pass"]))
    : !inverted.has(s.name);
  return t === passWhen ? "pass" : "fail";
}

function mechanismsOf(metadata, source, configured) {
  const own = list(metadata["aac.mechanism"]);
  if (own) return own;
  if (Array.isArray(configured)) return configured.map(String);
  if (configured && typeof configured === "object") {
    const bySource = configured[String(source || "").toUpperCase()];
    if (bySource) return list(bySource);
  }
  return null;
}

function extract(json, opts = {}) {
  const doc = typeof json === "string" ? JSON.parse(json) : json;
  const { rows, meta } = locate(doc, opts.resultsPath);
  const warnings = [];
  extract.warnings = warnings;
  const results = [];

  if (!rows.length) {
    warnings.push("no Langfuse scores found in the file; save the response of GET /api/public/v3/scores, or set resultsPath");
    return results;
  }
  const cut = partial(meta);
  if (cut) warnings.push(cut);
  if (rows.some((s) => s && typeof s === "object" && !("metadata" in s))) {
    warnings.push("scores without metadata: a v3 export needs fields=details, or metadata.aac and comments are lost");
  }

  // mapping: { "AAC-0028": ["watch.W-01", ...] } — exact score names
  const byName = new Map();
  const unmatched = new Set();
  for (const [id, names] of Object.entries(opts.mapping || {})) {
    for (const n of [].concat(names)) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(...ids(id));
      unmatched.add(n);
    }
  }
  const inverted = new Set(list(opts.inverted) || []);
  const maxRefs = Number.isInteger(opts.maxRefs) && opts.maxRefs > 0 ? opts.maxRefs : MAX_REFS;
  const noMechanism = new Set();
  const seen = new Set();
  const groups = new Map();

  for (const s of rows) {
    if (!s || typeof s !== "object" || !s.name) continue;
    if (s.id && seen.has(s.id)) continue; // overlapping pages
    if (s.id) seen.add(s.id);
    const metadata = s.metadata && typeof s.metadata === "object" ? s.metadata : {};

    if (byName.has(s.name)) unmatched.delete(s.name);
    const inband = ids(metadata.aac);
    const claims = inband.length ? inband : ids(s.name).length ? ids(s.name) : byName.get(s.name) || [];
    if (!claims.length) continue;

    const mechanisms = mechanismsOf(metadata, s.source, opts.mechanisms);
    if (!mechanisms) { noMechanism.add(s.name); continue; }

    const subject = subjectOf(s);
    const stages = list(metadata["aac.stage"]) || opts.stages || [subject.kind === "experiment" ? "S3" : "S5"];
    const outcome = verdict(s, metadata, inverted);
    const evidence = {
      type: String(s.source).toUpperCase() === "ANNOTATION" ? "annotation" : "experiment",
      ref: `${s.name} @ ${subject.kind}:${subject.id}`,
      ...(opts.url && subject.trace ? { url: `${String(opts.url).replace(/\/+$/, "")}/traces/${subject.trace}` } : {}),
      ...(s.timestamp ? { at: String(s.timestamp).replace(/\.\d+Z$/, "Z") } : {}),
    };

    for (const c of claims) {
      const key = `${c}|${mechanisms.join(" ")}|${stages.join(" ")}`;
      if (!groups.has(key)) groups.set(key, { case: c, mechanisms, stages, scores: [] });
      groups.get(key).scores.push({ name: s.name, outcome, evidence, comment: s.comment });
    }
  }

  for (const n of noMechanism) {
    warnings.push(`score "${n}" declares an obligation but no mechanism: set metadata aac.mechanism or the source's mechanisms`);
  }
  for (const n of unmatched) warnings.push(`mapping names a score that is not in the export: ${n}`);

  for (const g of groups.values()) {
    const ran = g.scores.filter((x) => x.outcome !== "skipped");
    const shown = (xs) => [...xs]
      .sort((a, b) => RANK[b.outcome] - RANK[a.outcome])
      .slice(0, maxRefs)
      .map((x) => x.evidence);
    const names = [...new Set(g.scores.map((x) => x.name))].join(", ");

    if (!ran.length) {
      // Every score said the check did not run: named, never coverage.
      results.push({ ran: false, case: g.case, outcome: "unknown", mechanisms: g.mechanisms, stages: g.stages, evidence: shown(g.scores) });
      continue;
    }
    const outcome = ran.reduce((a, x) => (RANK[x.outcome] > RANK[a] ? x.outcome : a), "pass");
    const count = (o) => ran.filter((x) => x.outcome === o).length;
    const tally = ["fail", "error", "unknown", "pass"].filter(count).map((o) => `${count(o)} ${o}`).join(", ");
    const why = ran.filter((x) => (x.outcome === "fail" || x.outcome === "error") && x.comment)
      .slice(0, 2).map((x) => String(x.comment).trim());
    const more = ran.length > maxRefs ? `; ${maxRefs} of ${ran.length} shown` : "";
    const note = [`langfuse ${names}: ${ran.length} score${ran.length === 1 ? "" : "s"} (${tally})${more}`, ...why].join(" | ").slice(0, 300);
    results.push({ case: g.case, outcome, mechanisms: g.mechanisms, stages: g.stages, evidence: shown(ran), note });
  }
  return results;
}

extract.warnings = [];

module.exports = { name: "langfuse", extract };
