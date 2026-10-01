/*
 * LangSmith feedback export -> partial coverage results.
 *
 * Translation only. Reads feedback a LangSmith workspace already holds —
 * written by `evaluate()` evaluators, by online evaluators, by a human in the
 * app or an annotation queue, or by your own code through `create_feedback` —
 * and never computes, compares or thresholds one. A feedback's verdict is read
 * as the platform holds it, or it is `unknown`.
 *
 * Where the file comes from: the feedback list API, saved as it answers.
 *
 *   GET /api/v1/feedback?session=<project or experiment id>   (offset/limit, limit <= 100)
 *
 * The response is a bare JSON array of feedback; there is no envelope and no
 * cursor. The file may be one saved page, an array of saved pages, the SDK's
 * `client.list_feedback(...)` dumped with `model_dump(mode="json")` (a bare
 * array, or one object per line), or anything else reached with resultsPath.
 * Field names are the API's: id, run_id, trace_id, session_id, key, score,
 * value, comment, correction, feedback_source { type, metadata, user_id },
 * extra, created_at, comparative_experiment_id.
 *
 * An obligation is declared on the feedback, checked in this order:
 *
 *   1. `extra.aac`, then `feedback_source.metadata.aac` — "AAC-0028", or a list
 *      (`extra=` on create_feedback or on an evaluator's result; `source_info=`
 *      or `evaluator_info` land in feedback_source.metadata)
 *   2. an identifier in the feedback key — "AAC-0028 order status matches store"
 *   3. a mapping file keyed by obligation, listing feedback keys exactly
 *        AAC-0028: [watch_w01]
 *
 * The verdict, checked in this order — never a threshold:
 *
 *   1. `aac.outcome` (in extra or source metadata): pass | fail | error |
 *      unknown | skipped, as the writer stated it. `skipped` is a check that
 *      exists and did not run: `ran: false`, never coverage.
 *   2. `extra.error: true` — what `evaluate()` writes when an evaluator raised.
 *      The check ran and could not decide: `error`.
 *   3. A boolean `score` is its own verdict: true is pass, false is fail — the
 *      key states what should hold. A numeric score of exactly 1 or 0 is read
 *      the same way only for keys listed under `binary` in aac.config.yaml:
 *      LangSmith stores booleans and numbers in one field and the feedback row
 *      does not say which a key is, so the adopter says it. Where the key states
 *      what should NOT hold ("hallucination"), say so with `aac.pass: false`, or
 *      list it under `inverted`.
 *   4. Anything else — a 0.12, a 3 of 5, a categorical `value`, a correction —
 *      is `unknown`. The threshold that would make a number a verdict belongs
 *      to the adopter, and comparing the two would be scoring.
 *
 * The mechanism is never inferred from `feedback_source.type`. `evaluate()`
 * writes every evaluator's feedback as `model`, an exact-match function
 * included; `api` is whatever code called create_feedback. It comes from
 * `aac.mechanism`, or the source block's `mechanisms` — a list, or a map keyed
 * by feedback source type (`{ model: [M3], app: [M6], api: [M1] }`). A
 * declared feedback with neither is dropped with a warning: a guess here would
 * decide which judge obligations the report owes.
 *
 * Many feedback rows per obligation is the normal case — an evaluator scores
 * every example, an online evaluator every sampled run. They fold into one
 * result per obligation, mechanism set and stage set: worst outcome wins, and
 * evidence is bounded to `maxRefs` (default 5) runs, failing ones first, with
 * the totals in the note.
 */

const ID = /AAC[-_]?(\d{4})/gi;
const MAX_REFS = 5;
const PAGE = 100; // the API's default and maximum limit
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

const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);

/* JSON, or one feedback object per line as an SDK loop tends to write it. */
function parse(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => l.startsWith("{"))) return lines.map((l) => JSON.parse(l));
    throw e;
  }
}

/*
 * The feedback rows, and the saved pages when the file is a list of them, so
 * an export that stopped at a full page is reported rather than read as the
 * whole history.
 */
