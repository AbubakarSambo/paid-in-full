import { MonnifyService } from './monnify.service';
import * as hooks from '../invoices/collection-hook';

function build(mock = false) {
  const config = { get: (k: string) => ({ 'monnify.secretKey': 's', 'monnify.apiKey': 'k', 'monnify.contractCode': 'c', 'monnify.mockMode': mock })[k] };
  const prisma: any = { invoice: { findMany: jest.fn().mockResolvedValue([]) }, workspace: { findMany: jest.fn().mockResolvedValue([]) } };
  const svc = new MonnifyService(config as any, prisma, {} as any, {} as any, {} as any);
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { svc, prisma };
}
const tx = (reference: string, amount: number, status = 'PAID') => ({ reference, amount, status, paidAt: new Date('2026-11-20T10:00:00Z'), payerName: 'P', payerBank: 'B', payerAccountNumber: '1' });

describe('collection replay', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs invoice/mandate hooks first and only falls through to billing/wallet when unclaimed', async () => {
    const { svc } = build();
    jest.spyOn(svc, 'listReservedAccountTransactions').mockResolvedValue([tx('t1', 1000), tx('t2', 2000), tx('t3', 3000, 'PENDING'), tx('t4', 0)] as any);
    const hook = jest.spyOn(hooks, 'runMonnifyCollectionHooks').mockImplementation(async (e: any) => e.data.transactionReference === 't1');
    const fallthrough = jest.spyOn(svc as any, 'handleCollectionResult').mockResolvedValue(undefined);
    expect(await svc.replayAccountCollections('INV-1')).toEqual({ checked: 4 });
    expect(hook).toHaveBeenCalledTimes(2); // PENDING and zero-amount transactions are never replayed
    expect(fallthrough).toHaveBeenCalledTimes(1);
    expect(fallthrough).toHaveBeenCalledWith(expect.objectContaining({ transactionReference: 't2', amount: 2000, accountReference: 'INV-1' }));
  });

  it('polls open invoices and billing accounts, once per account, and is a no-op in mock mode', async () => {
    const { svc, prisma } = build();
    prisma.invoice.findMany.mockResolvedValue([{ collectionAccountRef: 'A' }, { collectionAccountRef: 'B' }]);
    prisma.workspace.findMany.mockResolvedValue([{ billingAccountRef: 'B' }, { billingAccountRef: 'C' }]);
    const replay = jest.spyOn(svc, 'replayAccountCollections').mockImplementation(async (ref) => { if (ref === 'C') throw new Error('boom'); return { checked: 1 }; });
    const r: any = await svc.pollCollectionAccounts();
    expect(replay.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'B', 'C']);
    expect(r).toMatchObject({ accounts: 2, errors: 1 });
    expect(await build(true).svc.pollCollectionAccounts()).toEqual({ skipped: true });
  });

  it('wallet balance is "unknown", not zero, when unconfigured or unreachable', async () => {
    const { svc } = build();
    expect(await svc.getWalletBalance()).toMatchObject({ available: null, reason: expect.stringContaining('MONNIFY_SOURCE_ACCOUNT_NUMBER') });
    (svc as any).sourceAccountNumber = '123';
    jest.spyOn(svc as any, 'authedRequest').mockRejectedValue(new Error('Monnify 503'));
    expect(await svc.getWalletBalance()).toEqual({ available: null, reason: 'Monnify 503' });
    (svc as any).authedRequest.mockResolvedValue({ responseBody: { availableBalance: 3278987.33 } });
    expect(await svc.getWalletBalance()).toEqual({ available: 3278987.33, reason: null });
    expect(await build(true).svc.getWalletBalance()).toEqual({ available: null, reason: null });
  });
});

describe('collection amounts: wallet is credited net of fees, invoices settle gross', () => {
  afterEach(() => jest.restoreAllMocks());

  it('replay passes the gross amount to invoice hooks and the net (settlement) amount to the wallet/billing path', async () => {
    const { svc } = build();
    jest.spyOn(svc, 'listReservedAccountTransactions').mockResolvedValue([{ ...tx('t1', 250_000), settlementAmount: 247_850 }] as any);
    const hook = jest.spyOn(hooks, 'runMonnifyCollectionHooks').mockResolvedValue(false);
    const fall = jest.spyOn(svc as any, 'handleCollectionResult').mockResolvedValue(undefined);
    await svc.replayAccountCollections('WS-1');
    expect((hook.mock.calls[0][0] as any).data.amountPaid).toBe(250_000);
    expect(fall).toHaveBeenCalledWith(expect.objectContaining({ amount: 247_850 }));
  });

  it('a live webhook credits settlementAmount to the wallet, falling back to amountPaid when absent', async () => {
    const { svc, prisma } = build();
    const wallet = { recordTopup: jest.fn().mockResolvedValue({ created: true, topupId: 'x' }) };
    (svc as any).walletService = wallet;
    prisma.walletTopup = { findUnique: jest.fn().mockResolvedValue(null) };
    prisma.workspace.findFirst = jest.fn(async (q: any) => (JSON.stringify(q.where).includes('billingAccount') ? null : { id: 'ws1' })); // billing lookup misses, wallet lookup hits
    jest.spyOn(hooks, 'runMonnifyCollectionHooks').mockResolvedValue(false);
    const body = (data: any) => JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentStatus: 'PAID', transactionReference: 'MNFY|1', product: { reference: 'WS-1' }, ...data } });
    jest.spyOn(svc, 'verifyWebhookSignature').mockReturnValue(true);

    await svc.processWebhook(body({ amountPaid: 250_000, settlementAmount: 247_850 }), 'sig');
    expect(wallet.recordTopup).toHaveBeenLastCalledWith('ws1', expect.objectContaining({ amount: 247_850 }));
    await svc.processWebhook(body({ amountPaid: 100_000 }), 'sig');
    expect(wallet.recordTopup).toHaveBeenLastCalledWith('ws1', expect.objectContaining({ amount: 100_000 }));
  });

  it('resolves the workspace by destination account number when the payload has no product reference', async () => {
    const { svc, prisma } = build();
    (svc as any).walletService = { recordTopup: jest.fn().mockResolvedValue({ created: true, topupId: 'x' }) };
    prisma.walletTopup = { findUnique: jest.fn().mockResolvedValue(null) };
    const find = (prisma.workspace.findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ws1' }));
    await (svc as any).handleCollectionResult({ transactionReference: 'T', amount: 5, accountNumber: '6734011681' });
    expect(find.mock.calls[1][0].where.OR).toEqual([{ monnifyReservedAccountNumber: '6734011681' }]);
    expect((svc as any).walletService.recordTopup).toHaveBeenCalled();
  });

  it('answers 422 (so Monnify retries) when a live collection matches no workspace', async () => {
    const { svc, prisma } = build();
    prisma.walletTopup = { findUnique: jest.fn().mockResolvedValue(null) };
    prisma.workspace.findFirst = jest.fn().mockResolvedValue(null);
    await expect((svc as any).handleCollectionResult({ transactionReference: 'T', amount: 5, accountNumber: '000' })).rejects.toThrow('not linked to a workspace');
  });
});
