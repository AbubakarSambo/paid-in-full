import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BellRing, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { apiError, notificationPrefsApi } from '@/lib/api/shell'
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '@/lib/push'
import type { NotificationChannel, NotificationPrefs } from '@/types/shell'
import { SectionCard } from '../SectionCard'

const CHANNEL_LABEL: Record<NotificationChannel, string> = { IN_APP: 'In-app', EMAIL: 'Email', PUSH: 'Phone push' }

/** §5.10 #21 Notifications: events × channels, phone push enable/disable, test alert. */
export default function Notifications() {
  const qc = useQueryClient()
  const { data: prefs, isLoading } = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: notificationPrefsApi.get })
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    currentSubscription()
      .then((s) => setDeviceSubscribed(!!s))
      .catch(() => setDeviceSubscribed(false))
  }, [])

  const update = useMutation({
    mutationFn: (p: { event: string; channel: NotificationChannel; isEnabled: boolean }) => notificationPrefsApi.update([p]),
    onMutate: (p) => {
      const prev = qc.getQueryData<NotificationPrefs>(['notifications', 'prefs'])
      if (prev) qc.setQueryData(['notifications', 'prefs'], { ...prev, matrix: { ...prev.matrix, [p.event]: { ...prev.matrix[p.event], [p.channel]: p.isEnabled } } })
      return { prev }
    },
    onSuccess: (data) => qc.setQueryData(['notifications', 'prefs'], data),
    onError: (e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications', 'prefs'], ctx.prev)
      toast.error(apiError(e).message)
    },
  })
  const test = useMutation({
    mutationFn: notificationPrefsApi.test,
    onSuccess: (r) =>
      r.subscriptions
        ? toast.success(r.mock ? `Test alert queued (push is in mock mode on this server; ${r.subscriptions} device(s)).` : `Test alert sent to ${r.sent} device(s).`)
        : toast.info('No devices are subscribed yet. Enable phone push first.'),
    onError: (e) => toast.error(apiError(e).message),
  })

  const togglePush = async (on: boolean) => {
    setPushBusy(true)
    try {
      if (on) {
        await enablePush(prefs?.push.vapidPublicKey)
        toast.success('Push notifications enabled on this device')
      } else {
        await disablePush()
        toast.success('Push notifications disabled on this device')
      }
      setDeviceSubscribed(on)
      qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] })
    } catch (e) {
      toast.error(e instanceof Error && !('response' in e) ? e.message : apiError(e).message)
    } finally {
      setPushBusy(false)
    }
  }

  return (
    <SectionCard title="Notifications" description="Choose what you hear about, and where. These are your personal settings.">
      {isLoading || !prefs ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[460px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2.5">Event</th>
                  {prefs.channels.map((c) => (
                    <th key={c} className="px-4 py-2.5 text-center">
                      {CHANNEL_LABEL[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prefs.events.map((ev) => (
                  <tr key={ev.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground">{ev.label}</td>
                    {prefs.channels.map((c) => (
                      <td key={c} className="px-4 py-3 text-center">
                        <Switch
                          checked={!!prefs.matrix[ev.key]?.[c]}
                          onChange={(on) => update.mutate({ event: ev.key, channel: c, isEnabled: on })}
                          label={`${ev.label} via ${CHANNEL_LABEL[c]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <BellRing size={18} className="mt-0.5 text-gold" />
              <div>
                <p className="text-sm font-semibold text-foreground">Phone push on this device</p>
                <p className="text-xs text-text-dim">
                  {!pushSupported()
                    ? "This browser doesn't support push notifications."
                    : !prefs.push.configured
                      ? "Push isn't configured on this server yet."
                      : prefs.push.subscribed
                        ? `${prefs.push.subscriptions} device${prefs.push.subscriptions === 1 ? '' : 's'} subscribed.`
                        : 'Not enabled on any device yet.'}
                  {isIos() && !isStandalone() && ' On iPhone, add Paid in Full to your Home Screen first (Share → Add to Home Screen).'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={deviceSubscribed ? 'outline' : 'default'}
                isLoading={pushBusy}
                disabled={!pushSupported() || (!prefs.push.configured && !deviceSubscribed)}
                onClick={() => togglePush(!deviceSubscribed)}
              >
                {deviceSubscribed ? 'Disable' : 'Enable'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => test.mutate()} isLoading={test.isPending}>
                <Send size={14} /> Send test alert
              </Button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
