import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { MonnifyService } from '../monnify/monnify.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { InvoiceSettingsDto, PaymentAccountDto, SweepSettingsDto } from './dto';
import { INVOICE_CONFIG_KEYS as K, InvoiceConfigService, PaymentAccount } from './invoice-config.service';

/** Settings §6 (invoice payment account), §11 (auto-sweep), §24 (branding, numbering, VAT default). */
@Injectable()
export class InvoiceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InvoiceConfigService,
    private readonly monnify: MonnifyService,
    private readonly audit: AuditLogService,
  ) {}

  get(workspaceId: string) {
    return this.config.getSettings(workspaceId);
  }

  async update(user: CurrentUserData, dto: InvoiceSettingsDto) {
    const values: Record<string, unknown> = {
      [K.LOGO]: dto.logoUrl === undefined ? undefined : dto.logoUrl || null,
      [K.SIGNATURE]: dto.signatureUrl === undefined ? undefined : dto.signatureUrl || null,
      [K.THEME]: dto.themeColor?.replace(/^#/, '').toUpperCase(),
      [K.FOOTER]: dto.footerText === undefined ? undefined : dto.footerText || null,
      [K.INVOICE_PREFIX]: dto.invoicePrefix?.toUpperCase(),
      [K.QUOTE_PREFIX]: dto.quotePrefix?.toUpperCase(),
      [K.VAT_DEFAULT]: dto.vatOnNewInvoices,
      [K.DEFAULT_TERMS]: dto.defaultTerms,
    };
    if (dto.invoicePrefix && dto.quotePrefix && dto.invoicePrefix.toUpperCase() === dto.quotePrefix.toUpperCase()) {
      throw new BadRequestException('Invoice and quote prefixes must differ');
    }
    await this.config.set(user.workspaceId, values, user.id);
    if (dto.invoicePrefix) {
      await this.prisma.workspace.update({ where: { id: user.workspaceId }, data: { invoicePrefix: dto.invoicePrefix.toUpperCase() } });
    }
    await this.audit.record(user.workspaceId, user, AUDIT_ACTIONS.CONFIG_UPDATED, 'invoice_settings', {
      keys: Object.entries(values).filter(([, v]) => v !== undefined).map(([k]) => k),
    });
    return this.config.getSettings(user.workspaceId);
  }

  /** Verifies the account with Monnify name enquiry before saving it as the invoice revenue account. */
  async setPaymentAccount(user: CurrentUserData, dto: PaymentAccountDto) {
    const verified = await this.monnify.verifyBankAccount(dto.accountNumber, dto.bankCode);
    const banks = await this.monnify.listBanks();
    const account: PaymentAccount = {
      bankCode: dto.bankCode,
      bankName: banks.find((b) => b.code === dto.bankCode)?.name ?? null,
      accountNumber: verified.accountNumber,
      accountName: verified.accountName,
      verifiedAt: new Date().toISOString(),
    };
    await this.config.set(user.workspaceId, { [K.PAYMENT_ACCOUNT]: account }, user.id);
    await this.audit.record(user.workspaceId, user, AUDIT_ACTIONS.CONFIG_UPDATED, K.PAYMENT_ACCOUNT, {
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
    });
    return account;
  }

  async clearPaymentAccount(user: CurrentUserData) {
    await this.config.set(user.workspaceId, { [K.PAYMENT_ACCOUNT]: null }, user.id);
    await this.audit.record(user.workspaceId, user, AUDIT_ACTIONS.CONFIG_UPDATED, K.PAYMENT_ACCOUNT, { cleared: true });
    return { cleared: true };
  }

  getSweep(workspaceId: string) {
    return this.config.getSweepSettings(workspaceId);
  }

  async updateSweep(user: CurrentUserData, dto: SweepSettingsDto) {
    const current = await this.config.getSweepSettings(user.workspaceId);
    const bankCode = dto.bankCode ?? current.bankCode;
    const accountNumber = dto.accountNumber ?? current.accountNumber;
    const values: Record<string, unknown> = {
      [K.SWEEP_ENABLED]: dto.enabled,
      [K.SWEEP_BUFFER]: dto.buffer,
    };
    if (dto.bankCode !== undefined || dto.accountNumber !== undefined || dto.accountName !== undefined) {
      if (!bankCode || !accountNumber) throw new BadRequestException('Destination bank code and account number are both required');
      const verified = await this.monnify.verifyBankAccount(accountNumber, bankCode);
      const banks = await this.monnify.listBanks();
      Object.assign(values, {
        [K.SWEEP_BANK_CODE]: bankCode,
        [K.SWEEP_BANK_NAME]: banks.find((b) => b.code === bankCode)?.name ?? null,
        [K.SWEEP_ACCOUNT_NUMBER]: accountNumber,
        [K.SWEEP_ACCOUNT_NAME]: dto.accountName?.trim() || verified.accountName,
      });
    }
    const enabling = dto.enabled ?? current.enabled;
    if (enabling && !(bankCode && accountNumber)) {
      throw new BadRequestException('Set a sweep destination account before enabling auto-sweep');
    }
    await this.config.set(user.workspaceId, values, user.id);
    await this.audit.record(user.workspaceId, user, AUDIT_ACTIONS.CONFIG_UPDATED, 'invoice_sweep', {
      enabled: enabling,
      bankCode,
      accountNumber,
      buffer: dto.buffer ?? current.buffer,
    });
    return this.config.getSweepSettings(user.workspaceId);
  }
}
