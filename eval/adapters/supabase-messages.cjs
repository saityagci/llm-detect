#!/usr/bin/env node
/*
 * supabase-messages.cjs — OPTIONAL corpus adapter (HEAD-RULINGS R18).
 *
 * Pulls a chat-message table out of a Supabase project into a local, GITIGNORED
 * calibration corpus. It is not part of the shipped detector and nothing in the
 * detector imports it. It exists so that somebody with their own message store can
 * rebuild `eval/data/corpus_user_messages.json` in the shape run-eval.mjs expects.
 *
 * IT NEVER WRITES A SENDER ID. Sender identity leaves this script only as
 *   writer_id  : R0..Rn, assigned by the position of the id in --human-ids
 *   persona_id : "p" + sha256(salt + senderId).slice(0,12)
 *
 * Dependencies (dotenv, @supabase/supabase-js) are NOT vendored and NOT in package.json —
 * the shipped tool is zero-dependency. Point NODE_PATH at any node_modules that has them:
 *
 *   NODE_PATH=/path/to/some/node_modules node eval/adapters/supabase-messages.cjs \
 *     --env <env> --human-ids <ids> --out eval/data --dry-run
 *
 * Exit codes: 0 ok - 1 usage error - 2 environment/precondition error (missing env file,
 * unresolvable modules, output directory not gitignored) - 3 refused (no --i-have-approval).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const USAGE = `usage: [NODE_PATH=<node_modules>] node eval/adapters/supabase-messages.cjs \\
    --env <path to a .env with SUPABASE_URL and SUPABASE_SERVICE_KEY>   (required)
    --human-ids <comma list of sender ids that are known humans>        (required; mapped R0..Rn in order)
    --out <dir>                 output directory, MUST be gitignored    (default eval/data)
    --table <name>              (default messages)
    --role <value>              (default user; pass "" to disable the role filter)
    --synthetic-prefix <string> sender ids starting with this are machine personas (default 999)
    --salt <string>             persona hash salt (default: derived from the service key)
    --page <n>                  rows per request (default 1000)
    --dry-run                   count rows and exit; writes nothing, no approval needed
    --i-have-approval           required for a real pull (this performs a database read)`;

function die(code, msg) {
  process.stderr.write(String(msg).replace(/\s+$/, '') + '\n');
  process.exit(code);
}

function parseArgs(argv) {
  const o = {
    env: null, humanIds: null, out: 'eval/data', table: 'messages', role: 'user',
    syntheticPrefix: '999', salt: null, page: 1000, dryRun: false, approved: false,
  };
  const need = (i, f) => {
    if (i + 1 >= argv.length) die(1, `missing argument for ${f}\n${USAGE}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--env': o.env = need(i, a); i++; break;
      case '--human-ids': o.humanIds = need(i, a); i++; break;
      case '--out': o.out = need(i, a); i++; break;
      case '--table': o.table = need(i, a); i++; break;
      case '--role': o.role = need(i, a); i++; break;
      case '--synthetic-prefix': o.syntheticPrefix = need(i, a); i++; break;
      case '--salt': o.salt = need(i, a); i++; break;
      case '--page': o.page = Number(need(i, a)); i++; break;
      case '--dry-run': o.dryRun = true; break;
      case '--i-have-approval': o.approved = true; break;
      case '-h': case '--help': process.stdout.write(USAGE + '\n'); process.exit(0); break;
      default: die(1, `unknown flag: ${a}\n${USAGE}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- preconditions

function requireEnvFile(p) {
  if (!p) die(1, `--env is required.\n${USAGE}`);
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    die(2, `no env file at ${abs} - create one containing SUPABASE_URL=... and SUPABASE_SERVICE_KEY=... and pass it as --env <path>`);
  }
  return abs;
}

function requireIgnoredOutDir(dir) {
  const abs = path.resolve(dir);
  try {
    execFileSync('git', ['check-ignore', '-q', abs], { stdio: 'ignore' });
  } catch {
    die(2, `refusing to write: ${abs} is not gitignored - add it to .gitignore before pulling real messages (the output contains PII)`);
  }
  return abs;
}

function requireModules() {
  const missing = [];
  let dotenv = null;
  let createClient = null;
  try { dotenv = require('dotenv'); } catch { missing.push('dotenv'); }
  try { ({ createClient } = require('@supabase/supabase-js')); } catch { missing.push('@supabase/supabase-js'); }
  if (missing.length) {
    die(2, `cannot resolve ${missing.join(' and ')} - rerun as: NODE_PATH=/path/to/node_modules node eval/adapters/supabase-messages.cjs ${process.argv.slice(2).join(' ')}`);
  }
  return { dotenv, createClient };
}

// ---------------------------------------------------------------- identity

function makeHasher(salt) {
  const cache = new Map();
  return function hashSender(senderId) {
    if (cache.has(senderId)) return cache.get(senderId);
    const h = 'p' + crypto.createHash('sha256').update(salt + ' ' + senderId).digest('hex').slice(0, 12);
    cache.set(senderId, h);
    return h;
  };
}

// A last-ditch net: nothing that looks like a phone number may reach the output file
// in an identity field, ever. If one does, that is a bug and the run dies rather than writes.
// No ASCII \d anywhere in this tool: Arabic-Indic and Extended Arabic-Indic digits count too.
const PHONE_SHAPED = /\+?[0-9٠-٩۰-۹]{10,15}/u;

function assertNoSenderId(row) {
  for (const k of ['id', 'writer_id', 'persona_id', 'label', 'language', 'created_at']) {
    if (row[k] != null && PHONE_SHAPED.test(String(row[k]))) {
      die(2, `internal guard: phone-shaped digit run in field ${k} - refusing to write the corpus`);
    }
  }
}

// Message bodies keep their digits (dates, prices and room counts are the signal),
// but a 10-15 digit run inside a body is redacted to [NUM].
function scrubContent(s) {
  return String(s).replace(/\+?[0-9٠-٩۰-۹]{10,15}/gu, '[NUM]');
}

const TR_LETTERS = 'çğıİöşüÇĞÖŞÜ';

function detectLanguage(s) {
  const letters = String(s).match(/\p{L}/gu) || [];
  if (!letters.length) return 'unknown';
  let ar = 0;
  let tr = 0;
  for (const c of letters) {
    if (/\p{Script=Arabic}/u.test(c)) ar++;
    if (TR_LETTERS.includes(c)) tr++;
  }
  if (ar / letters.length >= 0.2) return 'ar';
  if (tr > 0) return 'tr';
  return 'en';
}

// ---------------------------------------------------------------- main

async function main() {
  const o = parseArgs(process.argv.slice(2));

  // Order matters: the env file is checked before anything expensive, so that a
  // --dry-run against a nonexistent env exits 2 with a one-line instruction.
  const envPath = requireEnvFile(o.env);
  if (!o.humanIds) die(1, `--human-ids is required.\n${USAGE}`);
  const humanIds = o.humanIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (!humanIds.length) die(1, `--human-ids parsed to nothing.\n${USAGE}`);
  if (!Number.isInteger(o.page) || o.page < 1 || o.page > 1000) die(1, '--page must be an integer 1..1000');

  const outDir = requireIgnoredOutDir(o.out);
  const { dotenv, createClient } = requireModules();

  dotenv.config({ path: envPath });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) die(2, `${envPath} does not define both SUPABASE_URL and SUPABASE_SERVICE_KEY`);

  const salt = o.salt || crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  const hashSender = makeHasher(salt);
  const writerOf = new Map(humanIds.map((id, i) => [id, 'R' + i]));

  process.stderr.write(`this performs a database read: table "${o.table}"${o.role ? ` where role='${o.role}'` : ''}\n`);
  process.stderr.write(`known humans: ${humanIds.length} sender id(s) mapped to ${humanIds.map((_, i) => 'R' + i).join(',')} (the ids themselves are never written to disk)\n`);
  if (!o.approved && !o.dryRun) {
    die(3, 'refusing to read the database without --i-have-approval (use --dry-run to count rows only)');
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const counts = { total: 0, REAL: 0, SYNTH: 0, OTHER: 0, empty: 0 };
  const rows = [];

  for (let offset = 0; ; offset += o.page) {
    let q = client.from(o.table)
      .select('id,user_phone,content,created_at')
      .order('created_at', { ascending: true })
      .range(offset, offset + o.page - 1);
    if (o.role) q = q.eq('role', o.role);
    const { data, error } = await q;
    if (error) die(2, `supabase read failed at offset ${offset}: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      counts.total++;
      const content = r.content == null ? '' : String(r.content).trim();
      if (!content) { counts.empty++; continue; }
      const sender = String(r.user_phone == null ? '' : r.user_phone);
      const isHuman = writerOf.has(sender);
      const isSynth = !isHuman && o.syntheticPrefix !== '' && sender.startsWith(o.syntheticPrefix);
      const label = isHuman ? 'REAL' : (isSynth ? 'SYNTH' : 'OTHER');
      counts[label]++;
      const row = {
        id: String(r.id),
        label,
        writer_id: isHuman ? writerOf.get(sender) : null,
        persona_id: isHuman ? null : hashSender(sender),
        content: scrubContent(content),
        created_at: r.created_at ? String(r.created_at) : null,
        language: detectLanguage(content),
      };
      assertNoSenderId(row);
      if (!o.dryRun) rows.push(row);
    }
    if (data.length < o.page) break;
  }

  process.stderr.write(`rows seen ${counts.total} - REAL ${counts.REAL} - SYNTH ${counts.SYNTH} - OTHER ${counts.OTHER} - empty skipped ${counts.empty}\n`);
  if (o.dryRun) { process.stderr.write('--dry-run: nothing written\n'); return; }

  const outFile = path.join(outDir, 'corpus_user_messages.json');
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1) + '\n', 'utf8');
  process.stderr.write(`wrote ${rows.length} rows to ${outFile} (gitignored)\n`);
}

main().catch((e) => die(2, `unexpected failure: ${e && e.message ? e.message : e}`));
