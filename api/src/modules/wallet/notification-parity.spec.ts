import { PayoutLedgerService } from './payout-ledger.service';
import { WalletService } from './wallet.service';

function ledger(opts: { item?: any; requisition?: any; users?: any[] } = {}) {
  const sent: any[] = [];
  const prisma: any = {
    batchItem: { findUnique: jest.fn().mockResolvedValue(opts.item === undefined ? { id: 'i1', vendorName: 'Acme Ltd', total: 125000.5, createdById: 'u1', requisitionId: 'r1', batch: { batchRef: 'BATCH-9', workspace: { name: 'Yellow Door' } }, payouts: [{ createdAt: new Date() }] } : opts.item) },
    requisition: { findUnique: jest.fn().mockResolvedValue(opts.requisition === undefined ? { requestedById: 'u2' } : opts.requisition) },
    user: { findMany: jest.fn().mockResolvedValue(opts.users ?? [{ email: 'Queuer@x.com', displayName: 'Queuer', firstName: 'Q' }, { email: 'req@x.com', displayName: null, firstName: 'Req' }]) },
  };
  const email: any = { send: jest.fn(async (...a: any[]) => sent.push(a)) };
  const svc = new PayoutLedgerService(prisma, email);
  (svc as any).logger = { warn: jest.fn() };
  return { svc, prisma, email, sent };
}

describe('"payment made" emails (Lovable parity)', () => {
  it('emails the queuer and the requisitor once each with the payment details', async () => {
    const { svc, sent } = ledger();
    await svc.notifyPaid(['i1']);
    expect(sent.map((s) => s[0]).sort()).toEqual(['queuer@x.com', 'req@x.com']);
    expect(sent[0][1]).toBe('PAYMENT_MADE');
    expect(sent[0][2]).toMatchObject({ vendorName: 'Acme Ltd', batchRef: 'BATCH-9', workspaceName: 'Yellow Door' });
    expect(sent[0][2].amount).toContain('125,000.50');
  });

  it('sends one email when the queuer is also the requisitor (same address)', async () => {
    const { svc, sent } = ledger({ users: [{ email: 'same@x.com', displayName: 'S', firstName: 'S' }, { email: 'SAME@x.com', displayName: 'S', firstName: 'S' }] });
    await svc.notifyPaid(['i1']);
    expect(sent).toHaveLength(1);
  });

  it('a mail failure never throws', async () => {
    const { svc, email } = ledger();
    email.send.mockRejectedValue(new Error('resend down'));
    await expect(svc.notifyPaid(['i1'])).resolves.toBeUndefined();
  });

  const item = (createdAt: Date[]) => ({ id: 'i1', vendorName: 'Acme Ltd', total: 100, createdById: 'u1', requisitionId: 'r1', batch: { batchRef: 'B', workspace: { name: 'W' } }, payouts: createdAt.map((c) => ({ createdAt: c })) });

  it('never emails about a payment whose legs are old (imported history / re-derived status)', async () => {
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const { svc, email } = ledger({ item: item([old, old]) });
    await svc.notifyPaid(['i1']);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('still emails when the payment is fresh', async () => {
    const { svc, email } = ledger({ item: item([new Date(Date.now() - 10 * 60 * 1000)]) });
    await svc.notifyPaid(['i1']);
    expect(email.send).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an unknown line', async () => {
    const { svc, email } = ledger({ item: null });
    await svc.notifyPaid(['gone']);
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('wallet top-up push (Lovable parity)', () => {
  function wallet() {
    const prisma: any = { workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]) } };
    const notifications: any = { notify: jest.fn().mockResolvedValue({}) };
    const svc = new WalletService(prisma, {} as any, {} as any, notifications);
    (svc as any).logger = { warn: jest.fn() };
    return { svc, notifications };
  }

  it('notifies every active member with the amount and payer', async () => {
    const { svc, notifications } = wallet();
    await (svc as any).notifyTopup('w1', { amount: 247850.4, payerName: 'ACME', source: 'WEBHOOK' });
    expect(notifications.notify).toHaveBeenCalledWith('w1', 'disbursement_result', expect.objectContaining({ title: 'Wallet top-up: ₦247,850', body: 'From ACME', recipientUserIds: ['a', 'b'] }));
  });

  it('does not notify for a back-fill (reconciliation) credit', async () => {
    const { svc, notifications } = wallet();
    (svc as any).prisma.$transaction = jest.fn().mockResolvedValue({ created: true, topupId: 't', funded: [] });
    (svc as any).audit = { record: jest.fn() };
    await svc.recordTopup('w1', { reference: 'R', amount: 100, source: 'MANUAL_RECONCILIATION' } as any);
    expect(notifications.notify).not.toHaveBeenCalled();
    await svc.recordTopup('w1', { reference: 'R2', amount: 100, source: 'WEBHOOK' } as any);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
});
