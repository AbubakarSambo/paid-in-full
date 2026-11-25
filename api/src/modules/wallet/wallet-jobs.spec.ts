import { WalletService } from './wallet.service';

const noopLogger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

function build(opts: { mock?: boolean; workspaces?: any[]; list?: (ref: string) => any[]; recordTopup?: jest.Mock } = {}) {
  const prisma: any = {
    workspace: { findMany: jest.fn().mockResolvedValue(opts.workspaces ?? []) },
    payoutFundingWait: { findMany: jest.fn().mockResolvedValue([]) },
    batch: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
  const monnify: any = {
    mockMode: !!opts.mock,
    listReservedAccountTransactions: jest.fn(async (ref: string) => (opts.list ? opts.list(ref) : [])),
  };
  const notifications: any = { notify: jest.fn().mockResolvedValue({}) };
  const svc = new WalletService(prisma, audit, monnify, notifications);
  (svc as any).logger = noopLogger();
  if (opts.recordTopup) (svc as any).recordTopup = opts.recordTopup;
  return { svc, prisma, audit, monnify, notifications };
}

const paid = (reference: string, amount: number) => ({ reference, amount, status: 'PAID', paidAt: new Date(), payerName: 'A', payerBank: 'B', payerAccountNumber: '1' });

describe('monnify-poll (pollAllTopups)', () => {
  it('does nothing in mock mode (the mock listing is synthetic and would credit fake money)', async () => {
    const { svc, monnify } = build({ mock: true });
    expect(await svc.pollAllTopups()).toEqual({ skipped: true });
    expect(monnify.listReservedAccountTransactions).not.toHaveBeenCalled();
  });

  it('records only PAID, positive transactions and reports what was added', async () => {
    const recordTopup = jest.fn(async (_ws: string, p: any) => ({ created: p.reference !== 'dup', topupId: 'x' }));
    const { svc, audit } = build({
      workspaces: [{ id: 'w1', monnifyReservedAccountRef: 'ref1', monnifyReservedAccountNumber: '123' }],
      list: () => [paid('t1', 1000), paid('dup', 500), { ...paid('t3', 700), status: 'PENDING' }, paid('t4', 0)],
      recordTopup,
    });
    const r: any = await svc.pollAllTopups();
    expect(recordTopup).toHaveBeenCalledTimes(2); // t1 + dup; pending and zero-amount are skipped
    expect(r).toMatchObject({ workspaces: 1, checked: 4, added: 1, addedAmount: 1000, errors: 0 });
    expect(audit.record).toHaveBeenCalledTimes(1); // only workspaces where something was added are audited
  });

  it("one workspace's Monnify failure does not stop the others", async () => {
    const recordTopup = jest.fn(async () => ({ created: true, topupId: 'x' }));
    const { svc } = build({
      workspaces: [
        { id: 'bad', monnifyReservedAccountRef: 'bad', monnifyReservedAccountNumber: '1' },
        { id: 'ok', monnifyReservedAccountRef: 'ok', monnifyReservedAccountNumber: '2' },
      ],
      list: (ref) => {
        if (ref === 'bad') throw new Error('Monnify 503');
        return [paid('t1', 100)];
      },
      recordTopup,
    });
    const r: any = await svc.pollAllTopups();
    expect(r).toMatchObject({ workspaces: 1, errors: 1, added: 1 });
  });

  it('does not overlap itself', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const { svc, prisma } = build({ workspaces: [] });
    prisma.workspace.findMany.mockImplementation(async () => { await gate; return []; });
    const first = svc.pollAllTopups();
    expect(await svc.pollAllTopups()).toEqual({ skipped: true });
    release();
    await first;
  });
});
