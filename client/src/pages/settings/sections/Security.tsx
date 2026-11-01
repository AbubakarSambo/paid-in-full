import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiError, workspaceShellApi, type UpdateWorkspacePayload } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { useWorkspaceConfig } from '@/components/layout/hooks'
import { ReadOnly, Row, SectionCard } from '../SectionCard'

/** §5.10 #22 Security access: session timeout and re-authentication for disbursement. */
export default function Security() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: ws } = useWorkspaceConfig()
  const [minutes, setMinutes] = useState('30')

  useEffect(() => {
    if (ws?.settings) setMinutes(String(ws.settings.sessionTimeoutMinutes || 30))
  }, [ws?.settings])

  const save = useMutation({
    mutationFn: (p: UpdateWorkspacePayload) => workspaceShellApi.update(p),
    onSuccess: (w) => {
      qc.setQueryData(['workspace'], w)
      toast.success('Security settings saved')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  const n = Number(minutes)
  const valid = Number.isInteger(n) && n >= 5 && n <= 1440

  return (
    <SectionCard title="Security access" description="Applies to everyone in this workspace.">
      {!isAdmin && <ReadOnly />}
      <Row label="Session timeout" hint="Sign people out after this many minutes of inactivity (5–1440). They get a warning 1 minute before.">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return toast.error('Enter a whole number of minutes between 5 and 1440.')
            save.mutate({ sessionTimeoutMinutes: n })
          }}
        >
          <Input type="number" min={5} max={1440} value={minutes} disabled={!isAdmin} onChange={(e) => setMinutes(e.target.value)} className="h-9 w-24 text-right tabular-nums" />
          <span className="text-xs text-text-dim">min</span>
          {isAdmin && (
            <Button size="sm" type="submit" disabled={!valid || n === ws?.settings?.sessionTimeoutMinutes} isLoading={save.isPending}>
              Save
            </Button>
          )}
        </form>
      </Row>
      <Row label="Require re-authentication for disbursement" hint="Payers must enter their account password in addition to their PIN when disbursing.">
        <Switch
          checked={!!ws?.settings?.requireReauthForDisbursement}
          disabled={!isAdmin || save.isPending || !ws}
          onChange={(on) => save.mutate({ requireReauthForDisbursement: on })}
          label="Require re-authentication"
        />
      </Row>
    </SectionCard>
  )
}
