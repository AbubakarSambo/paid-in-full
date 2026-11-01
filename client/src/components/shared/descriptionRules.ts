/**
 * Client mirror of the server's Description Rules (spec §7, api/src/common/description-rules.ts).
 * Keep the messages identical so the UI and server agree. Returns one message per failed rule.
 */
export const DESCRIPTION_PATTERN = 'Item – Detail – Qty/Size – DD/MM/YYYY'
export const DESCRIPTION_MAX_LENGTH = 60

const SEGMENT_SPLIT = /\s+[–—-]\s+/
const VAGUE_WORDS = new Set(['misc', 'miscellaneous', 'items', 'supplies', 'petty cash', 'salary', 'allowance', 'service charge', 'payment', 'purchase'])
const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const TRAILING_DATE = /\b\d{2}\/\d{2}\/\d{4}$/
const TRAILING_MONTH = new RegExp(`\\b${MONTHS}\\s+\\d{4}$`, 'i')
const TRAILING_WEEK = /\bweek\s+\d{1,2}$/i
const PERIOD_SEGMENT = new RegExp(`^(?:\\d{2}\\/\\d{2}\\/\\d{4}|${MONTHS}\\s+\\d{4}|week\\s+\\d{1,2})$`, 'i')
const UNIT_WORDS = '(?:ml|cl|l|ltr|ltrs|litres?|liters?|kg|kgs|g|mg|cm|mm|km|ft)'
const SPACE_BEFORE_UNIT = new RegExp(`\\b\\d+(?:\\.\\d+)?\\s+${UNIT_WORDS}\\b`, 'i')

function segmentsOf(desc: string): string[] {
  return desc.trim().split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean)
}

function endsWithPeriodMarker(desc: string): boolean {
  const d = desc.trim().replace(/\.+$/, '')
  return TRAILING_DATE.test(d) || TRAILING_MONTH.test(d) || TRAILING_WEEK.test(d)
}

/** Spec §7 validator. Empty array = valid. */
export function validateDescription(desc: string | null | undefined, vendorName?: string | null): string[] {
  const text = (desc ?? '').trim()
  if (!text) return ['Description must not be empty.']
  const errors: string[] = []
  const withoutStop = text.replace(/\.+$/, '').trim()
  const segments = segmentsOf(withoutStop)

  if (/^(purchase\s+of|payment\s+for)\b/i.test(text)) errors.push('Don\'t start with "Purchase of" or "Payment for" — start with the item.')
  if (/\.$/.test(text)) errors.push('No trailing full stop.')
  if (!endsWithPeriodMarker(withoutStop)) errors.push('End with a date (DD/MM/YYYY), a month like "Sep 2026", or "Week N".')
  const first = (segments[0] ?? '').toLowerCase().replace(/\s+/g, ' ')
  if (segments.length < 3 && VAGUE_WORDS.has(first)) errors.push(`"${segments[0]}" is too vague on its own — say what was bought or paid for.`)
  const allowanceIdx = segments.findIndex((s) => /^(staff\s+)?allowances?$/i.test(s))
  if (allowanceIdx >= 0) {
    const next = segments[allowanceIdx + 1]
    if (!next || PERIOD_SEGMENT.test(next)) errors.push('State the kind of allowance, e.g. "Allowance – Transport – Sep 2026".')
  }
  if (segments.length < 2) errors.push(`Use at least 2 parts separated by " – " (${DESCRIPTION_PATTERN}).`)
  const vendor = (vendorName ?? '').trim()
  if (vendor.length >= 3 && text.toLowerCase().includes(vendor.toLowerCase())) errors.push("Don't repeat the vendor name in the description.")
  if (text.length > DESCRIPTION_MAX_LENGTH) errors.push(`Keep it to ${DESCRIPTION_MAX_LENGTH} characters or fewer (currently ${text.length}).`)
  if (SPACE_BEFORE_UNIT.test(text)) errors.push('No space before units — write 500ml, 25L, 1kg.')
  return errors
}
