import { notificationPrefsApi } from '@/lib/api/shell'

/** Web Push helpers (spec §10, VAPID). The service worker lives at /sw.js. */

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* non-fatal: push just won't be available */
    })
  })
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  return existing ?? navigator.serviceWorker.register('/sw.js')
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Ask permission, subscribe with the server's VAPID key and register the subscription. */
export async function enablePush(vapidPublicKey?: string | null): Promise<void> {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.")
  if (isIos() && !isStandalone()) throw new Error('On iPhone, add Paid in Full to your Home Screen first (Share → Add to Home Screen), then enable push from the installed app.')
  const key = vapidPublicKey || (await notificationPrefsApi.vapidKey()).vapidPublicKey
  if (!key) throw new Error("Push isn't configured on this server yet.")
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings and try again.')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
  const json = sub.toJSON()
  await notificationPrefsApi.subscribe({
    endpoint: sub.endpoint,
    p256dhKey: json.keys?.p256dh ?? '',
    authKey: json.keys?.auth ?? '',
    platform: isIos() ? 'IOS' : /android/i.test(navigator.userAgent) ? 'ANDROID' : 'WEB',
  })
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (sub) {
    await notificationPrefsApi.unsubscribe(sub.endpoint)
    await sub.unsubscribe().catch(() => undefined)
  } else {
    await notificationPrefsApi.unsubscribe()
  }
}
