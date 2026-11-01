import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AppConfigService } from '../app-config/app-config.service';
import { AUDIT_ACTIONS } from '../../common/audit-actions';
import { PIN_REGEX } from '../../common/pin';

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

/**
 * Disbursement PIN + password re-auth (spec §5.10 #14, #22). GLOBAL module: inject `SecurityService`
 * anywhere (e.g. BatchesService) without importing a module.
 *
 *   await this.security.verifyPin(user.id, dto.pin);              // throws 403 with friendly copy
 *   await this.security.verifyPassword(user.id, dto.password);    // throws 403
 *   await this.security.assertDisbursementAuth(user, { pin, password }); // PIN + password if
 *                                                                // require_reauth_for_disbursement
 *
 * PIN hashes are never returned to clients. 5 wrong PINs lock PIN use for 15 minutes.
 */
@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly appConfig: AppConfigService,
  ) {}

  async pinStatus(userId: string) {
    const sec = await this.prisma.userSecurity.findUnique({ where: { userId } });
    const hasPin = !!sec?.pinHash;
    const locked = !!sec?.pinLockedUntil && sec.pinLockedUntil > new Date();
    return {
      hasPin,
      pinSetAt: sec?.pinSetAt ?? null,
      lockedUntil: locked ? sec!.pinLockedUntil : null,
      message: hasPin
        ? 'Your disbursement PIN is set.'
        : 'You have not set your PIN — you cannot pay until you do.',
    };
  }

  /** Set a first PIN, or change it (changing requires the current PIN). */
  async setPin(userId: string, workspaceId: string | null, pin: string, currentPin?: string) {
    this.assertPinFormat(pin);
    const sec = await this.prisma.userSecurity.findUnique({ where: { userId } });
    if (sec?.pinHash) {
      if (!currentPin) throw new BadRequestException('Enter your current PIN to change it.');
      await this.verifyPin(userId, currentPin);
    }
    await this.writePin(userId, pin);
    await this.audit.record(workspaceId, userId, AUDIT_ACTIONS.PIN_SET, 'disbursement PIN', {
      change: sec?.pinHash ? 'changed' : 'set',
    });
    return this.pinStatus(userId);
  }

  /** Forgotten PIN: re-verify the account password, then set a new PIN. Clears any lock. */
  async resetPin(userId: string, workspaceId: string | null, password: string, pin: string) {
    this.assertPinFormat(pin);
    await this.verifyPassword(userId, password);
    await this.writePin(userId, pin);
    await this.audit.record(workspaceId, userId, AUDIT_ACTIONS.PIN_SET, 'disbursement PIN', { change: 'reset' });
    return this.pinStatus(userId);
  }

  /** Throws ForbiddenException when the PIN is missing, wrong or locked. */
  async verifyPin(userId: string, pin: string | undefined | null): Promise<void> {
    const sec = await this.prisma.userSecurity.findUnique({ where: { userId } });
    if (!sec?.pinHash) {
      throw new ForbiddenException('You have not set your disbursement PIN — set it in Settings → Vendor Disbursements.');
    }
    if (sec.pinLockedUntil && sec.pinLockedUntil > new Date()) {
      const mins = Math.ceil((sec.pinLockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Too many wrong PIN attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your PIN.`);
    }
    if (!pin || !PIN_REGEX.test(String(pin))) {
      throw new ForbiddenException('Enter your 4–8 digit disbursement PIN.');
    }
    const ok = await bcrypt.compare(String(pin), sec.pinHash);
    if (!ok) {
      const attempts = sec.pinFailedAttempts + 1;
      const lock = attempts >= MAX_PIN_ATTEMPTS;
      await this.prisma.userSecurity.update({
        where: { userId },
        data: {
          pinFailedAttempts: lock ? 0 : attempts,
          pinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60000) : null,
        },
      });
      const left = MAX_PIN_ATTEMPTS - attempts;
      throw new ForbiddenException(
        lock
          ? `Too many wrong PIN attempts. PIN locked for ${PIN_LOCK_MINUTES} minutes.`
          : `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`,
      );
    }
    if (sec.pinFailedAttempts || sec.pinLockedUntil) {
      await this.prisma.userSecurity.update({ where: { userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    }
  }

  /** Boolean form of verifyPin (still counts failed attempts). */
  async isPinValid(userId: string, pin: string): Promise<boolean> {
    try {
      await this.verifyPin(userId, pin);
      return true;
    } catch {
      return false;
    }
  }

  /** Throws ForbiddenException when the account password is wrong (or never set). */
  async verifyPassword(userId: string, password: string | undefined | null): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, hasPassword: true } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.hasPassword) {
      throw new ForbiddenException('Your account has no password yet (you sign in with Google). Set one via "Forgot password" first.');
    }
    if (!password) throw new ForbiddenException('Enter your account password.');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new ForbiddenException('Incorrect password.');
  }

  async isPasswordValid(userId: string, password: string): Promise<boolean> {
    try {
      await this.verifyPassword(userId, password);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Everything disbursement needs (spec §15): the personal PIN, plus the account password when the
   * workspace has `require_reauth_for_disbursement` on. Role checks stay with the caller.
   */
  async assertDisbursementAuth(user: { id: string; workspaceId: string }, creds: { pin?: string | null; password?: string | null }) {
    await this.verifyPin(user.id, creds.pin);
    const reauth = await this.appConfig.get<boolean>(user.workspaceId, 'require_reauth_for_disbursement', false);
    if (reauth === true) {
      if (!creds.password) throw new ForbiddenException('This workspace requires your password as well as your PIN to disburse.');
      await this.verifyPassword(user.id, creds.password);
    }
  }

  private assertPinFormat(pin: string) {
    if (!PIN_REGEX.test(String(pin ?? ''))) throw new BadRequestException('PIN must be 4–8 digits.');
  }

  private async writePin(userId: string, pin: string) {
    const pinHash = await bcrypt.hash(String(pin), 10);
    await this.prisma.userSecurity.upsert({
      where: { userId },
      create: { userId, pinHash, pinSetAt: new Date() },
      update: { pinHash, pinSetAt: new Date(), pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }
}
