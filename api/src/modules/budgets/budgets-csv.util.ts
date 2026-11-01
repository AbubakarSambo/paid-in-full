// Minimal, dependency-free CSV parser (mirrors gold-batch-pro's BudgetImportModal parseCsv):
// handles quoted fields (with "" escaping), commas, and CRLF/LF line endings.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (field !== '' || cur.length > 0) {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += c;
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows.filter((r) => r.some((v) => (v ?? '').trim() !== ''));
}

export function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const HEADER_NAMES = new Set(['coatag', 'coa', 'costline', 'paycategory', 'costcenter', 'period', 'amount']);

// A row is treated as a header if its first cell looks like one of the expected column names
// rather than actual data (e.g. "payCategory" vs "Marketing").
export function looksLikeHeaderRow(row: string[]): boolean {
  const first = (row[0] ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return HEADER_NAMES.has(first);
}
