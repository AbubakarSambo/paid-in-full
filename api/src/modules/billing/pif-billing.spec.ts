import { pifPaymentCoverage } from './pif-billing';

const managed = { monthly: 60_000, setupFee: 0, prepayMonths: 6, prepayMonthly: 55_000 };
const standalone = { monthly: 0, setupFee: 1_200_000, prepayMonths: 12, prepayMonthly: 0 };

describe('pifPaymentCoverage (Lovable billing-collection rules)', () => {
  it('buys whole months at the plan price, at least one', () => {
    expect(pifPaymentCoverage({ amount: 180_000, plan: managed, setupFeePaid: false, fallbackMonthly: 1 })).toEqual({ months: 3, coversSetup: false });
    expect(pifPaymentCoverage({ amount: 10_000, plan: managed, setupFeePaid: false, fallbackMonthly: 1 }).months).toBe(1);
  });

  it('buys the prepay bundle when the amount reaches prepayMonthly x prepayMonths (a discount over 6 x 60k)', () => {
    expect(pifPaymentCoverage({ amount: 330_000, plan: managed, setupFeePaid: false, fallbackMonthly: 1 }).months).toBe(6);
    expect(pifPaymentCoverage({ amount: 329_999, plan: managed, setupFeePaid: false, fallbackMonthly: 1 }).months).toBe(5);
  });

  it('a large-enough payment first covers an unpaid setup fee, and only the remainder buys months', () => {
    const plan = { ...managed, setupFee: 100_000 };
    expect(pifPaymentCoverage({ amount: 160_000, plan, setupFeePaid: false, fallbackMonthly: 1 })).toEqual({ months: 1, coversSetup: true });
    expect(pifPaymentCoverage({ amount: 160_000, plan, setupFeePaid: true, fallbackMonthly: 1 })).toEqual({ months: 2, coversSetup: false });
    expect(pifPaymentCoverage({ amount: 90_000, plan, setupFeePaid: false, fallbackMonthly: 1 }).coversSetup).toBe(false); // too small
  });

  it('a setup-fee-only plan (no monthly price) credits one month after the fee', () => {
    expect(pifPaymentCoverage({ amount: 1_200_000, plan: standalone, setupFeePaid: false, fallbackMonthly: 1 })).toEqual({ months: 1, coversSetup: true });
  });

  it('without a plan row, falls back to the workspace amount (never zero months)', () => {
    expect(pifPaymentCoverage({ amount: 120_000, plan: null, setupFeePaid: false, fallbackMonthly: 60_000 }).months).toBe(2);
  });
});
