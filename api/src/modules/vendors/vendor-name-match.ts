/**
 * Bulk-upload name check (spec §5.4): a row imports only when the typed name matches the name
 * the bank returns. Matching is case/punctuation-insensitive, ignores word order and common
 * company suffixes, and accepts one name being a ≥2-word subset of the other (banks often
 * truncate or add middle names).
 */
const NOISE = new Set(['LTD', 'LIMITED', 'PLC', 'NIG', 'NIGERIA', 'CO', 'COMPANY', 'THE', 'AND', 'INC', 'MR', 'MRS', 'MS', 'DR', 'ENT', 'ENTERPRISE', 'ENTERPRISES']);

export function nameTokens(name: string): string[] {
  return (name ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t));
}

export function namesMatch(typed: string, bank: string): boolean {
  const a = nameTokens(typed);
  const b = nameTokens(bank);
  if (!a.length || !b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (a.join(' ') === b.join(' ')) return true;
  if (sa.size === sb.size && [...sa].every((t) => sb.has(t))) return true;
  if (sa.size >= 2 && [...sa].every((t) => sb.has(t))) return true;
  if (sb.size >= 2 && [...sb].every((t) => sa.has(t))) return true;
  return false;
}
