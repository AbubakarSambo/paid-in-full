import { Prisma, WorkspaceStatus } from '@prisma/client';

export const TRIAL_DAYS = 14;

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'workspace'
  );
}

export async function uniqueSlug(tx: Prisma.TransactionClient, base: string) {
  const root = slugify(base);
  let slug = root;
  for (let i = 1; await tx.workspace.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${root}-${i}`;
  }
  return slug;
}

/**
 * Creates a workspace row with trial defaults (spec §14: new clients start on TRIAL). Used by
 * register, "create new workspace" and the super-admin "New client" flow.
 */
export async function createWorkspaceRecord(
  tx: Prisma.TransactionClient,
  data: { name: string; slug?: string; status?: WorkspaceStatus; monthlyAmount?: number | null; industry?: string | null },
) {
  const slug = await uniqueSlug(tx, data.slug || data.name);
  const trialEndDate = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const workspace = await tx.workspace.create({
    data: {
      name: data.name.trim(),
      slug,
      status: data.status ?? WorkspaceStatus.TRIAL,
      trialEndDate,
      nextDueDate: trialEndDate,
      monthlyAmount: data.monthlyAmount ?? undefined,
      industry: data.industry ?? undefined,
    },
  });
  // Explicit false => the admin is routed to /onboarding (workspaces without the key are treated as set up).
  await tx.appConfig.create({ data: { workspaceId: workspace.id, key: 'setup_wizard_done', value: false } });
  await tx.appConfig.create({ data: { workspaceId: workspace.id, key: 'setup_workspace_created_done', value: true } });
  return workspace;
}
