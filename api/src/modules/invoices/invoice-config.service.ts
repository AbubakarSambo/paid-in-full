import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_TERMS =
  'Payment due within 14 days of the invoice date. Please quote the invoice number as your payment reference.';
export const DEFAULT_THEME = 'F4B942';
export const DEFAULT_VAT_RATE = 7.5;

/** AppConfig keys owned by the invoicing module (spec §4 app_config, §5.10 #6, #11, #24). */
export const INVOICE_CONFIG_KEYS = {
  VAT_DEFAULT: 'vat_on_new_invoices',
  INVOICE_PREFIX: 'invoice_prefix',
  QUOTE_PREFIX: 'quote_prefix',
  THEME: 'invoice_theme_color',
  LOGO: 'invoice_logo_url',
  SIGNATURE: 'invoice_signature_url',
  FOOTER: 'invoice_footer_text',
  DEFAULT_TERMS: 'invoice_default_terms',
  PAYMENT_ACCOUNT: 'payment_account',
  SWEEP_ENABLED: 'sweep_enabled',
  SWEEP_BANK_CODE: 'sweep_bank_code',
  SWEEP_BANK_NAME: 'sweep_bank_name',
  SWEEP_ACCOUNT_NUMBER: 'sweep_account_number',
  SWEEP_ACCOUNT_NAME: 'sweep_account_name',
  SWEEP_BUFFER: 'sweep_buffer',
} as const;

export interface PaymentAccount {
  bankCode: string;
  bankName?: string | null;
  accountNumber: string;
  accountName: string;
  verifiedAt?: string;
}

export interface InvoiceBranding {
  logoUrl: string | null;
  signatureUrl: string | null;
  themeColor: string;
  footerText: string | null;
}

export interface InvoiceSettings {
  branding: InvoiceBranding;
  invoicePrefix: string;
  quotePrefix: string;
  vatOnNewInvoices: boolean;
  defaultVatRate: number;
  defaultTerms: string;
  workspaceTin: string | null;
  paymentAccount: PaymentAccount | null;
}

export interface SweepSettings {
  enabled: boolean;
  bankCode: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  buffer: number;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class InvoiceConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getMap(workspaceId: string, keys: string[]): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appConfig.findMany({ where: { workspaceId, key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value as unknown]));
  }

  async set(workspaceId: string, values: Record<string, unknown>, userId?: string) {
    const entries = Object.entries(values).filter(([, v]) => v !== undefined);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.appConfig.upsert({
          where: { workspaceId_key: { workspaceId, key } },
          create: { workspaceId, key, value: (value ?? Prisma.JsonNull) as Prisma.InputJsonValue, updatedById: userId },
          update: { value: (value ?? Prisma.JsonNull) as Prisma.InputJsonValue, updatedById: userId },
        }),
      ),
    );
  }

  async getSettings(workspaceId: string): Promise<InvoiceSettings> {
    const k = INVOICE_CONFIG_KEYS;
    const [map, ws] = await Promise.all([
      this.getMap(workspaceId, [
        k.VAT_DEFAULT,
        k.INVOICE_PREFIX,
        k.QUOTE_PREFIX,
        k.THEME,
        k.LOGO,
        k.SIGNATURE,
        k.FOOTER,
        k.DEFAULT_TERMS,
        k.PAYMENT_ACCOUNT,
      ]),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { invoicePrefix: true, taxRate: true, logoUrl: true, tin: true },
      }),
    ]);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const pa = map[k.PAYMENT_ACCOUNT] as PaymentAccount | null | undefined;
    return {
      branding: {
        logoUrl: str(map[k.LOGO]) ?? ws?.logoUrl ?? null,
        signatureUrl: str(map[k.SIGNATURE]),
        themeColor: (str(map[k.THEME]) ?? DEFAULT_THEME).replace(/^#/, '').toUpperCase(),
        footerText: str(map[k.FOOTER]),
      },
      invoicePrefix: str(map[k.INVOICE_PREFIX]) ?? ws?.invoicePrefix ?? 'INV',
      quotePrefix: str(map[k.QUOTE_PREFIX]) ?? 'QTE',
      vatOnNewInvoices: map[k.VAT_DEFAULT] === undefined ? true : map[k.VAT_DEFAULT] === true || map[k.VAT_DEFAULT] === 'true',
      defaultVatRate: Number(ws?.taxRate ?? DEFAULT_VAT_RATE) || DEFAULT_VAT_RATE,
      defaultTerms: str(map[k.DEFAULT_TERMS]) ?? DEFAULT_TERMS,
      workspaceTin: ws?.tin ?? null,
      paymentAccount: pa && typeof pa === 'object' && pa.accountNumber ? pa : null,
    };
  }

  async getSweepSettings(workspaceId: string): Promise<SweepSettings> {
    const k = INVOICE_CONFIG_KEYS;
    const map = await this.getMap(workspaceId, [
      k.SWEEP_ENABLED,
      k.SWEEP_BANK_CODE,
      k.SWEEP_BANK_NAME,
      k.SWEEP_ACCOUNT_NUMBER,
      k.SWEEP_ACCOUNT_NAME,
      k.SWEEP_BUFFER,
    ]);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      enabled: map[k.SWEEP_ENABLED] === true || map[k.SWEEP_ENABLED] === 'true',
      bankCode: str(map[k.SWEEP_BANK_CODE]),
      bankName: str(map[k.SWEEP_BANK_NAME]),
      accountNumber: str(map[k.SWEEP_ACCOUNT_NUMBER]),
      accountName: str(map[k.SWEEP_ACCOUNT_NAME]),
      buffer: Math.max(0, Number(map[k.SWEEP_BUFFER] ?? 0) || 0),
    };
  }

  /**
   * next_invoice_number(prefix): per-series sequence. The InvoiceSequence row is incremented
   * atomically inside the caller's transaction; on first use it is seeded past any number already
   * issued under that prefix, and any collision (e.g. a hand-imported number) is skipped.
   */
  async nextNumber(db: Db, workspaceId: string, prefix: string): Promise<string> {
    const existingSeq = await db.invoiceSequence.findUnique({ where: { workspaceId_prefix: { workspaceId, prefix } } });
    if (!existingSeq) {
      const rows = await db.invoice.findMany({
        where: {
          workspaceId,
          OR: [{ invoiceNumber: { startsWith: `${prefix}-` } }, { quoteNumber: { startsWith: `${prefix}-` } }],
        },
        select: { invoiceNumber: true, quoteNumber: true },
      });
      let max = 0;
      for (const r of rows) {
        for (const n of [r.invoiceNumber, r.quoteNumber]) {
          if (!n?.startsWith(`${prefix}-`)) continue;
          const v = parseInt(n.slice(prefix.length + 1), 10);
          if (!isNaN(v) && v > max) max = v;
        }
      }
      await db.invoiceSequence.upsert({
        where: { workspaceId_prefix: { workspaceId, prefix } },
        create: { workspaceId, prefix, nextValue: max + 1 },
        update: {},
      });
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const seq = await db.invoiceSequence.update({
        where: { workspaceId_prefix: { workspaceId, prefix } },
        data: { nextValue: { increment: 1 } },
      });
      const value = seq.nextValue - 1;
      const candidate = `${prefix}-${String(value).padStart(4, '0')}`;
      const clash = await db.invoice.findFirst({
        where: { workspaceId, OR: [{ invoiceNumber: candidate }, { quoteNumber: candidate }] },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new Error(`Could not allocate a number for series ${prefix}`);
  }
}
