import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { apiError, workspaceShellApi } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { useWorkspaceConfig } from '@/components/layout/hooks'
import { ReadOnly, Row, SectionCard } from '../SectionCard'

/** §5.10 #3 Modules: Requisitions on/off (admins only). */
export default function Modules() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: ws } = useWorkspaceConfig()
  const enabled = ws?.settings?.requisitionsEnabled !== false

  const toggle = useMutation({
    mutationFn: (on: boolean) => workspaceShellApi.update({ requisitionsEnabled: on }),
    onSuccess: (w, on) => {
      qc.setQueryData(['workspace'], w)
      toast.success(on ? 'Requisitions turned on' : 'Requisitions turned off')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <SectionCard title="Modules" description="Turn optional parts of Paid in Full on or off for everyone in this workspace.">
      {!isAdmin && <ReadOnly />}
      <Row label="Requisitions" hint="Staff raise requests, procurement clears them, and accounts push them into the queue.">
        <Switch checked={enabled} disabled={!isAdmin || toggle.isPending || !ws} onChange={(on) => toggle.mutate(on)} label="Requisitions module" />
      </Row>
    </SectionCard>
  )
}
