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

describe('monnify-sweep (runSweep / sweepWorkspace)', () => {
  function sweepEnv(opts: { ledger: number; wait?: number; prev?: any }) {
    const created: any[] = [];
    const waitUpdates: any[] = [];
    const prisma: any = {
      walletSweep: { findFirst: jest.fn().mockResolvedValue(opts.prev ?? null), create: jest.fn(async ({ data }: any) => created.push(data)) },
      payoutFundingWait: {
        findMany: jest.fn().mockResolvedValue(opts.wait == null ? [] : [{ id: 'w1', batchId: 'b1', requiredAmount: opts.wait }]),
        update: jest.fn(async (a: any) => waitUpdates.push(a)),
      },
      batch: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', batchRef: 'BATCH-1' }]) },
      $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const { svc, notifications } = build();
    (svc as any).prisma = prisma;
    (svc as any).computeBalance = jest.fn().mockResolvedValue({ balance: opts.ledger, readyToSend: Math.max(0, opts.ledger) });
    return { svc, prisma, created, waitUpdates, notifications };
  }

  it('ready to pay is the lower of ledger and live balance; the difference is "clearing"', async () => {
    const { svc, created } = sweepEnv({ ledger: 1_000_000 });
    const r = await svc.sweepWorkspace('w', { available: 400_000, reason: null });
    expect(r).toMatchObject({ status: 'clearing', readyToPay: 400_000, clearing: 600_000 });
    expect(created[0]).toMatchObject({ liveWalletBalance: 400_000, ledgerAvailable: 1_000_000, clearing: 600_000, status: 'clearing' });
  });

  it('an unreachable Monnify is "blocked" and the ledger balance stands; it is never read as zero', async () => {
    const { svc, created } = sweepEnv({ ledger: 500_000, wait: 300_000 });
    const r = await svc.sweepWorkspace('w', { available: null, reason: 'Monnify 503' });
    expect(r).toMatchObject({ status: 'blocked', readyToPay: 500_000, clearing: 0, notified: 1 });
    expect(created[0]).toMatchObject({ status: 'blocked', reason: 'Monnify 503', liveWalletBalance: null });
  });

  it('records how much the live wallet grew since the previous check', async () => {
    const prev = { liveWalletBalance: 100_000, ledgerAvailable: 100_000, clearing: 0, status: 'ok', reason: null };
    const { svc, created } = sweepEnv({ ledger: 350_000, prev });
    const r = await svc.sweepWorkspace('w', { available: 350_000, reason: null });
    expect(r.released).toBe(250_000);
    expect(created[0].releasedAmount).toBe(250_000);
  });

  it('writes no new row when nothing changed since the last check', async () => {
    const prev = { liveWalletBalance: 100_000, ledgerAvailable: 100_000, clearing: 0, status: 'ok', reason: null };
    const { svc, created } = sweepEnv({ ledger: 100_000, prev });
    await svc.sweepWorkspace('w', { available: 100_000, reason: null });
    expect(created).toHaveLength(0);
  });

  it('resolves and notifies a waiting batch only once it is affordable from the live wallet', async () => {
    const short = sweepEnv({ ledger: 1_000_000, wait: 800_000 });
    expect((await short.svc.sweepWorkspace('w', { available: 500_000, reason: null })).notified).toBe(0); // ledger says yes, Monnify says not yet
    expect(short.waitUpdates).toHaveLength(0);

    const ok = sweepEnv({ ledger: 1_000_000, wait: 800_000 });
    expect((await ok.svc.sweepWorkspace('w', { available: 900_000, reason: null })).notified).toBe(1);
    expect(ok.waitUpdates[0].data).toMatchObject({ status: 'FUNDED' });
    expect(ok.notifications.notify).toHaveBeenCalledWith('w', 'disbursement_result', expect.objectContaining({ title: expect.stringContaining('BATCH-1') }));
  });
});
