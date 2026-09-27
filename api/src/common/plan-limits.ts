// Matches the marketing site's three tiers.
export const PLAN_LIMITS = {
  STARTER: {
    maxUsers: 3,
    maxDisbursementsPerMonth: 50,
    restrictedPages: [] as string[],
  },
  GROWTH: {
    maxUsers: Infinity,
    maxDisbursementsPerMonth: Infinity,
    restrictedPages: [] as string[],
  },
  ENTERPRISE: {
    maxUsers: Infinity,
    maxDisbursementsPerMonth: Infinity,
    restrictedPages: [] as string[],
  },
} as const;

export const PLAN_PRICES = {
  GROWTH: { monthly: 45000 },
} as const;
