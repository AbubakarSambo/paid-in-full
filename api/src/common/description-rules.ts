/**
 * Description Rules (spec §7). Pure functions, no I/O: safe to import from any module.
 *
 * Expected pattern: `Item – Detail – Qty/Size – DD/MM/YYYY` (segments separated by a spaced en-dash
 * or hyphen). validateDescription() returns one message per failed rule (empty array = valid).
 */

export const DESCRIPTION_PATTERN = 'Item – Detail – Qty/Size – DD/MM/YYYY';
export const DESCRIPTION_MAX_LENGTH = 60;

/** Segment separator: a spaced en-dash, em-dash or hyphen. */
const SEGMENT_SPLIT = /\s+[–—-]\s+/;

const VAGUE_WORDS = new Set([
  'misc',
  'miscellaneous',
  'items',
  'supplies',
  'petty cash',
  'salary',
  'allowance',
  'service charge',
  'payment',
  'purchase',
]);

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const TRAILING_DATE = /\b\d{2}\/\d{2}\/\d{4}$/;
const TRAILING_MONTH = new RegExp(`\\b${MONTHS}\\s+\\d{4}$`, 'i');
const TRAILING_WEEK = /\bweek\s+\d{1,2}$/i;
/** A whole segment that is just a date / month / week marker. */
const PERIOD_SEGMENT = new RegExp(`^(?:\\d{2}\\/\\d{2}\\/\\d{4}|${MONTHS}\\s+\\d{4}|week\\s+\\d{1,2})$`, 'i');

/** Units that must be written without a space after the number (500ml, 25L, 1kg). */
const UNIT_WORDS = '(?:ml|cl|l|ltr|ltrs|litres?|liters?|kg|kgs|g|mg|cm|mm|km|ft)';
const SPACE_BEFORE_UNIT = new RegExp(`\\b\\d+(?:\\.\\d+)?\\s+${UNIT_WORDS}\\b`, 'i');

export function splitDescriptionSegments(desc: string): string[] {
  return desc
    .trim()
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function endsWithPeriodMarker(desc: string): boolean {
  const d = desc.trim().replace(/\.+$/, '');
  return TRAILING_DATE.test(d) || TRAILING_MONTH.test(d) || TRAILING_WEEK.test(d);
}

/**
 * Spec §7 validator. Returns one human-readable message per failed rule, in the spec's order.
 */
export function validateDescription(desc: string | null | undefined, vendorName?: string | null): string[] {
  const text = (desc ?? '').trim();
  if (!text) return ['Description must not be empty.'];

  const errors: string[] = [];
  const withoutStop = text.replace(/\.+$/, '').trim();
  const segments = splitDescriptionSegments(withoutStop);

  if (/^(purchase\s+of|payment\s+for)\b/i.test(text)) {
    errors.push('Don\'t start with "Purchase of" or "Payment for" — start with the item.');
  }

  if (/\.$/.test(text)) {
    errors.push('No trailing full stop.');
  }

  if (!endsWithPeriodMarker(withoutStop)) {
    errors.push('End with a date (DD/MM/YYYY), a month like "Sep 2026", or "Week N".');
  }

  const first = (segments[0] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (segments.length < 3 && VAGUE_WORDS.has(first)) {
    errors.push(`"${segments[0]}" is too vague on its own — say what was bought or paid for.`);
  }

  const allowanceIdx = segments.findIndex((s) => /^(staff\s+)?allowances?$/i.test(s));
  if (allowanceIdx >= 0) {
    const next = segments[allowanceIdx + 1];
    if (!next || PERIOD_SEGMENT.test(next)) {
      errors.push('State the kind of allowance, e.g. "Allowance – Transport – Sep 2026".');
    }
  }

  if (segments.length < 2) {
    errors.push(`Use at least 2 parts separated by " – " (${DESCRIPTION_PATTERN}).`);
  }

  const vendor = (vendorName ?? '').trim();
  if (vendor.length >= 3 && text.toLowerCase().includes(vendor.toLowerCase())) {
    errors.push('Don\'t repeat the vendor name in the description.');
  }

  if (text.length > DESCRIPTION_MAX_LENGTH) {
    errors.push(`Keep it to ${DESCRIPTION_MAX_LENGTH} characters or fewer (currently ${text.length}).`);
  }

  if (SPACE_BEFORE_UNIT.test(text)) {
    errors.push('No space before units — write 500ml, 25L, 1kg.');
  }

  return errors;
}

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or',
  'per', 'the', 'to', 'via', 'vs', 'with',
]);

