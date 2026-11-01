/**
 * End-to-end money-movement check in Monnify MOCK mode against the LOCAL database and seed data.
 *
 *   cd api && MONNIFY_MOCK_MODE=true npx ts-node --transpile-only scripts/disburse-smoke.ts
 *
 * Scenario A: disburse (vendor leg + WHT leg + a skipped line) → webhook success (delivered twice)
 *             → retry with the same clientRequestId recovers from the ledger without re-sending.
 * Scenario B: phase B "crashes" after the plan is written → retry resumes (status check, then send)
 *             → Check status settles it.
 * Guards:     new request on a paid line is refused; wallet maths; typed-total and PIN checks.
 * Everything the script creates is removed at the end (app config restored).
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';

process.env.MONNIFY_MOCK_MODE = 'true';
process.env.MONNIFY_MOCK_AUTO_COMPLETE = 'false';

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  const { AppModule } = await import('../src/app.module');
  const { PrismaService } = await import('../src/modules/prisma/prisma.service');
  const { DisbursementService } = await import('../src/modules/batches/disbursement.service');
  const { BatchesService } = await import('../src/modules/batches/batches.service');
  const { WalletService } = await import('../src/modules/wallet/wallet.service');
  const { MonnifyService } = await import('../src/modules/monnify/monnify.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const disb = app.get(DisbursementService);
  const batches = app.get(BatchesService);
  const wallet = app.get(WalletService);
  const monnify = app.get(MonnifyService);
  check(monnify.mockMode, 'Monnify is in mock mode');
  if (!monnify.mockMode) throw new Error('Refusing to run outside mock mode');

  const ws = await prisma.workspace.findUniqueOrThrow({ where: { slug: 'demo' } });
  const payerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'payer@demo.test' } });
  const user: any = {
    id: payerUser.id,
    email: payerUser.email,
    workspaceId: ws.id,
    role: 'PAYER',
    isBiller: false,
    roles: ['PAYER'],
    firstName: payerUser.firstName,
    lastName: payerUser.lastName,
    displayName: payerUser.displayName ?? payerUser.firstName,
    platformRole: null,
    isPlatformAdmin: false,
  };
  const vendors = await prisma.vendor.findMany({ where: { workspaceId: ws.id, bankCode: { not: null }, bankAccountNumber: { not: null } }, take: 2 });
  const tag = `SMOKE-${Date.now()}`;
  const created = { batchIds: [] as string[], topupRefs: [] as string[] };
  const prevWhtCfg = await prisma.appConfig.findMany({ where: { workspaceId: ws.id, key: { startsWith: 'wht_account' } } });

  const mkBatch = async (suffix: string, lines: Array<{ vendor: (typeof vendors)[number]; total: number; wht: number; noBank?: boolean }>) => {
    const b = await prisma.batch.create({
      data: {
        workspaceId: ws.id,
        batchRef: `${tag} ${suffix}`,
        payCategoryName: 'OPEX',
        total: lines.reduce((s, l) => s + l.total, 0),
        createdById: user.id,
        approvedById: user.id,
        approvedAt: new Date(),
        items: {
          create: lines.map((l, i) => ({
            vendorId: l.vendor.id,
            vendorName: l.vendor.name,
            vendorBank: l.vendor.bankName,
            vendorBankCode: l.noBank ? null : l.vendor.bankCode,
            vendorAcctNo: l.noBank ? null : l.vendor.bankAccountNumber,
            vendorAcctName: l.vendor.verifiedAccountName ?? l.vendor.accountName,
            description: `Smoke line ${i + 1} – Test – 1 – 31/10/2026`,
            total: l.total,
            whtRate: l.wht ? l.wht / l.total : 0,
            whtAmount: l.wht,
            netAmount: l.total - l.wht,
          })),
        },
      },
      include: { items: { orderBy: { total: 'desc' } } },
    });
    created.batchIds.push(b.id);
    return b;
  };

  try {
    // ── Setup: WHT destination + wallet funds
    for (const [key, value] of [
      ['wht_account_number', '1234567890'],
      ['wht_account_bank_code', '058'],
      ['wht_account_name', 'FIRS WHT Collections'],
    ] as const) {
      await prisma.appConfig.upsert({ where: { workspaceId_key: { workspaceId: ws.id, key } }, update: { value }, create: { workspaceId: ws.id, key, value } });
    }
    const before = await wallet.getBalance(ws.id);
    const topupRef = `${tag}-TOPUP`;
    created.topupRefs.push(topupRef);
    const t1 = await wallet.recordTopup(ws.id, { reference: topupRef, amount: 5_000_000, source: 'WEBHOOK', payerName: 'Smoke Funder' });
    const t2 = await wallet.recordTopup(ws.id, { reference: topupRef, amount: 5_000_000, source: 'WEBHOOK', payerName: 'Smoke Funder' });
    const funded = await wallet.getBalance(ws.id);
    console.log('\nSetup');
    check(t1.created && !t2.created, 'top-up is idempotent on reference');
    check(Math.round(funded.balance - before.balance) === 5_000_000, `wallet +₦5,000,000 (balance ${funded.balance})`);

    // ── Scenario A
    console.log('\nScenario A: disburse → webhook → retry recovers');
    const A = await mkBatch('A', [
      { vendor: vendors[0], total: 100_000, wht: 5_000 },
      { vendor: vendors[1], total: 40_000, wht: 0 },
      { vendor: vendors[1], total: 10_000, wht: 0, noBank: true },
    ]);
    const [whtLine, plainLine, noBankLine] = A.items;
    const lines = A.items.map((i) => ({ itemId: i.id }));
    const preview = await disb.preview(ws.id, A.id, { lines });
    check(preview.total === 140_000 && preview.transfers === 3, `preview total ₦140,000 in 3 transfers (got ${preview.total}/${preview.transfers})`);
    check(preview.lines.find((l) => l.itemId === noBankLine.id)?.status === 'SKIPPED', 'line without bank details will be skipped');

    const badTotal = await disb.disburse(user, A.id, { lines, clientRequestId: randomUUID(), typedTotal: 139_999, pin: '1234' }).catch((e) => e);
    check(badTotal instanceof Error && /Typed total/.test(badTotal.message), 'wrong typed total is refused');
    const badPin = await disb.disburse(user, A.id, { lines, clientRequestId: randomUUID(), typedTotal: 140_000, pin: '9999' }).catch((e) => e);
    check(badPin instanceof Error, 'wrong PIN is refused');
    await prisma.userSecurity.updateMany({ where: { userId: user.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } as any });

    const reqA = randomUUID();
    const r1 = await disb.disburse(user, A.id, { lines, clientRequestId: reqA, typedTotal: 140_000, pin: '1234' });
    check(r1.summary.awaiting === 2 && r1.summary.skipped === 1, `first call: 2 awaiting confirmation, 1 skipped (got ${JSON.stringify(r1.summary)})`);
    const legsA = await prisma.batchItemPayout.findMany({ where: { clientRequestId: reqA } });
    check(legsA.length === 3 && legsA.filter((l) => l.leg === 'WHT').length === 1, '3 payout legs written (2 vendor + 1 WHT)');
    const whtLeg = legsA.find((l) => l.leg === 'WHT');
    check(Number(whtLeg?.amount) === 5_000 && whtLeg?.destinationAccountNumber === '1234567890', 'WHT leg ₦5,000 goes to the WHT account');
    const inflight = await wallet.getBalance(ws.id);
    check(Math.round(inflight.inFlightDebits - funded.inFlightDebits) === 140_000, 'wallet shows ₦140,000 in-flight debits');
    check(Math.round(funded.balance - inflight.balance) === 140_000, 'ready-to-send dropped by ₦140,000');

    const concurrent = await disb.disburse(user, A.id, { lines: [{ itemId: plainLine.id }], clientRequestId: randomUUID(), typedTotal: 40_000, pin: '1234' }).catch((e) => e);
    check(concurrent instanceof Error, 'a second request for an in-flight line is refused');

    for (const ref of new Set(legsA.map((l) => l.transferReference!))) {
      const body = JSON.stringify({ eventType: 'SUCCESSFUL_DISBURSEMENT', eventData: { reference: ref, status: 'SUCCESS' } });
      await monnify.processWebhook(body, undefined);
      await monnify.processWebhook(body, undefined); // duplicate delivery
    }
    const afterHook = await batches.findOne(ws.id, A.id);
    const lineA = (id: string) => afterHook.items.find((i) => i.id === id)!;
    check(lineA(whtLine.id).payoutStatus === 'SUCCESS' && lineA(whtLine.id).paid === 100_000, 'WHT line fully paid (₦95,000 net + ₦5,000 WHT)');
    check(lineA(plainLine.id).payoutStatus === 'SUCCESS', 'plain line paid');
    check(lineA(noBankLine.id).payoutStatus === 'SKIPPED', 'no-bank line SKIPPED');
    check(afterHook.payoutStatus === 'PARTIAL', `batch PARTIAL (one line still owed) — got ${afterHook.payoutStatus}`);
    const whtRows = await prisma.whtLedger.count({ where: { reference: whtLeg!.reference } });
    check(whtRows === 1, 'duplicate webhook did not double-count (1 WHT ledger row)');
    const settled = await wallet.getBalance(ws.id);
    check(Math.round(settled.balance - inflight.balance) === 0 && Math.round(settled.completedDebits - inflight.completedDebits) === 140_000, 'debits moved from in-flight to completed');

    const r2 = await disb.disburse(user, A.id, { lines, clientRequestId: reqA, typedTotal: 140_000, pin: '1234' });
    const legsA2 = await prisma.batchItemPayout.count({ where: { batchItem: { batchId: A.id } } });
    check(r2.recovered === true && r2.summary.paid === 2 && r2.summary.skipped === 1, `retry with same clientRequestId recovered: ${r2.summary.paid} paid, ${r2.summary.skipped} skipped`);
    check(legsA2 === 3, 'retry sent nothing new (still 3 legs)');
    const fromLedger = await disb.getRequestResult(ws.id, A.id, reqA);
    check((fromLedger as any).found && (fromLedger as any).summary.paid === 2, 'GET recovery endpoint reads the same outcome');
    const again = await disb.disburse(user, A.id, { lines: [{ itemId: plainLine.id }], clientRequestId: randomUUID(), typedTotal: 40_000, pin: '1234' }).catch((e) => e);
    check(again instanceof Error && /Already paid/.test(JSON.stringify((again as any).response ?? again.message)), 'new request on a paid line is refused (no double pay)');

    // ── Scenario B
    console.log('\nScenario B: interrupted after the plan is written → retry resumes → Check status');
    const B = await mkBatch('B', [{ vendor: vendors[0], total: 25_000, wht: 0 }]);
    const reqB = randomUUID();
    const realSend = (disb as any).sendTransfers.bind(disb);
    (disb as any).sendTransfers = async () => undefined; // simulate a crash right after phase A
    const b1 = await disb.disburse(user, B.id, { lines: [{ itemId: B.items[0].id }], clientRequestId: reqB, typedTotal: 25_000, pin: '1234' });
    (disb as any).sendTransfers = realSend;
    const pendingLeg = await prisma.batchItemPayout.findFirstOrThrow({ where: { clientRequestId: reqB } });
    check(b1.summary.awaiting === 1 && pendingLeg.status === 'PENDING', 'after the interruption the leg is PENDING (never sent)');
    const b2 = await disb.disburse(user, B.id, { lines: [{ itemId: B.items[0].id }], clientRequestId: reqB, typedTotal: 25_000, pin: '1234' });
    const sentLeg = await prisma.batchItemPayout.findUniqueOrThrow({ where: { id: pendingLeg.id } });
    check(b2.recovered && sentLeg.status === 'PROCESSING', 'retry resumed: status-checked (not found) then sent once');
    const b3 = await disb.disburse(user, B.id, { lines: [{ itemId: B.items[0].id }], clientRequestId: reqB, typedTotal: 25_000, pin: '1234' });
    check(b3.summary.awaiting === 1, 'a third retry does not resend while awaiting confirmation');
    const cs = await disb.checkStatus(ws.id, B.id);
    const afterCs = await batches.findOne(ws.id, B.id);
    check(cs.success === 1 && afterCs.payoutStatus === 'SUCCESS', `Check status settled it: batch ${afterCs.payoutStatus}`);
    const legsB = await prisma.batchItemPayout.count({ where: { batchItem: { batchId: B.id } } });
    check(legsB === 1, 'exactly one transfer leg for batch B');
  } finally {
    // ── Cleanup
    const payoutIds = (await prisma.batchItemPayout.findMany({ where: { batchItem: { batchId: { in: created.batchIds } } }, select: { id: true } })).map((p) => p.id);
    const topups = await prisma.walletTopup.findMany({ where: { reference: { in: created.topupRefs } }, select: { id: true } });
    await prisma.walletLedgerEntry.deleteMany({ where: { workspaceId: ws.id, sourceId: { in: [...payoutIds, ...topups.map((t) => t.id)] } } });
    await prisma.walletTopup.deleteMany({ where: { id: { in: topups.map((t) => t.id) } } });
    await prisma.payoutFundingWait.deleteMany({ where: { batchId: { in: created.batchIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: created.batchIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { workspaceId: ws.id, action: 'BATCH_DISBURSE', resultSnapshot: { path: ['batchRef'], string_starts_with: tag } } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws.id, target: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws.id, target: { startsWith: `${tag}-TOPUP` } } });
    await prisma.appConfig.deleteMany({ where: { workspaceId: ws.id, key: { startsWith: 'wht_account' } } });
    for (const row of prevWhtCfg) await prisma.appConfig.create({ data: { workspaceId: row.workspaceId, key: row.key, value: row.value as any } });
    await app.close();
  }

  console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
