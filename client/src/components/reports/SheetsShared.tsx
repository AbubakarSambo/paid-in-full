import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { readOnlyCopy } from '@/lib/permissions'
import type { SheetsConfig, SheetsStatus } from '@/types/reports'
import { MicroLabel } from './primitives'
import { shortDate } from './format'

export function SettingsCard({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-text-dim">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
        tone === 'info' && 'border-border bg-surface2 text-text-dim',
        tone === 'warn' && 'border-orange/30 bg-orange/10 text-foreground',
        tone === 'error' && 'border-red/30 bg-red/10 text-foreground',
        tone === 'ok' && 'border-green/30 bg-green/10 text-foreground',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          tone === 'warn' && 'text-orange',
          tone === 'error' && 'text-red',
          tone === 'ok' && 'text-green',
        )}
      />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

export function ReadOnlyNote() {
  return (
    <div className="flex items-center gap-2 text-xs text-text-dim">
      <Lock className="h-3.5 w-3.5" />
      {readOnlyCopy('Admin')}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <MicroLabel>{label}</MicroLabel>
      {children}
      {hint ? <span className="block text-xs text-text-dim">{hint}</span> : null}
    </label>
  )
}

export function transportLabel(t: SheetsConfig['batchesTransport']) {
  return t === 'apps_script' ? 'Apps Script web app' : t === 'api' ? 'Google Sheets API' : null
}

export function EnvironmentNotes({ config }: { config: SheetsConfig }) {
  return (
    <>
      {config.mockMode ? <Notice tone="info">Sheets mock mode is on: writes are logged by the server, not sent to Google.</Notice> : null}
      {!config.credentialsConfigured ? (
        <Notice tone="info">
          No Google service account is configured on the server, so direct Sheets URLs can't be written. Use an Apps Script
          <code className="mx-1">/exec</code>URL, or ask your Paid in Full contact to add credentials.
        </Notice>
      ) : config.serviceAccountEmail ? (
        <Notice tone="info">
          Share your sheet with <strong className="break-all">{config.serviceAccountEmail}</strong> as an Editor.
        </Notice>
      ) : null}
    </>
  )
}

export function SyncStatusLine({ status }: { status: SheetsStatus }) {
  if (!status.configured) return <Notice tone="warn">Not configured{status.reason ? `: ${status.reason}` : ''}.</Notice>
  const tone = status.status === 'Synced' ? 'ok' : status.status === 'Error' ? 'error' : status.status === 'Syncing' ? 'info' : 'warn'
  return (
    <Notice tone={tone}>
      <strong>{status.status}</strong>
      {status.lastSyncedAt ? ` · last synced ${shortDate(status.lastSyncedAt)} ${new Date(status.lastSyncedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}` : ''}
      {status.unsyncedBatches > 0 ? ` · ${status.unsyncedBatches} batch${status.unsyncedBatches === 1 ? '' : 'es'} not yet in the sheet` : ''}
      {status.lastError ? <div className="mt-1 text-red">{status.lastError}</div> : null}
    </Notice>
  )
}