function locate(doc, resultsPath) {
  if (resultsPath) {
    const rows = resultsPath.split(".").reduce((o, k) => (o == null ? o : o[k]), doc);
    return { rows: Array.isArray(rows) ? rows : [], pages: null };
  }
  if (Array.isArray(doc) && doc.length && doc.every(Array.isArray)) return { rows: doc.flat(), pages: doc };
  if (Array.isArray(doc)) return { rows: doc, pages: [doc] };
  if (isObj(doc) && Array.isArray(doc.feedback)) return { rows: doc.feedback, pages: null };
  return { rows: [], pages: null };
}

function partial(pages, pageSize) {
  if (!pages || !pages.length) return null;
  const last = pages[pages.length - 1].length;
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize
    : pages.length > 1 ? pages[0].length : PAGE;
  if (last && last >= size) {
    return `the export ends on a full page (${last} rows): if it was saved page by page, later offsets were not saved`;
  }
  return null;
}

/* What the feedback is attached to. */
function subjectOf(f) {
  if (f.run_id && (f.run_id === f.trace_id || f.is_root === true)) return { kind: "trace", id: f.run_id, trace: f.run_id };
  if (f.run_id) return { kind: "run", id: f.run_id, trace: f.trace_id || null };
  // No run: feedback on the project or experiment itself (a summary evaluator).
  if (f.session_id) return { kind: "project", id: f.session_id };
  return { kind: "feedback", id: f.id };
}

/* The in-band metadata: extra wins over feedback_source.metadata, key by key. */
function metadataOf(f) {
  const src = isObj(f.feedback_source) && isObj(f.feedback_source.metadata) ? f.feedback_source.metadata : {};
  const extra = isObj(f.extra) ? f.extra : {};
  return { ...src, ...extra };
}

function verdict(f, md, binary, inverted) {
  const stated = md["aac.outcome"];
  if (stated !== undefined && OUTCOMES.has(String(stated).toLowerCase())) return String(stated).toLowerCase();
  if (isObj(f.extra) && f.extra.error === true) return "error";
  let t = null;
  if (typeof f.score === "boolean") t = f.score;
  else if (binary.has(f.key) && (f.score === 1 || f.score === 0)) t = f.score === 1;
  if (t === null) return "unknown";
  const passWhen = md["aac.pass"] !== undefined
    ? !/^(false|0)$/i.test(String(md["aac.pass"]))
    : !inverted.has(f.key);
  return t === passWhen ? "pass" : "fail";
}

function mechanismsOf(md, type, configured) {
  const own = list(md["aac.mechanism"]);
  if (own) return own;
  if (Array.isArray(configured)) return configured.map(String);
  if (isObj(configured)) {
    const want = String(type || "").toLowerCase();
    const hit = Object.keys(configured).find((k) => k.toLowerCase() === want);
    if (hit) return list(configured[hit]);
  }
  return null;
}

const instant = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d+Z$/, "Z");
};

function link(base, f, subject) {
  if (!base || !f.session_id) return null;
  const root = `${String(base).replace(/\/+$/, "")}/projects/p/${f.session_id}`;
  if (!f.run_id) return root;
  return `${root}/r/${f.run_id}${subject.trace && subject.trace !== f.run_id ? `?trace_id=${subject.trace}` : ""}`;
}

