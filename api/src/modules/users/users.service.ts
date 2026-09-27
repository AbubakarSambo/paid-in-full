import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string, workspaceId: string) {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, isPlatformAdmin: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    return { ...user, role: membership?.role ?? null, workspaceId };
  }

  async listWorkspaceMembers(workspaceId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true } } },
      orderBy: { invitedAt: 'asc' },
    });
    return members.map((m) => ({ ...m.user, role: m.role, isActive: m.isActive && m.user.isActive }));
  }
}
