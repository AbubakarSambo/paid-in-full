import { useState } from 'react'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadBlob } from '@/lib/utils'
import { errorMessage } from './format'

/** Fetches a blob export and saves it; surfaces the API's error message on failure. */
export function DownloadButton({
  label,
  filename,
  fetcher,
  disabled,
  title,
  variant = 'outline',
}: {
  label: string
  filename: string
  fetcher: () => Promise<Blob>
  disabled?: boolean
  title?: string
  variant?: 'outline' | 'secondary' | 'ghost'
}) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      downloadBlob(await fetcher(), filename)
    } catch (err) {
      toast.error(await errorMessage(err, `Could not download ${label}`))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" size="sm" variant={variant} onClick={run} isLoading={busy} disabled={disabled} title={title}>
      {busy ? null : <Download className="h-3.5 w-3.5" />}
      {label}
    </Button>
  )
}