function extract(raw, opts = {}) {
  const doc = parse(raw);
  const { rows, pages } = locate(doc, opts.resultsPath);
  const warnings = [];
  extract.warnings = warnings;
  const results = [];

  if (!rows.length) {
    warnings.push("no LangSmith feedback found in the file; save the response of GET /api/v1/feedback, or set resultsPath");
    return results;
  }
  const cut = partial(pages, opts.pageSize);
  if (cut) warnings.push(cut);
  if (rows.some((f) => isObj(f) && !("extra" in f) && !("feedback_source" in f))) {
    warnings.push("feedback without extra or feedback_source: the export was trimmed, and in-band aac declarations are lost");
  }

  // mapping: { "AAC-0028": ["watch_w01", ...] } — exact feedback keys
  const byKey = new Map();
  const unmatched = new Set();
  for (const [id, keys] of Object.entries(opts.mapping || {})) {
    for (const k of [].concat(keys)) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(...ids(id));
      unmatched.add(k);
    }
  }
  const binary = new Set(list(opts.binary) || []);
  const inverted = new Set(list(opts.inverted) || []);
  const maxRefs = Number.isInteger(opts.maxRefs) && opts.maxRefs > 0 ? opts.maxRefs : MAX_REFS;
  const noMechanism = new Set();
  const seen = new Set();
  const groups = new Map();

  for (const f of rows) {
    if (!isObj(f) || !f.key) continue;
    if (f.id && seen.has(f.id)) continue; // overlapping pages
    if (f.id) seen.add(f.id);
    const md = metadataOf(f);

    if (byKey.has(f.key)) unmatched.delete(f.key);
    const inband = ids(md.aac);
    const claims = inband.length ? inband : ids(f.key).length ? ids(f.key) : byKey.get(f.key) || [];
    if (!claims.length) continue;

    const type = isObj(f.feedback_source) ? f.feedback_source.type : null;
    const mechanisms = mechanismsOf(md, type, opts.mechanisms);
    if (!mechanisms) { noMechanism.add(f.key); continue; }

    const subject = subjectOf(f);
    const stages = list(md["aac.stage"]) || opts.stages || [f.comparative_experiment_id ? "S3" : "S5"];
    const outcome = verdict(f, md, binary, inverted);
    const url = link(opts.url, f, subject);
    const at = f.created_at ? instant(f.created_at) : null;
    const evidence = {
      type: String(type).toLowerCase() === "app" ? "annotation" : "experiment",
      ref: `${f.key} @ ${subject.kind}:${subject.id}`,
      ...(url ? { url } : {}),
      ...(at ? { at } : {}),
    };

    for (const c of claims) {
      const key = `${c}|${mechanisms.join(" ")}|${stages.join(" ")}`;
      if (!groups.has(key)) groups.set(key, { case: c, mechanisms, stages, rows: [] });
      groups.get(key).rows.push({ key: f.key, outcome, evidence, comment: f.comment });
    }
  }

  for (const k of noMechanism) {
    warnings.push(`feedback "${k}" declares an obligation but no mechanism: set aac.mechanism or the source's mechanisms`);
  }
  for (const k of unmatched) warnings.push(`mapping names a feedback key that is not in the export: ${k}`);

  for (const g of groups.values()) {
    const ran = g.rows.filter((x) => x.outcome !== "skipped");
    const shown = (xs) => [...xs]
      .sort((a, b) => RANK[b.outcome] - RANK[a.outcome])
      .slice(0, maxRefs)
      .map((x) => x.evidence);
    const keys = [...new Set(g.rows.map((x) => x.key))].join(", ");

    if (!ran.length) {
      // Every row said the check did not run: named, never coverage.
      results.push({ ran: false, case: g.case, outcome: "unknown", mechanisms: g.mechanisms, stages: g.stages, evidence: shown(g.rows) });
      continue;
    }
    const outcome = ran.reduce((a, x) => (RANK[x.outcome] > RANK[a] ? x.outcome : a), "pass");
    const count = (o) => ran.filter((x) => x.outcome === o).length;
    const tally = ["fail", "error", "unknown", "pass"].filter(count).map((o) => `${count(o)} ${o}`).join(", ");
    const why = ran.filter((x) => (x.outcome === "fail" || x.outcome === "error") && x.comment)
      .slice(0, 2).map((x) => String(x.comment).trim());
    const more = ran.length > maxRefs ? `; ${maxRefs} of ${ran.length} shown` : "";
    const note = [`langsmith ${keys}: ${ran.length} feedback (${tally})${more}`, ...why].join(" | ").slice(0, 300);
    results.push({ case: g.case, outcome, mechanisms: g.mechanisms, stages: g.stages, evidence: shown(ran), note });
  }
  return results;
}

extract.warnings = [];

module.exports = { name: "langsmith", extract };
