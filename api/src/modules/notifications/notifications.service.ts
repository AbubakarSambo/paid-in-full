import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { PushPlatform } from '@prisma/client';
import { NotificationPrefItemDto } from './dto/notification-pref.dto';
import { PushSubscribeDto } from './dto/push-subscribe.dto';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  [key: string]: unknown;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('push.vapidPublicKey');
    const privateKey = this.configService.get<string>('push.vapidPrivateKey');
    const subject = this.configService.get<string>('push.vapidSubject') || 'mailto:ops@paidinfull.app';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set. Push notifications are disabled.');
    }
  }

  getVapidPublicKey(): string | undefined {
    return this.configService.get<string>('push.vapidPublicKey');
  }

  // ─── Notification preferences ──────────────────────────────────────────

  async getPrefs(workspaceId: string, userId: string) {
    return this.prisma.notificationPref.findMany({ where: { workspaceId, userId } });
  }

  async updatePrefs(workspaceId: string, userId: string, prefs: NotificationPrefItemDto[]) {
    const results = [];
    for (const pref of prefs) {
      const updated = await this.prisma.notificationPref.upsert({
        where: {
          workspaceId_userId_channel_event: {
            workspaceId,
            userId,
            channel: pref.channel,
            event: pref.event,
          },
        },
        create: { workspaceId, userId, channel: pref.channel, event: pref.event, isEnabled: pref.isEnabled },
        update: { isEnabled: pref.isEnabled },
      });
      results.push(updated);
    }
    return results;
  }

  // ─── Push subscriptions ─────────────────────────────────────────────────

  async subscribePush(workspaceId: string, userId: string, dto: PushSubscribeDto) {
    return this.prisma.pushSubscription.upsert({
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
  }

  async unsubscribePush(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { removed: true };
  }

  async sendPush(userId: string, payload: PushPayload): Promise<void> {
    if (!this.vapidConfigured) {
      this.logger.warn(`[MOCK PUSH] to user ${userId}: ${JSON.stringify(payload)}`);
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
            JSON.stringify(payload),
          );
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
  }
}
