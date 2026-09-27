import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bell } from 'lucide-react'
import { notificationsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Prefs {
  batchDisbursed?: boolean
  requisitionSubmitted?: boolean
  budgetExceeded?: boolean
  lowWalletBalance?: boolean
  [key: string]: unknown
}

const TOGGLES: { key: keyof Prefs; label: string }[] = [
  { key: 'batchDisbursed', label: 'Batch disbursed' },
  { key: 'requisitionSubmitted', label: 'New requisition submitted' },
  { key: 'budgetExceeded', label: 'Budget exceeded' },
  { key: 'lowWalletBalance', label: 'Low wallet balance' },
]

export default function NotificationSettings() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: notificationsApi.getPrefs })
  const [prefs, setPrefs] = useState<Prefs>({})

  useEffect(() => {
    if (data) setPrefs(data as Prefs)
  }, [data])

  const updateMutation = useMutation({
    mutationFn: () => notificationsApi.updatePrefs(prefs),
    onSuccess: () => {
      toast.success('Preferences saved')
      qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] })
    },
    onError: () => toast.error('Could not save preferences'),
  })

  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast.error('Push notifications are not supported in this browser')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const { key } = (await notificationsApi.vapidPublicKey()) as { key: string }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })
      await notificationsApi.subscribePush(subscription.toJSON())
      toast.success('Push notifications enabled')
    } catch {
      toast.error('Could not enable push notifications')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email &amp; in-app alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {TOGGLES.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between">
              <span className="text-sm text-foreground">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(prefs[key])}
                onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                className="h-5 w-5 accent-gold"
              />
            </label>
          ))}
          <Button isLoading={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
            Save preferences
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Get browser push alerts for batch disbursements and approvals.
          </p>
          <Button variant="outline" onClick={enablePush}>
            <Bell size={16} /> Enable push notifications
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
