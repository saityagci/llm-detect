// lib/lexicon.mjs — hand-rolled Aho-Corasick. SPEC §I B1 item 3: ONE pass over foldedLex,
// built once at module load, not 250 separate regex scans.
//
// Two matchers: a trie for contiguous phrases, and a small regex set for "gap" phrases written
// with "…" in lexicon-src (meaning "allow up to 60 characters of intervening text").
import { isWordChar } from './unicode.mjs';

const GAP = '…';

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

class Node {
  constructor() { this.next = new Map(); this.fail = null; this.out = []; }
}

export function buildMatcher(rows) {
  const root = new Node();
  const gaps = [];

  rows.forEach((row, id) => {
    if (row.phrase.includes(GAP)) {
      const parts = row.phrase.split(GAP).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return;
      const src = parts.map(escapeRe).join('[\\s\\S]{0,60}?');
      gaps.push({ id, re: new RegExp(src, 'gu'), row });
      return;
    }
    let node = root;
    for (const ch of row.phrase) {
      if (!node.next.has(ch)) node.next.set(ch, new Node());
      node = node.next.get(ch);
    }
    node.out.push(id);
  });

  // BFS: fail links + output merging
  const queue = [];
  for (const child of root.next.values()) { child.fail = root; queue.push(child); }
  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi];
    for (const [ch, child] of node.next) {
      let f = node.fail;
      while (f !== null && !f.next.has(ch)) f = f.fail;
      child.fail = f === null ? root : f.next.get(ch);
      child.out = child.out.concat(child.fail.out);
      queue.push(child);
    }
  }

  return { root, gaps, rows };
}

/** Is index `i` sentence/line-initial in `text` (ignoring whitespace, quotes and bullets)? */
function isInitial(text, i) {
  let k = i - 1;
  while (k >= 0 && /[\s"'“”‘’(\[\-*•>]/u.test(text[k])) k--;
  if (k < 0) return true;
  return /[.!?…؟۔:]/u.test(text[k]);
}

/**
 * search(matcher, text) -> [{id, row, start, end, matched}]
 * Word-boundary semantics: the character before the match and after the match must not be a
 * word character (letter / mark / number / underscore).
 */
export function search(matcher, text) {
  const hits = [];
  let node = matcher.root;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (node !== matcher.root && !node.next.has(ch)) node = node.fail ?? matcher.root;
    node = node.next.get(ch) ?? matcher.root;
    if (node.out.length === 0) continue;
    for (const id of node.out) {
      const row = matcher.rows[id];
      const end = i + 1;
      const start = end - row.phrase.length;
      if (start < 0) continue;
      if (isWordChar(text[start - 1])) continue;
      if (isWordChar(text[end])) continue;
      if (row.flags.includes('initial') && !isInitial(text, start)) continue;
      hits.push({ id, row, start, end, matched: text.slice(start, end) });
    }
  }
  for (const g of matcher.gaps) {
    g.re.lastIndex = 0;
    let m;
    while ((m = g.re.exec(text)) !== null) {
      const start = m.index, end = start + m[0].length;
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
      hits.push({ id: g.id, row: g.row, start, end, matched: m[0] });
      g.re.lastIndex = end;
    }
  }
  // Deterministic order: by start, then by longer match, then by phrase.
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start)
    || (a.row.phrase < b.row.phrase ? -1 : a.row.phrase > b.row.phrase ? 1 : 0));
  return hits;
}

/**
 * Greedy leftmost-longest: drop any hit that overlaps a longer hit already kept, so
 * "yardimci olabilirim" inside "size nasil yardimci olabilirim" is not counted twice and the
 * correlated block "nestled in the heart of" / "in the heart of the city" counts once.
 */
export function dropOverlapping(hits) {
  const ordered = hits.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start)
    || a.start - b.start
    || (a.row.phrase < b.row.phrase ? -1 : a.row.phrase > b.row.phrase ? 1 : 0));
  const keep = [];
  // D-10: the previous `keep.some(...)` scan was O(k^2) in hit count and was the whole of the
  // 5.2 s a 100k-line document cost. An offset-covered bitmap makes the sweep linear in the
  // total matched LENGTH (phrases are bounded), not quadratic in the number of hits.
  let maxEnd = 0;
  for (const h of hits) if (h.end > maxEnd) maxEnd = h.end;
  const covered = new Uint8Array(maxEnd);
  for (const h of ordered) {
    let clash = false;
    for (let i = h.start; i < h.end; i++) if (covered[i]) { clash = true; break; }
    if (clash) continue;
    for (let i = h.start; i < h.end; i++) covered[i] = 1;
    keep.push(h);
  }
  keep.sort((a, b) => a.start - b.start
    || (a.row.phrase < b.row.phrase ? -1 : a.row.phrase > b.row.phrase ? 1 : 0));
  return keep;
}
