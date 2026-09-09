// lib/feat-aggregate.mjs — AGGREGATE-ONLY features, SPEC B.6.
// R1 §7b: aggregation is the ONLY short-text lever with evidence behind it. SPEC decision 11
// makes --aggregate a required deliverable, not an option: per-message chat verdicts are inputs
// to it and are never surfaced alone as likely_*.
import { mean, sd, clamp, words } from './tokenize.mjs';
import { caseFold } from './unicode.mjs';
import { TR_STOP, EN_STOP } from './langid.mjs';

const G_AGG = 'aggregate';

const msg_length_uniformity = {
  id: 'msg_length_uniformity', group: G_AGG, dir: 'llm', langs: 'any', scope: 'AGGREGATE-ONLY',
  confidence: 'MED', transform: 'continuous', minMessages: 5,
  note: 'a person answering a fixed form, or a shift worker sending the same confirmation all '
    + 'day, is uniform too. Message length is generator CONFIG as much as style (SPEC B.7).',
  compute(agg) {
    const lens = agg.messages.map((m) => [...m.text].length);
    const m = mean(lens);
    if (!(m > 0)) return null;
    return { value: 1 - clamp(sd(lens) / m, 0, 1), matched: `mean ${m.toFixed(0)} chars, sd ${sd(lens).toFixed(0)}` };
  },
};

const template_repetition = {
  id: 'template_repetition', group: G_AGG, dir: 'llm', langs: 'any', scope: 'AGGREGATE-ONLY',
  confidence: 'HIGH', transform: 'binary', minMessages: 5,
  note: 'proves REUSE, not machine authorship: a human with a snippet library, a signature line, '
    + 'or a standard greeting produces identical 6-grams across messages every day.',
  compute(agg) {
    const seen = new Map();
    agg.messages.forEach((m, mi) => {
      const toks = words(m.folded).map((w) => w.t);
      const local = new Set();
      for (let i = 0; i + 6 <= toks.length; i++) local.add(toks.slice(i, i + 6).join(' '));
      for (const g of local) {
        if (!seen.has(g)) seen.set(g, new Set());
        seen.get(g).add(mi);
      }
    });
    let best = null;
    for (const [g, set] of seen) {
      if (set.size >= 3 && (best === null || set.size > best.n || (set.size === best.n && g < best.g))) {
        best = { g, n: set.size };
      }
    }
    return best ? { value: 1, matched: `"${best.g}" in ${best.n} messages` } : null;
  },
};

const PER_MSG_AXES = ['terminalPunct', 'caps', 'emoji', 'elongation'];

const cross_msg_style_variance = {
  id: 'cross_msg_style_variance', group: G_AGG, dir: 'human', langs: 'any', scope: 'AGGREGATE-ONLY',
  confidence: 'MED', transform: 'continuous', minMessages: 5,
  note: 'humans drift, but so does a generator with a temperature above zero and a varying '
    + 'prompt. Low variance is weak evidence; high variance is weaker.',
  compute(agg) {
    const vecs = agg.messages.map((m) => m.axes);
    const sds = PER_MSG_AXES.map((k) => {
      const col = vecs.map((v) => v[k]);
      const s = sd(col);
      return Number.isFinite(s) ? s : 0;
    });
    return { value: mean(sds), matched: PER_MSG_AXES.map((k, i) => `${k} sd ${sds[i].toFixed(2)}`).join(', ') };
  },
};

const idiolect_stability = {
  id: 'idiolect_stability', group: G_AGG, dir: 'human', langs: 'any', scope: 'AGGREGATE-ONLY',
  confidence: 'HIGH', transform: 'rate', minMessages: 5,
  note: 'ZERO-DEPENDENCY CAVEAT: with no dictionary this is RARE-TOKEN repetition, not true '
    + 'non-dictionary detection (SPEC B.7 drops typo features for exactly this reason). A '
    + 'recurring hotel name, a product code or a city spelt the same way twice fires it.',
  compute(agg) {
    const stop = agg.lang === 'tr' ? TR_STOP : EN_STOP;
    const perMsg = agg.messages.map((m) => new Set(
      words(m.folded).map((w) => w.t).filter((t) => t.length >= 5 && !stop.has(t) && !agg.lexPhrases.has(t)),
    ));
    const counts = new Map();
    perMsg.forEach((set) => { for (const t of set) counts.set(t, (counts.get(t) ?? 0) + 1); });
    const n = agg.messages.length;
    const repeated = [...counts.entries()]
      .filter(([, c]) => c >= 2 && c <= Math.max(2, Math.ceil(n * 0.4)))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (repeated.length === 0) return null;
    return { value: repeated.length,
      matched: repeated.slice(0, 4).map(([t, c]) => `${t} x${c}`).join(', ') };
  },
};

const BARE_TOKEN = /^\s*(\p{Nd}[\p{Nd}.,:/-]*|\p{L}{1,12})\s*$/u;

const bare_token_turn_rate = {
  id: 'bare_token_turn_rate', group: G_AGG, dir: 'human', langs: 'any', scope: 'AGGREGATE-ONLY',
  confidence: 'MED', transform: 'continuous', minMessages: 5,
  note: 'DATA: 11.2% of human messages are unclassifiably short vs 0.9% of generated ones — but '
    + 'that is ONE generator\'s configuration, not a law. A generator told to send short turns '
    + 'erases this feature completely.',
  compute(agg) {
    const n = agg.messages.filter((m) => {
      const t = words(m.text).length;
      return t <= 2 || BARE_TOKEN.test(m.text.trim());
    }).length;
    return { value: n / agg.messages.length, matched: `${n}/${agg.messages.length} bare turns` };
  },
};

export const AGG_FEATURES = [
  msg_length_uniformity, template_repetition, cross_msg_style_variance,
  idiolect_stability, bare_token_turn_rate,
];

/** Per-message style axes used by cross_msg_style_variance. Cheap, deliberately crude. */
export function messageAxes(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const term = lines.length ? lines.filter((l) => /[.!?؟۔]\s*$/u.test(l)).length / lines.length : 0;
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  const caps = letters.length ? letters.filter((c) => /\p{Lu}/u.test(c)).length / letters.length : 0;
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const elong = (text.match(/(\p{L})\1{2,}/gu) ?? []).length;
  return { terminalPunct: term, caps, emoji: Math.min(1, emoji / 3), elongation: Math.min(1, elong / 2) };
}

export function prepareAggregate(messages, lang, lexPhrases) {
  return {
    lang,
    lexPhrases,
    messages: messages.map((m) => ({
      id: m.id, text: m.text,
      folded: caseFold(m.text.normalize('NFC'), lang === 'tr' ? 'tr' : 'en'),
      axes: messageAxes(m.text),
    })),
  };
}