function titleWord(word: string, isFirst: boolean): string {
  if (!word) return word;
  if (/\d/.test(word)) {
    // 500ml / 25l / 2x / dates: keep as written, but litres read better as a capital L.
    return word.replace(/^(\d+(?:\.\d+)?)(l|ltrs?)$/i, (_m, n) => `${n}L`);
  }
  if (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word; // acronyms: COS, LPG
  const lower = word.toLowerCase();
  if (!isFirst && SMALL_WORDS.has(lower)) return lower;
  // Handle hyphen/apostrophe/slash compounds: "air-conditioner" → "Air-Conditioner"
  return lower.replace(/(^|[-/(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/** Title-case each segment, keeping small words lowercase (except a segment's first word). */
export function titleCaseDescription(desc: string): string {
  return splitDescriptionSegments(desc)
    .map((seg) =>
      seg
        .split(/\s+/)
        .map((w, i) => titleWord(w, i === 0))
        .join(' '),
    )
    .join(' – ');
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDdMmYyyy(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic "Tidy up" (used when no LLM is configured, and to post-process LLM output):
 * strips "Purchase of"/"Payment for", trailing stops and the vendor name, normalises separators
 * to " – ", removes spaces before units, moves/append a DD/MM/YYYY date to the end, title-cases.
 */
export function tidyDescription(
  desc: string,
  opts: { vendorName?: string | null; date?: Date | string | null } = {},
): string {
  let s = (desc ?? '').replace(/\s+/g, ' ').trim();

  s = s.replace(/^(being\s+)?(purchase\s+of|payment\s+(for|of)|paid\s+for|cost\s+of)\s+/i, '');
  s = s.replace(/[.\s]+$/, '');

  const vendor = (opts.vendorName ?? '').trim();
  if (vendor.length >= 3) {
    s = s.replace(new RegExp(`(?:\\s*(?:from|to|by|-|–|—))*\\s*${escapeRegex(vendor)}\\s*`, 'ig'), ' ').trim();
  }

  // Pull out a date written anywhere (DD/MM/YYYY, D-M-YY, YYYY-MM-DD, "Sep 2026", "Week 3").
  let dateStr: string | null = null;
  const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  const month = new RegExp(`\\b${MONTHS}\\s+\\d{4}\\b`, 'i');
  const week = /\bweek\s+\d{1,2}\b/i;
  let m: RegExpMatchArray | null;
  if ((m = s.match(iso))) {
    dateStr = `${m[3]}/${m[2]}/${m[1]}`;
    s = s.replace(iso, ' ');
  } else if ((m = s.match(dmy))) {
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    dateStr = `${pad2(+m[1])}/${pad2(+m[2])}/${yyyy}`;
    s = s.replace(dmy, ' ');
  } else if ((m = s.match(month)) && month.test(s.trim().replace(/[\s–—-]+$/, '').slice(-12))) {
    // A trailing month ("Allowance – Transport – sep 2026") is kept as the period.
    dateStr = m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase();
    s = s.replace(month, ' ');
  } else if ((m = s.match(week))) {
    dateStr = `Week ${m[0].replace(/\D/g, '')}`;
    s = s.replace(week, ' ');
  }

  // Separators → spaced en-dash. Commas / semicolons / pipes / doubled dashes too.
  s = s
    .replace(/\s*(?:--|—|–|\s-\s|;|\|)\s*/g, ' – ')
    .replace(/\s*,\s*/g, ' – ');

  // Units: no space before them; litres as "L".
  s = s.replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(${UNIT_WORDS})\\b`, 'gi'), '$1$2');
  s = s.replace(/\b(\d+(?:\.\d+)?)(?:litres?|liters?|ltrs?|l)\b/gi, '$1L');

  const rest: string[] = [];
  for (const raw of s.split(/\s+[–—-]\s+|\s+[–—-]$|^[–—-]\s+/)) {
    const seg = raw.replace(/^[\s–—-]+|[\s–—-]+$/g, '').trim();
    if (!seg) continue;
    // Split a trailing quantity ("Diesel for Generator 50L") into its own segment.
    const q = seg.match(new RegExp(`^(.*\\S)\\s+(\\d+(?:\\.\\d+)?(?:${UNIT_WORDS}|L|pcs|x))$`, 'i'));
    if (q && q[1].split(/\s+/).length >= 1 && !/\d$/.test(q[1])) rest.push(q[1], q[2]);
    else rest.push(seg);
  }
  if (!dateStr) {
    const d = opts.date ? new Date(opts.date) : new Date();
    dateStr = formatDdMmYyyy(Number.isNaN(d.getTime()) ? new Date() : d);
  }

  const body = titleCaseDescription(rest.join(' – '));
  return body ? `${body} – ${dateStr}` : dateStr;
}
