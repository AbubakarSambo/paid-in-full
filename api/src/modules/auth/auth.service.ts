import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../common/decorators/roles.decorator';
import { RegisterDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private signToken(payload: { sub: string; email: string; workspaceId: string; roles: string[] }) {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.secret') || 'fallback-secret',
      expiresIn: (this.config.get<string>('jwt.expiresIn') || '7d') as any,
    });
  }

  private slugify(name: string) {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'workspace'
    );
  }

  /** Creates the workspace + its first user, who is always ADMIN of that workspace. */
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const baseSlug = this.slugify(dto.workspaceName);

    const result = await this.prisma.$transaction(async (tx) => {
      let slug = baseSlug;
      let suffix = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const clash = await tx.workspace.findUnique({ where: { slug } });
        if (!clash) break;
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
      }

      const workspace = await tx.workspace.create({
        data: {
          name: dto.workspaceName,
          slug,
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: Role.ADMIN,
          joinedAt: new Date(),
        },
      });

      return { workspace, user };
    });

    const accessToken = this.signToken({
      sub: result.user.id,
      email: result.user.email,
      workspaceId: result.workspace.id,
      roles: [Role.ADMIN],
    });

    return {
      accessToken,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
      workspace: { id: result.workspace.id, name: result.workspace.name, slug: result.workspace.slug },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id, isActive: true },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    if (memberships.length === 0) {
      throw new UnauthorizedException('This account is not a member of any workspace');
    }

    const primary = memberships[0];
    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      workspaceId: primary.workspaceId,
      roles: [primary.role],
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      workspace: primary.workspace,
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  }

  /** Re-issues a token scoped to a different workspace the user already belongs to. */
  async switchWorkspace(userId: string, workspaceId: string) {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        include: { workspace: { select: { id: true, name: true, slug: true } } },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!membership || !membership.isActive) {
      throw new UnauthorizedException('Not a member of this workspace');
    }

    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      workspaceId,
      roles: [membership.role],
    });

    return { accessToken, workspace: membership.workspace };
  }
}
