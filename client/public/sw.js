/* Paid in Full service worker: Web Push + notification clicks (spec §10, §12).
 * Deliberately no fetch caching, so deploys are never served stale. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Paid in Full'
  const options = {
    body: data.body || data.message || '',
    icon: data.icon || '/icon-192.svg',
    badge: data.badge || '/icon-192.svg',
    tag: data.tag || data.event || undefined,
    renotify: !!data.tag,
    data: { url: data.url || (data.data && data.data.url) || '/app/queue', ...(data.data || {}) },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/app/queue', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) {
          if ('navigate' in w) w.navigate(target).catch(() => {})
          return w.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})

self.addEventListener('pushsubscriptionchange', () => {
  // The app re-subscribes from Settings → Notifications; nothing to do without an auth token here.
})
