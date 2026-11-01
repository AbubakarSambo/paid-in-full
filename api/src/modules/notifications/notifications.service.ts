import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushPlatform, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationPrefItemDto } from './dto/notification-pref.dto';
import { PushSubscribeDto } from './dto/push-subscribe.dto';
import {
  DEFAULT_CHANNEL_ENABLED,
  EVENT_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NotificationChannel,
  NotificationEvent,
  NotifyEvent,
  prefEvent,
} from './notification-events';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  [key: string]: unknown;
}

export interface NotifyPayload {
  title: string;
  body: string;
  /** In-app path (e.g. "/app?tab=batches") or absolute URL; used by push click + email CTA. */
  url?: string;
  /** The user who caused the event; they are not notified. */
  actorUserId?: string | null;
  /** Override the default role-based audience. */
  recipientUserIds?: string[];
  /** Extra fields added to the push payload. */
  data?: Record<string, unknown>;
}

export interface NotifyResult {
  recipients: number;
  push: number;
  email: number;
}

/** Default audience per event (roles that act on it). */
const EVENT_AUDIENCE: Record<NotificationEvent, WorkspaceRole[]> = {
  queue_added: [WorkspaceRole.APPROVER, WorkspaceRole.PAYER, WorkspaceRole.ADMIN],
  batch_pending_approval: [WorkspaceRole.APPROVER, WorkspaceRole.PAYER, WorkspaceRole.ADMIN],
  disbursement_result: [WorkspaceRole.PAYER, WorkspaceRole.ADMIN],
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private email: EmailService,
  ) {
    const publicKey = this.configService.get<string>('push.vapidPublicKey');
    const privateKey = this.configService.get<string>('push.vapidPrivateKey');
    const subject = this.configService.get<string>('push.vapidSubject') || 'mailto:ops@paidinfull.app';

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.vapidConfigured = true;
      } catch (error) {
        this.logger.error('Invalid VAPID keys; push notifications disabled', error as Error);
      }
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set. Push notifications are logged, not sent.');
    }
  }

  getVapidPublicKey(): string | undefined {
    return this.configService.get<string>('push.vapidPublicKey');
  }

  // ─── Fan-out (for other modules) ────────────────────────────────────────

  /**
   * Notify a workspace about an event, honouring each recipient's per-event × channel prefs
   * (PUSH → web push, EMAIL → "NOTIFICATION" email; IN_APP is the audit-log activity feed).
   * Never throws; safe to call fire-and-forget after the business transaction commits.
   *
   *   void this.notifications.notify(workspaceId, 'batch_approved', {
   *     title: 'Batch ready to pay', body: `${batch.batchRef} · 3 items · ₦120,000`,
   *     url: '/app?tab=batches', actorUserId: user.id,
   *   });
   */
  async notify(workspaceId: string, event: NotifyEvent, payload: NotifyPayload): Promise<NotifyResult> {
    const result: NotifyResult = { recipients: 0, push: 0, email: 0 };
    try {
      const pref = prefEvent(event);
      if (!NOTIFICATION_EVENTS.includes(pref)) throw new Error(`Unknown notification event ${event}`);

      const members = await this.prisma.workspaceMember.findMany({
        where: {
          workspaceId,
          isActive: true,
          joinedAt: { not: null },
          user: { isActive: true },
          ...(payload.recipientUserIds ? { userId: { in: payload.recipientUserIds } } : { role: { in: EVENT_AUDIENCE[pref] } }),
          ...(payload.actorUserId ? { NOT: { userId: payload.actorUserId } } : {}),
        },
        include: { user: { select: { id: true, email: true, firstName: true, displayName: true } }, workspace: { select: { name: true } } },
      });
      if (!members.length) return result;
      result.recipients = members.length;

      const userIds = members.map((m) => m.userId);
      const prefs = await this.prisma.notificationPref.findMany({ where: { workspaceId, userId: { in: userIds }, event: pref } });
      const enabled = (userId: string, channel: NotificationChannel) =>
        prefs.find((p) => p.userId === userId && p.channel === channel)?.isEnabled ?? DEFAULT_CHANNEL_ENABLED[channel];

      await Promise.all(
        members.map(async (m) => {
          if (enabled(m.userId, 'PUSH')) {
            result.push += await this.sendPush(m.userId, { title: payload.title, body: payload.body, url: payload.url, event, ...payload.data }, workspaceId);
          }
          if (enabled(m.userId, 'EMAIL')) {
            try {
              await this.email.send(m.user.email, 'NOTIFICATION', {
                title: payload.title,
                body: payload.body,
                url: payload.url,
                recipientName: m.user.displayName || m.user.firstName || undefined,
                workspaceName: m.workspace.name,
              });
              result.email += 1;
            } catch (error) {
              this.logger.error(`Notification email to ${m.user.email} failed`, error as Error);
            }
          }
        }),
      );
    } catch (error) {
      this.logger.error(`notify(${event}) failed for workspace ${workspaceId}`, error as Error);
    }
    return result;
  }

  // ─── Notification preferences ──────────────────────────────────────────

  /** Full event × channel matrix with defaults filled in, plus push status. */
  async getPrefs(workspaceId: string, userId: string) {
    const [rows, pushCount] = await Promise.all([
      this.prisma.notificationPref.findMany({ where: { workspaceId, userId } }),
      this.prisma.pushSubscription.count({ where: { workspaceId, userId } }),
    ]);
    const matrix = {} as Record<NotificationEvent, Record<NotificationChannel, boolean>>;
    for (const event of NOTIFICATION_EVENTS) {
      matrix[event] = {} as Record<NotificationChannel, boolean>;
      for (const channel of NOTIFICATION_CHANNELS) {
        matrix[event][channel] = rows.find((r) => r.event === event && r.channel === channel)?.isEnabled ?? DEFAULT_CHANNEL_ENABLED[channel];
      }
    }
    return {
      events: NOTIFICATION_EVENTS.map((key) => ({ key, label: EVENT_LABELS[key] })),
      channels: NOTIFICATION_CHANNELS,
      matrix,
      push: { subscribed: pushCount > 0, subscriptions: pushCount, configured: this.vapidConfigured, vapidPublicKey: this.getVapidPublicKey() || null },
    };
  }

  async updatePrefs(workspaceId: string, userId: string, prefs: NotificationPrefItemDto[]) {
    for (const pref of prefs) {
      await this.prisma.notificationPref.upsert({
        where: { workspaceId_userId_channel_event: { workspaceId, userId, channel: pref.channel, event: pref.event } },
        create: { workspaceId, userId, channel: pref.channel, event: pref.event, isEnabled: pref.isEnabled },
        update: { isEnabled: pref.isEnabled },
      });
    }
    return this.getPrefs(workspaceId, userId);
  }

  /** Events the user switched OFF for the in-app channel (used to filter the activity feed). */
  async disabledInAppEvents(workspaceId: string, userId: string): Promise<Set<NotificationEvent>> {
    const rows = await this.prisma.notificationPref.findMany({ where: { workspaceId, userId, channel: 'IN_APP', isEnabled: false } });
    return new Set(rows.map((r) => r.event as NotificationEvent));
  }

  // ─── Push subscriptions ─────────────────────────────────────────────────

  async subscribePush(workspaceId: string, userId: string, dto: PushSubscribeDto) {
    const sub = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        workspaceId,
        userId,
        endpoint: dto.endpoint,
        p256dhKey: dto.p256dhKey,
        authKey: dto.authKey,
        platform: dto.platform || PushPlatform.WEB,
      },
      update: {
        userId,
        workspaceId,
        p256dhKey: dto.p256dhKey,
        authKey: dto.authKey,
        platform: dto.platform || PushPlatform.WEB,
      },
    });
    return { subscribed: true, id: sub.id };
  }

  async unsubscribePush(userId: string, endpoint?: string, workspaceId?: string) {
    const res = await this.prisma.pushSubscription.deleteMany({
      where: { userId, ...(endpoint ? { endpoint } : { workspaceId }) },
    });
    return { removed: res.count };
  }

  /** "Send test alert" (spec §5.10 #21). */
  async sendTest(workspaceId: string, userId: string) {
    const subs = await this.prisma.pushSubscription.count({ where: { workspaceId, userId } });
    if (!subs) throw new BadRequestException('Enable phone push on this device first (on iPhone, Add to Home Screen first).');
    const sent = await this.sendPush(
      userId,
      { title: 'Paid in Full test alert', body: 'Push notifications are working on this device.', url: '/app', event: 'test' },
      workspaceId,
    );
    return { sent, subscriptions: subs, mock: !this.vapidConfigured };
  }

  /** Sends to the user's subscriptions (optionally only this workspace's). Returns how many were delivered. */
  async sendPush(userId: string, payload: PushPayload, workspaceId?: string): Promise<number> {
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!subscriptions.length) return 0;

    if (!this.vapidConfigured) {
      this.logger.warn(`[MOCK PUSH] to user ${userId} (${subscriptions.length} device(s)): ${JSON.stringify(payload)}`);
      return subscriptions.length;
    }

    let delivered = 0;
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
            JSON.stringify(payload),
          );
          delivered += 1;
        } catch (error: any) {
          if (error?.statusCode === 410 || error?.statusCode === 404) {
            // Subscription is gone (browser unsubscribed / uninstalled) - stop targeting it.
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.error(`Failed to send push to subscription ${sub.id}`, error);
          }
        }
      }),
    );
    return delivered;
  }
}
