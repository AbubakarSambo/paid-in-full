import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { PayoutLedgerService } from '../wallet/payout-ledger.service';
import { PAID_TOLERANCE, legSum, lineSafety, outstandingOf, paidFromLegs, round2, toNum } from '../wallet/payout-math';
import { ConfirmStatementMatchesDto, StatementPreviewDto } from './dto';

// Spec §5.3 column synonyms (lower-case, trimmed).
const DATE_COLS = ['date', 'value date', 'transaction date', 'trans date', 'txn date', 'tran date', 'posting date', 'booking date', 'posted date', 'entry date'];
const DESC_COLS = ['narration', 'description', 'details', 'remarks', 'particulars', 'transaction details', 'narrative', 'memo', 'transaction description'];
const DEBIT_COLS = ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'dr', 'debit amount', 'amount out', 'paid out', 'dr amount', 'withdrawal amount'];
const AMOUNT_COLS = ['amount', 'transaction amount'];
const REF_COLS = ['reference', 'ref', 'ref no', 'ref.', 'reference no', 'reference number', 'transaction reference', 'transaction ref', 'session id', 'transaction id', 'cheque no', 'cheque number'];

/** Vendor-name stop-words stripped before matching (spec: LTD/LIMITED/ENTERPRISES/NIG/SERVICES/MR/MRS…). */
export const VENDOR_STOP_WORDS = new Set([
  'LTD', 'LIMITED', 'ENTERPRISES', 'ENTERPRISE', 'ENT', 'NIG', 'NIGERIA', 'NIGERIAN', 'SERVICES', 'SERVICE', 'SVCS',
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'CHIEF', 'ALHAJI', 'ALHAJA', 'CO', 'COMPANY', 'PLC', 'INTL', 'INTERNATIONAL',
  'VENTURES', 'VENTURE', 'GLOBAL', 'CONCEPT', 'CONCEPTS', 'RESOURCES', 'INVESTMENT', 'INVESTMENTS', 'AND', 'THE', 'OF',
  'TRF', 'TRANSFER', 'TO', 'FROM', 'NIP', 'FT', 'PAYMENT', 'PYMT', 'FOR',
]);

export function normaliseName(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !VENDOR_STOP_WORDS.has(t));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const neg = /^\(.*\)$/.test(raw.trim()) || raw.trim().startsWith('-');
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // Nigerian statements are day-first
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{2,4})/);
  if (m && MONTHS[m[2].toUpperCase()] !== undefined) {
    return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toUpperCase()], +m[1]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function findCol(header: string[], names: string[]): number {
  const h = header.map((x) => x.toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').trim());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.startsWith(n) || (n.length > 3 && x.includes(n)));
    if (i >= 0) return i;
  }
  return -1;
}

