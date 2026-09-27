import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { UpdateWorkspaceDto, InviteMemberDto } from './dto';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async update(id: string, dto: UpdateWorkspaceDto) {
    await this.findOne(id);
    return this.prisma.workspace.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.invoicePrefix && { invoicePrefix: dto.invoicePrefix }),
        ...(typeof dto.taxRate === 'number' && { taxRate: dto.taxRate }),
      },
    });
  }

  /**
   * Adds an existing user to the workspace, or — if the email has never signed up — creates an
   * inactive placeholder User plus a SET_PASSWORD verification token so they can claim the
   * account. Email delivery of that token is wired in the email module (see EmailService).
   */
  async inviteMember(workspaceId: string, dto: InviteMemberDto) {
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      const randomPasswordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: randomPasswordHash,
          firstName: '',
          lastName: '',
          isActive: false,
        },
      });
    }

    const existingMembership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existingMembership) {
      throw new ConflictException('This person is already a member of the workspace');
    }

    const membership = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: dto.role },
    });

    const token = await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token: randomBytes(32).toString('hex'),
        type: 'SET_PASSWORD',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    try {
      await this.emailService.send(user.email, 'INVITE', {
        token: token.token,
        workspaceName: workspace?.name || 'your workspace',
        firstName: user.firstName || undefined,
      });
    } catch (error) {
      // Don't fail the invite if the email provider is briefly down — the token still
      // works, and the invite can be resent/shared manually.
      this.logger.error(`Failed to send invite email to ${user.email}`, error as Error);
    }

    return { membership, inviteToken: token.token };
  }

  async removeMember(workspaceId: string, userId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    return this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { isActive: false },
    });
  }
}
