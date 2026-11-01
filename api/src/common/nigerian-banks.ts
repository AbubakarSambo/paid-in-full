/**
 * Nigerian banks (spec §5.4) with the bank codes Monnify's disbursement / account-validate APIs
 * accept: CBN 3-digit codes for commercial banks, NIBSS institution codes for MFBs/fintechs.
 * Codes for the smaller fintechs were taken from Monnify's public GET /api/v1/banks list and are
 * NOT verified against a live sandbox from this environment; in live mode the vendors service
 * merges this list with Monnify's own response.
 */
export interface NigerianBank {
  name: string;
  code: string;
  /** Extra spellings used when matching a bank typed in a CSV. */
  aliases?: string[];
}

export const NIGERIAN_BANKS: NigerianBank[] = [
  { name: 'Access Bank', code: '044', aliases: ['access', 'access bank plc'] },
  { name: 'Access Bank (Diamond)', code: '063', aliases: ['diamond', 'diamond bank'] },
  { name: 'Guaranty Trust Bank', code: '058', aliases: ['gtb', 'gtbank', 'gt bank', 'guaranty trust'] },
  { name: 'Zenith Bank', code: '057', aliases: ['zenith'] },
  { name: 'United Bank for Africa', code: '033', aliases: ['uba'] },
  { name: 'First Bank of Nigeria', code: '011', aliases: ['first bank', 'firstbank', 'fbn'] },
  { name: 'First City Monument Bank', code: '214', aliases: ['fcmb'] },
  { name: 'Fidelity Bank', code: '070', aliases: ['fidelity'] },
  { name: 'Stanbic IBTC Bank', code: '221', aliases: ['stanbic', 'stanbic ibtc', 'ibtc'] },
  { name: 'Sterling Bank', code: '232', aliases: ['sterling'] },
  { name: 'Union Bank of Nigeria', code: '032', aliases: ['union', 'union bank'] },
  { name: 'Wema Bank', code: '035', aliases: ['wema', 'alat', 'wema alat', 'alat by wema'] },
  { name: 'Moniepoint MFB', code: '50515', aliases: ['moniepoint', 'moniepoint microfinance bank'] },
  { name: 'OPay', code: '999992', aliases: ['opay', 'paycom', 'o pay'] },
  { name: 'PalmPay', code: '999991', aliases: ['palmpay', 'palm pay'] },
  { name: 'Kuda Bank', code: '50211', aliases: ['kuda', 'kuda mfb', 'kuda microfinance bank'] },
  { name: 'Providus Bank', code: '101', aliases: ['providus'] },
  { name: 'Polaris Bank', code: '076', aliases: ['polaris', 'skye bank'] },
  { name: 'Keystone Bank', code: '082', aliases: ['keystone'] },
  { name: 'Ecobank Nigeria', code: '050', aliases: ['ecobank', 'eco bank'] },
  { name: 'Jaiz Bank', code: '301', aliases: ['jaiz'] },
  { name: 'TAJBank', code: '302', aliases: ['taj', 'taj bank'] },
  { name: 'Lotus Bank', code: '303', aliases: ['lotus'] },
  { name: 'Globus Bank', code: '00103', aliases: ['globus'] },
  { name: 'Optimus Bank', code: '107', aliases: ['optimus'] },
  { name: 'Parallex Bank', code: '104', aliases: ['parallex'] },
  { name: 'PremiumTrust Bank', code: '105', aliases: ['premium trust', 'premiumtrust'] },
  { name: 'Titan Trust Bank', code: '102', aliases: ['titan', 'titan trust'] },
  { name: 'Unity Bank', code: '215', aliases: ['unity'] },
  { name: 'Heritage Bank', code: '030', aliases: ['heritage'] },
  { name: 'Citibank Nigeria', code: '023', aliases: ['citi', 'citibank'] },
  { name: 'Standard Chartered Bank', code: '068', aliases: ['standard chartered', 'stanchart', 'scb'] },
  { name: 'SunTrust Bank', code: '100', aliases: ['suntrust', 'sun trust'] },
  { name: 'Tatum Bank', code: '000025', aliases: ['tatum'] },
  { name: 'Signature Bank', code: '106', aliases: ['signature', 'alternative bank', 'alt bank', 'the alternative bank'] },
  { name: 'Carbon', code: '565', aliases: ['carbon', 'carbon mfb', 'one finance'] },
  { name: 'VFD Microfinance Bank', code: '566', aliases: ['vfd', 'vfd mfb', 'v bank', 'vbank'] },
  { name: 'Renmoney MFB', code: '50767', aliases: ['renmoney', 'ren money'] },
  { name: 'LAPO Microfinance Bank', code: '50549', aliases: ['lapo', 'lapo mfb'] },
  { name: 'BuyPower MFB', code: '50645', aliases: ['buypower', 'buy power'] },
  { name: 'Nombank MFB', code: '50072', aliases: ['nombank', 'nom bank'] },
  { name: 'Rubies MFB', code: '125', aliases: ['rubies'] },
  { name: 'Sparkle MFB', code: '51310', aliases: ['sparkle'] },
  { name: 'FairMoney MFB', code: '51318', aliases: ['fairmoney', 'fair money'] },
  { name: 'Paystack-Titan', code: '100039', aliases: ['paystack'] },
];

function norm(s: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function bankNameForCode(code: string | null | undefined, banks: NigerianBank[] = NIGERIAN_BANKS): string | undefined {
  if (!code) return undefined;
  return banks.find((b) => b.code === code.trim())?.name;
}

/** Resolve a bank typed as a code or a (loosely spelled) name. */
export function resolveBank(input: string | null | undefined, banks: NigerianBank[] = NIGERIAN_BANKS): NigerianBank | undefined {
  const raw = (input ?? '').trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return banks.find((b) => b.code === raw || b.code === raw.padStart(3, '0'));
  const n = norm(raw);
  const stripped = n.replace(/\b(plc|limited|ltd|nigeria|of|bank|mfb|microfinance)\b/g, '').replace(/\s+/g, ' ').trim();
  return (
    banks.find((b) => norm(b.name) === n) ??
    banks.find((b) => (b.aliases ?? []).some((a) => norm(a) === n || norm(a) === stripped)) ??
    banks.find((b) => stripped.length >= 3 && norm(b.name).startsWith(stripped))
  );
}