/** Spec §5.3 "Reconcile from bank statement". */
@Injectable()
export class StatementReconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly ledger: PayoutLedgerService,
  ) {}

  detectColumns(rows: string[][]) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const header = rows[i];
      const date = findCol(header, DATE_COLS);
      const debit = findCol(header, DEBIT_COLS);
      const amount = debit < 0 ? findCol(header, AMOUNT_COLS) : -1;
      if (date >= 0 && (debit >= 0 || amount >= 0)) {
        return {
          headerRow: i,
          date,
          description: findCol(header, DESC_COLS),
          debit,
          amount,
          reference: findCol(header, REF_COLS),
          header,
        };
      }
    }
    throw new BadRequestException('Could not find date and debit columns in this CSV (expected headers like "Date", "Narration", "Debit")');
  }

  async preview(workspaceId: string, dto: StatementPreviewDto) {
    const rows = parseCsv(dto.csv);
    if (rows.length < 2) throw new BadRequestException('The CSV has no data rows');
    const cols = this.detectColumns(rows);

    const debits = rows
      .slice(cols.headerRow + 1)
      .map((r, idx) => {
        const debit = cols.debit >= 0 ? Math.abs(parseAmount(r[cols.debit])) : (() => { const a = parseAmount(r[cols.amount]); return a < 0 ? -a : 0; })();
        return {
          row: cols.headerRow + 2 + idx,
          date: parseDate(r[cols.date]),
          description: cols.description >= 0 ? r[cols.description] ?? '' : '',
          reference: cols.reference >= 0 ? r[cols.reference] ?? '' : '',
          debit: round2(debit),
        };
      })
      .filter((d) => d.debit > 0);

    const items = await this.prisma.batchItem.findMany({
      where: {
        batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
        payoutStatus: { notIn: ['CANCELLED', 'SUCCESS', 'SENDING'] },
      },
      include: { payouts: true, batch: { select: { batchRef: true } } },
    });
    const open = items
      .filter((i) => lineSafety(i).selectable)
      .map((i) => {
        const outstanding = outstandingOf(i.total, paidFromLegs(i.payouts));
        const whtRemaining = Math.max(0, round2(toNum(i.whtAmount) - legSum(i.payouts, 'WHT', ['SUCCESS'])));
        return { item: i, outstanding, netOutstanding: round2(outstanding - whtRemaining), tokens: normaliseName(i.vendorName) };
      });

    type Candidate = { batchItemId: string; batchId: string; batchRef: string; vendorName: string; description: string; outstanding: number; suggestedAmount: number; confidence: number; reasons: string[] };
    const suggestions = debits.map((d) => {
      const descTokens = new Set(normaliseName(d.description));
      const descDigits = d.description.replace(/\D/g, '');
      const candidates: Candidate[] = [];
      for (const o of open) {
        const reasons: string[] = [];
        let score = 0;
        let suggested = Math.min(d.debit, o.outstanding);
        const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
        if (near(d.debit, o.outstanding, 1)) {
          score += 50;
          reasons.push('amount = outstanding');
          suggested = o.outstanding;
        } else if (o.netOutstanding !== o.outstanding && near(d.debit, o.netOutstanding, 1)) {
          score += 45;
          reasons.push('amount = net of WHT');
          suggested = o.outstanding;
        } else if (near(d.debit, o.outstanding, o.outstanding * 0.01)) {
          score += 30;
          reasons.push('amount within 1%');
        } else if (d.debit < o.outstanding) {
          score += 10;
          reasons.push('possible part payment');
        } else if (d.debit > o.outstanding + PAID_TOLERANCE) {
          continue; // more than owed: not this line
        }
        if (o.tokens.length) {
          const hits = o.tokens.filter((t) => descTokens.has(t) || [...descTokens].some((x) => x.length >= 4 && (x.startsWith(t) || t.startsWith(x)))).length;
          if (hits) {
            const pts = Math.round((30 * hits) / o.tokens.length);
            score += pts;
            reasons.push(`vendor name ${hits}/${o.tokens.length}`);
          }
        }
        if (o.item.vendorAcctNo && o.item.vendorAcctNo.length >= 10 && descDigits.includes(o.item.vendorAcctNo)) {
          score += 20;
          reasons.push('account number');
        }
        if (score < 40) continue;
        candidates.push({
          batchItemId: o.item.id,
          batchId: o.item.batchId,
          batchRef: o.item.batch.batchRef,
          vendorName: o.item.vendorName,
          description: o.item.description,
          outstanding: o.outstanding,
          suggestedAmount: round2(suggested),
          confidence: Math.min(100, score),
          reasons,
        });
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
      return { ...d, candidates: candidates.slice(0, 3) };
    });

    // Greedy one-to-one best match, highest confidence first.
    const taken = new Set<string>();
    const order = suggestions
      .map((s, i) => ({ i, c: s.candidates[0]?.confidence ?? 0 }))
      .sort((a, b) => b.c - a.c);
    const best = new Map<number, Candidate | null>();
    for (const { i } of order) {
      const pick = suggestions[i].candidates.find((c) => !taken.has(c.batchItemId)) ?? null;
      if (pick) taken.add(pick.batchItemId);
      best.set(i, pick);
    }

    return {
      columns: {
        date: cols.header[cols.date],
        description: cols.description >= 0 ? cols.header[cols.description] : null,
        debit: cols.debit >= 0 ? cols.header[cols.debit] : cols.header[cols.amount],
        reference: cols.reference >= 0 ? cols.header[cols.reference] : null,
      },
      debitRows: debits.length,
      matched: [...best.values()].filter(Boolean).length,
      rows: suggestions.map((s, i) => ({ ...s, match: best.get(i) ?? null })),
    };
  }

  /** Writes confirmed matches to the payout ledger with STMT- references (idempotent). */
  async confirm(user: CurrentUserData, dto: ConfirmStatementMatchesDto) {
    const ws = user.workspaceId;
    const results: Array<{ batchItemId: string; reference?: string; status: 'RECORDED' | 'ALREADY_RECORDED' | 'REJECTED'; message?: string }> = [];
    const perBatch = new Map<string, { batchRef: string; items: string[]; amount: number }>();

    for (const m of dto.matches) {
      const reference = `STMT-${createHash('sha256')
        .update([m.batchItemId, m.statementReference ?? '', m.statementDate ?? '', m.debit ?? m.amount, m.row ?? ''].join('|'))
        .digest('hex')
        .slice(0, 20)
        .toUpperCase()}`;
      try {
        const res = await this.prisma.$transaction(async (tx) => {
          const item = await tx.batchItem.findFirst({ where: { id: m.batchItemId, batch: { workspaceId: ws } }, include: { batch: true } });
          if (!item) throw new BadRequestException('Batch line not found');
          await tx.$queryRaw`SELECT id FROM batches WHERE id = ${item.batchId} FOR UPDATE`;
          if (await tx.batchItemPayout.findUnique({ where: { reference } })) return { status: 'ALREADY_RECORDED' as const, item };
          if (item.batch.payoutStatus === 'CANCELLED') throw new BadRequestException('Batch is cancelled');
          const payouts = await tx.batchItemPayout.findMany({ where: { batchItemId: item.id } });
          const safety = lineSafety({ ...item, payouts });
          if (!safety.selectable) throw new BadRequestException(safety.reason);
          const outstanding = outstandingOf(item.total, paidFromLegs(payouts));
          const amount = round2(Math.min(m.amount, outstanding));
          if (m.amount > outstanding + PAID_TOLERANCE) throw new BadRequestException(`Amount exceeds the outstanding ₦${outstanding.toLocaleString()}`);
          const paidAt = m.statementDate ? parseDate(m.statementDate) ?? new Date() : new Date();
          await tx.batchItemPayout.create({
            data: {
              workspaceId: ws,
              batchItemId: item.id,
              leg: 'VENDOR',
              amount,
              status: 'SUCCESS',
              reference,
              transferReference: reference,
              destinationAccountNumber: item.vendorAcctNo,
              destinationBankCode: item.vendorBankCode,
              destinationAccountName: item.vendorAcctName,
              initiatedById: user.id,
              completedAt: paidAt,
              statusCheckedAt: new Date(),
              providerResponse: { source: 'bank_statement', statementReference: m.statementReference ?? null, description: m.description ?? null, debit: m.debit ?? null },
            },
          });
          await this.ledger.recomputeLine(tx, item.id);
          await this.ledger.recomputeBatch(tx, item.batchId);
          return { status: 'RECORDED' as const, item, amount };
        });
        results.push({ batchItemId: m.batchItemId, reference, status: res.status });
        if (res.status === 'RECORDED') {
          const b = perBatch.get(res.item.batchId) ?? { batchRef: res.item.batch.batchRef, items: [], amount: 0 };
          b.items.push(res.item.id);
          b.amount = round2(b.amount + (res.amount ?? 0));
          perBatch.set(res.item.batchId, b);
        }
      } catch (error) {
        results.push({ batchItemId: m.batchItemId, status: 'REJECTED', message: (error as Error).message });
      }
    }

    for (const [batchId, b] of perBatch) {
      await this.audit.record(ws, user, AUDIT_ACTIONS.BATCH_RECONCILED, b.batchRef, { items: b.items, amount: b.amount, source: 'bank_statement' }, { type: 'batch', id: batchId });
    }
    return {
      recorded: results.filter((r) => r.status === 'RECORDED').length,
      alreadyRecorded: results.filter((r) => r.status === 'ALREADY_RECORDED').length,
      rejected: results.filter((r) => r.status === 'REJECTED').length,
      results,
    };
  }
}
