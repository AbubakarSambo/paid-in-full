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
