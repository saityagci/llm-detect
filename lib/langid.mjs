// lib/langid.mjs — language identification, D1 §2 as amended by HEAD-RULINGS R22.
// R22: scope is EN + TR. Arabic script is still RECOGNISED, only so that it can be refused:
// primary = 'unsupported' -> G3_lang fails -> insufficient_text, reason 'unsupported_language'.
import { AR_LETTER, LATIN_LETTER, PERSO_ARABIC, TR_SPECIFIC, TATWEEL } from './unicode.mjs';
import { words } from './tokenize.mjs';

// D1 §2.1 — stored in BOTH diacritic and de-diacriticized form; the ASCII form is what makes
// this work on "cocuk yasinda gidecegiz" typed on an English keyboard.
export const TR_STOP = new Set([
  've', 'bir', 'bu', 'için', 'icin', 'ile', 'ama', 'çok', 'cok', 'daha', 'gibi', 'kadar',
  'sonra', 'önce', 'once', 'de', 'da', 'ki', 'mi', 'mı', 'mu', 'mü', 'ne', 'var', 'yok',
  'olarak', 'olan', 'ben', 'sen', 'biz', 'siz', 'şey', 'sey', 'değil', 'degil', 'göre',
  'gore', 'her', 'hem', 'işte', 'iste', 'şimdi', 'simdi', 'zaten', 'tamam', 'evet',
  'hayır', 'hayir', 'iyi', 'güzel', 'guzel', 'büyük', 'buyuk', 'küçük', 'kucuk',
  'çocuk', 'cocuk', 'yaşında', 'yasinda', 'geçen', 'gecen', 'teşekkür', 'tesekkur',
  'günaydın', 'gunaydin', 'merhaba', 'lütfen', 'lutfen', 'nasıl', 'nasil', 'kişi', 'kisi',
]);

export const EN_STOP = new Set([
  'the', 'and', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'with', 'that', 'this',
  'it', 'on', 'at', 'as', 'but', 'not', 'have', 'has', 'had', 'be', 'been', 'will', 'would',
  'can', 'could', 'from', 'they', 'we', 'you', 'your', 'our', 'my', 'me', 'i', 'a', 'an',
  'or', 'if', 'so', 'all', 'about', 'just', 'very', 'more', 'most',
]);

const TR_SUFFIX = /(lar|ler|dır|dir|dur|dür|dan|den|tan|ten|ında|inde|unda|ünde|mak|mek|ıyor|iyor|uyor|üyor|acak|ecek|miş|mış|muş|müş)$/u;

// ---------------------------------------------------------------------------
// HEAD-RULINGS R32 — ASCII-fied Turkish votes TURKISH.
// Folded Turkish ("reis selam 18 ekim giris 4 gece kaliyoruz 3 kisiyiz") is the documented shape
// of real Turkish chat: no diacritics, no stop words from the diacritic list, so every existing
// Turkish vote scored zero and a 14-word booking line routed into the `en:chat` cell with the
// English lexicons. These three lists are the language-ID mirror of features.mjs's
// tr_asciified_probe / TR_CHAT_WORD, kept here (not imported) because langid.mjs must stay the
// bottom of the dependency graph.
// ---------------------------------------------------------------------------
export const TR_ASCII_PROBE = new Set([
  'icin', 'cok', 'degil', 'gecen', 'yasinda', 'cocuk', 'buyuk', 'kucuk', 'sey', 'oyle', 'boyle',
  'tesekkurler', 'gunaydin', 'gorusuruz', 'ogrenci', 'dogru', 'yarin', 'bugun', 'sabah', 'aksam',
  'ucret', 'ucus', 'gelecegim', 'gidecegim', 'yapacagim', 'olacagim', 'kalacagiz', 'calisiyorum',
  'guzel', 'kotu', 'insallah', 'nasilsin', 'naber', 'tamamdir', 'sagol', 'oncelikle', 'ozellikle',
  'sonrasinda', 'kisiyiz', 'giris', 'gece',
]);

const TR_CHAT_SLANG = new Set([
  'naber', 'reis', 'abi', 'abicim', 'hocam', 'kanka', 'eyvallah', 'valla', 'aynen', 'hadi',
  'tmm', 'slm', 'mrb', 'nbr', 'sagol',
]);

// ASCII-fied Turkish suffix SHAPES. This is the weakest of the three cues and the only one with a
// real English base rate ("garden", "dollar", "since", "service" all end in one of these), so it
// is capped three ways: tokens of >=4 letters only, >=2 DISTINCT matching tokens, a >=12% share,
// and it is not counted at all when the English function-word vote fired. A weak morphological
// cue may not outvote a strong lexical one.
const TR_ASCII_SUFFIX = /(yiz|siniz|sınız|iz|lar|ler|dan|den|ca|ce|mis|mus|cak|cek|yor|dik|dık)$/u;
const TR_ASCII_SUFFIX_MIN_DISTINCT = 2;
const TR_ASCII_SUFFIX_MIN_SHARE = 0.12;

