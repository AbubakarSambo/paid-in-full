import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from '../security/security.service';
import { storeImage, UploadedImageFile } from '../uploads/image-upload';
import { UpdateProfileDto } from './dto';

const AVATAR_MAX_BYTES = 1024 * 1024; // spec §5.10 #1: 1 MB

/** "Your profile" + "Appearance" (spec §5.10 #1–2). */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private security: SecurityService,
  ) {}

  async me(userId: string, workspaceId: string) {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          displayName: true,
          avatarUrl: true,
          accentSkin: true,
          onboarded: true,
          isEmailVerified: true,
          hasPassword: true,
          googleSub: true,
          platformRole: true,
          security: { select: { pinHash: true, pinSetAt: true } },
        },
      }),
      workspaceId
        ? this.prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
            select: { role: true, isBiller: true },
          })
        : null,
    ]);

    if (!user) throw new NotFoundException('User not found');
    const { security, googleSub, ...rest } = user;
    return {
      ...rest,
      displayName: user.displayName || `${user.firstName} ${user.lastName}`.trim() || user.email,
      googleLinked: !!googleSub,
      isPlatformAdmin: user.platformRole === 'SUPER_ADMIN',
      hasPin: !!security?.pinHash,
      pinSetAt: security?.pinSetAt ?? null,
      role: membership?.role ?? null,
      isBiller: membership?.isBiller ?? false,
      workspaceId,
    };
  }

  async updateProfile(userId: string, workspaceId: string, dto: UpdateProfileDto) {
    if (dto.displayName !== undefined && !dto.displayName.trim()) throw new BadRequestException('Display name cannot be empty.');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName.trim() }),
        ...(dto.firstName !== undefined && { firstName: dto.firstName.trim() }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() || null }),
        ...(dto.accentSkin !== undefined && { accentSkin: dto.accentSkin }),
        ...(dto.onboarded !== undefined && { onboarded: dto.onboarded }),
      },
    });
    return this.me(userId, workspaceId);
  }

  async uploadAvatar(userId: string, workspaceId: string, file: UploadedImageFile | undefined) {
    const url = await storeImage(file, { maxBytes: AVATAR_MAX_BYTES, folder: 'avatars', label: 'avatar' });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } });
    return this.me(userId, workspaceId);
  }

  async removeAvatar(userId: string, workspaceId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
    return this.me(userId, workspaceId);
  }

  /** Change password (8+). Google-only accounts may set a first password without a current one. */
  async changePassword(userId: string, currentPassword: string | undefined, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { hasPassword: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.hasPassword) {
      if (!currentPassword) throw new BadRequestException('Enter your current password.');
      await this.security.verifyPassword(userId, currentPassword);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), hasPassword: true },
    });
    return { changed: true };
  }
}
