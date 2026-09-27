// `web-push` ships without bundled TypeScript types and `@types/web-push` isn't in this
// repo's dependency set. This is a minimal ambient declaration covering the surface
// NotificationsService actually uses.
declare module 'web-push' {
  export interface PushSubscriptionKeys {
    p256dh: string;
    auth: string;
  }

  export interface PushSubscription {
    endpoint: string;
    keys: PushSubscriptionKeys;
  }

  export interface WebPushError extends Error {
    statusCode: number;
    body?: string;
    headers?: Record<string, string>;
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer,
    options?: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
}