// ---------------------------------------------------------------------------
// HEAD-RULINGS R38(h) — an out-of-scope Latin language must not become `tr`.
// A French formal letter came back `tr` at 0.70 because `de/ne/en/ce/la` sit on the Turkish
// stopword list. These lists are deliberately small and deliberately DISJOINT from the EN and TR
// lists above, so a hit is positive evidence for a language this tool does not support — not the
// absence of evidence for one it does. The result is `unknown`, which fails G3 and is never
// scored; guessing a supported language for an unsupported one is the failure this closes.
// ---------------------------------------------------------------------------
const OTHER_LATIN = {
  fr: ['je', 'nous', 'vous', 'votre', 'notre', 'êtes', 'être', 'avec', 'pour', 'dans', 'sur',
    'mais', 'donc', 'aussi', 'cette'],
  es: ['yo', 'nosotros', 'ustedes', 'nuestra', 'nuestro', 'pero', 'porque', 'cuando', 'desde',
    'hasta', 'muy', 'también', 'estamos', 'tienen', 'sobre'],
  it: ['io', 'noi', 'voi', 'nostra', 'nostro', 'vostra', 'perché', 'quando', 'anche', 'però',
    'sono', 'abbiamo', 'della', 'dello', 'sulla'],
  de: ['ich', 'wir', 'sie', 'ihre', 'unsere', 'nicht', 'auch', 'aber', 'oder', 'weil', 'wenn',
    'werden', 'haben', 'sind', 'wurde'],
  pt: ['eu', 'nós', 'você', 'nossa', 'nosso', 'porque', 'quando', 'também', 'muito', 'estamos',
    'temos', 'sobre', 'para', 'pelo', 'pela'],
};
const OTHER_LATIN_SETS = Object.fromEntries(
  Object.entries(OTHER_LATIN).map(([k, v]) => [k, new Set(v)]),
);
// Sanity, asserted in selftest: no word may sit on an EN or TR list as well.
export const OTHER_LATIN_WORDS = OTHER_LATIN;

// Azerbaijani schwa and the Turkmen letters. Both languages are Turkic and score Turkish votes on
// suffix shapes; these letters do not exist in Turkish orthography at all.
const AZ_SCHWA_G = /ə/gu;
const TK_LETTERS_G = /[ýžň]/gu;
const AZ_TK_MIN = 2;

/** The strongest out-of-scope Latin vote, on the same 0/2/3 scale as the EN and TR votes. */
function otherLatinVote(toks) {
  let best = { lang: null, hits: 0, rate: 0 };
  for (const [lang, set] of Object.entries(OTHER_LATIN_SETS)) {
    const hits = toks.filter((t) => set.has(t)).length;
    const rate = toks.length ? hits / toks.length : 0;
    if (hits > best.hits) best = { lang, hits, rate };
  }
  let vote = 0;
  if (best.hits >= 2 && best.rate > 0.03) vote = 2;
  if (best.hits >= 4 && best.rate > 0.06) vote = 3;
  return { ...best, vote };
}

function share(arr, pred) {
  if (arr.length === 0) return 0;
  let n = 0;
  for (const c of arr) if (pred(c)) n++;
  return n / arr.length;
}

