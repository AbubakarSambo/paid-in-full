import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

/**
 * Throws 400 unless `coaTagId` is an active COA tag of `payCategoryId` in this workspace.
 * Returns the tag (with its category) so callers can denormalise names. A null/undefined
 * coaTagId is allowed (returns null). Use inside a transaction by passing `tx` as `client`.
 */
export async function assertCoaBelongsToCategory(
  client: Client,
  workspaceId: string,
  coaTagId: string | null | undefined,
  payCategoryId: string | null | undefined,
) {
  if (!coaTagId) return null;
  const tag = await client.coaTag.findFirst({
    where: { id: coaTagId, workspaceId },
    include: { payCategory: { select: { id: true, name: true, isActive: true } } },
  });
  if (!tag) throw new BadRequestException('COA tag not found in this workspace');
  if (!payCategoryId) throw new BadRequestException('Pick a payment category for this COA tag');
  if (tag.payCategoryId !== payCategoryId) {
    throw new BadRequestException(`COA "${tag.name}" belongs to ${tag.payCategory.name}, not the selected payment category`);
  }
  if (!tag.isActive) throw new BadRequestException(`COA "${tag.name}" is no longer active`);
  return tag;
}
