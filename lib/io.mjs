// lib/io.mjs — the ONLY module in the shipped tool that touches the filesystem, and it uses
// Node builtins only (no third-party dependency anywhere in this repo). Kept out of
// stylometry.mjs so that the zero-dependency grep on the entry point prints nothing, and out of
// lib/detect.mjs so that detect() stays a pure function.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const HOME = dirname(dirname(fileURLToPath(import.meta.url)));

export function readText(path) {
  const buf = readFileSync(path);
  const s = buf.toString('utf8');
  // A lone U+FFFD that is not in the source bytes means the input was not valid UTF-8.
  if (s.includes('�') && !buf.includes(0xef)) throw new Error(`not valid UTF-8: ${path}`);
  return s;
}

export function readJson(path) { return JSON.parse(readText(path)); }

export function loadResources(opts = {}) {
  const lexicon = readJson(opts.lexicon ?? join(HOME, 'lexicon.v1.json'));
  const weights = readJson(opts.weights ?? join(HOME, 'weights.v1.json'));
  const markersPath = opts.markers ?? join(HOME, 'markers.json');
  const markers = existsSync(markersPath) ? readJson(markersPath) : [];
  return { lexicon, weights, markers };
}

export function readStdinSync() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function readJsonl(path) {
  const out = [];
  const text = readText(path);
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    try { out.push({ ok: true, row: JSON.parse(line), lineNo: i + 1 }); }
    catch (e) { out.push({ ok: false, error: String(e.message), lineNo: i + 1 }); }
  });
  return out;
}

/** True when `metaUrl` is the module Node was started with. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

export { resolve, join, existsSync };