/** Latin sub-identification: TR vs EN by weighted vote (D1 §2.1). Never chain the signals. */
export function latinSubId(nfc) {
  const toks = words(nfc).map((w) => w.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i'));
  const latinChars = [...nfc].filter((c) => LATIN_LETTER.test(c));
  let tr = 0, en = 0;
  const detail = {};

  const trDensity = latinChars.length ? share(latinChars, (c) => TR_SPECIFIC.test(c)) : 0;
  detail.trLetterDensity = trDensity;
  if (trDensity > 0.015) tr += 2;

  const trStopHits = toks.filter((t) => TR_STOP.has(t)).length;
  const enStopHits = toks.filter((t) => EN_STOP.has(t)).length;
  detail.trStopRate = toks.length ? trStopHits / toks.length : 0;
  detail.enStopRate = toks.length ? enStopHits / toks.length : 0;
  if (detail.trStopRate > 0.06) tr += 2;
  if (detail.enStopRate > 0.08) en += 2;

  const sufRate = toks.length ? toks.filter((t) => t.length > 3 && TR_SUFFIX.test(t)).length / toks.length : 0;
  detail.trSuffixRate = sufRate;
  if (sufRate >= 0.08) tr += 1;

  // R32 (1/3): the ASCII-fied Turkish probe words. None of these is an English word, so one hit
  // is enough. This is the same list features.mjs uses for tr_asciified_probe.
  const probeHits = toks.filter((t) => TR_ASCII_PROBE.has(t));
  detail.trAsciiProbeHits = probeHits.length;
  if (probeHits.length >= 1) tr += 1;

  // R32 (2/3): Turkish chat slang. Also disjoint from English.
  const slangHits = toks.filter((t) => TR_CHAT_SLANG.has(t));
  detail.trChatSlangHits = slangHits.length;
  if (slangHits.length >= 1) tr += 1;

  // R32 (3/3): ASCII-fied suffix shapes, capped (see TR_ASCII_SUFFIX above). `en` is already
  // final at this point, which is deliberate: the suffix vote is skipped when English function
  // words voted, so a long English word list can never flip a document to Turkish.
  const sufToks = toks.filter((t) => t.length >= 4 && !EN_STOP.has(t) && TR_ASCII_SUFFIX.test(t));
  const sufDistinct = new Set(sufToks).size;
  const sufShare = toks.length ? sufToks.length / toks.length : 0;
  detail.trAsciiSuffixDistinct = sufDistinct;
  detail.trAsciiSuffixShare = sufShare;
  if (en === 0 && sufDistinct >= TR_ASCII_SUFFIX_MIN_DISTINCT && sufShare >= TR_ASCII_SUFFIX_MIN_SHARE) {
    tr += 1;
    detail.trAsciiSuffixVoted = true;
  }

  return { tr, en, detail };
}

/**
 * identify(nfc) -> { primary, confidence, mixed, shares, notes }
 * primary ∈ 'en' | 'tr' | 'mixed' | 'unsupported' | 'unknown'
 */
export function identify(nfc) {
  const notes = [];
  const chars = [...nfc].filter((c) => /\p{L}/u.test(c) && c !== TATWEEL);
  if (chars.length < 8) {
    return { primary: 'unknown', confidence: 0, mixed: false,
             shares: { latin: 0, arabic: 0, other: 0 }, notes: ['too_few_letters'] };
  }
  const arShare = share(chars, (c) => AR_LETTER.test(c));
  const laShare = share(chars, (c) => LATIN_LETTER.test(c));
  const otShare = Math.max(0, 1 - arShare - laShare);
  const shares = { latin: laShare, arabic: arShare, other: otShare };

  // Perso-Arabic guard — Persian/Urdu is out of scope and must never be scored as Arabic.
  if (arShare > 0.3) {
    const arChars = chars.filter((c) => AR_LETTER.test(c));
    const perso = share(arChars, (c) => PERSO_ARABIC.test(c));
    if (perso > 0.02) {
      return { primary: 'unknown', confidence: 0.6, mixed: false, shares,
               notes: ['perso_arabic_script_out_of_scope'] };
    }
  }

  // R22: any substantial Arabic content is refused, never scored.
  if (arShare >= 0.20) {
    return { primary: 'unsupported', confidence: Math.min(1, arShare + 0.3), mixed: laShare >= 0.20,
             shares, notes: ['arabic_script_out_of_scope_R22'] };
  }

  if (laShare < 0.60) {
    return { primary: 'unknown', confidence: 0.3, mixed: false, shares, notes: ['no_dominant_script'] };
  }

  const { tr, en, detail } = latinSubId(nfc);

  // R38(h): Azerbaijani / Turkmen first — they are Turkic, so they collect Turkish votes on
  // suffix shapes, but their orthography carries letters Turkish does not have at all.
  const azHits = (nfc.match(AZ_SCHWA_G) ?? []).length;
  const tkHits = (nfc.match(TK_LETTERS_G) ?? []).length;
  if (azHits >= AZ_TK_MIN || tkHits >= AZ_TK_MIN) {
    return { primary: 'unknown', confidence: 0.4, mixed: false, shares,
      notes: [azHits >= AZ_TK_MIN ? 'azerbaijani_script_out_of_scope' : 'turkmen_script_out_of_scope'],
      detail: { ...detail, azSchwa: azHits, tkLetters: tkHits } };
  }

  // R38(h): an out-of-scope Latin language that wins or ties is `unknown`, never `tr`/`en`.
  const other = otherLatinVote(words(nfc).map((w) => w.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i')));
  detail.otherLatin = other;
  if (other.vote > 0 && other.vote >= Math.max(tr, en)) {
    return { primary: 'unknown', confidence: Math.min(0.9, 0.4 + 0.1 * other.vote), mixed: false,
      shares, notes: ['latin_other_language'], detail };
  }

  const total = tr + en;
  if (total === 0) {
    // R32 (1): zero votes each is "the two Latin sub-IDs within one vote", which SPEC B.9 already
    // calls `mixed`. Falling back to `en` routed folded Turkish into the en cell with the English
    // lexicons and gave it full-weight English features; `mixed` uses the script-agnostic reduced
    // set and says so. Never guess a language from an absence of evidence.
    return { primary: 'mixed', confidence: 0.3, mixed: true, shares,
             notes: ['latin_subid_no_votes'], detail };
  }
  if (Math.abs(tr - en) <= 1 && tr > 0 && en > 0) {
    notes.push('latin_subid_tie');
    return { primary: 'mixed', confidence: 0.4, mixed: true, shares, notes, detail };
  }
  const primary = tr > en ? 'tr' : 'en';
  const confidence = Math.min(0.95, 0.5 + 0.1 * Math.abs(tr - en));
  return { primary, confidence, mixed: false, shares, notes, detail };
}
