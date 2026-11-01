import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Pencil, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermissions } from '@/lib/permissions'
import { useAuthStore } from '@/stores/authStore'
import { apiErrorMessage } from '@/lib/api/batches'
import { walletApi, walletKeys } from '@/lib/api/wallet'
import { CopyButton, supportWhatsappUrl } from '@/components/wallet/WalletBits'
import type { LinkAccountInput, ProvisionAccountInput } from '@/types/wallet'
import { ReadOnly, SectionCard } from '../SectionCard'

/** §5.10 #5 Wallet Account: the workspace's Monnify reserved account (NUBAN) that funds payouts. */
export default function WalletAccount() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const workspaceName = useAuthStore((s) => s.workspace?.name) ?? ''
  const q = useQuery({ queryKey: walletKeys.summary, queryFn: walletApi.summary })
  const account = q.data?.account ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [mode, setMode] = useState<'provision' | 'link'>('provision')

  const refresh = () => qc.invalidateQueries({ queryKey: walletKeys.all })
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(ok)
      refresh()
      return true
    } catch (err) {
      toast.error(await apiErrorMessage(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  const waText = account
    ? `Hello Paid in Full, I need help with our wallet account ${account.accountNumber} (${workspaceName}).`
    : `Hello Paid in Full, I need help setting up a wallet account for ${workspaceName}.`

  return (
    <SectionCard
      title="Wallet Account"
      description="The dedicated account you fund payouts from. Transfers into it top up the wallet automatically."
      actions={
        <a href={supportWhatsappUrl(waText)} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            <MessageCircle size={14} /> Message us on WhatsApp
          </Button>
        </a>
      }
    >
      {!isAdmin && <ReadOnly />}
      {q.isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : account ? (
        <div className="space-y-3">
          <div className="grid gap-3 rounded-xl border border-border bg-surface2 p-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Account number</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-xl font-bold tabular-nums tracking-wider">{account.accountNumber}</span>
                <CopyButton value={account.accountNumber} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Bank</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-semibold">{account.bankName ?? '—'}</span>
                {account.bankName && <CopyButton value={account.bankName} />}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Account name</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-semibold">{account.accountName ?? '—'}</span>
                {account.accountName && <CopyButton value={account.accountName} />}
              </div>
            </div>
          </div>
          {account.accountReference && <p className="font-mono text-[11px] text-text-muted">Reference {account.accountReference}</p>}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                isLoading={busy === 'rename'}
                disabled={account.accountName === workspaceName}
                onClick={() => act('rename', () => walletApi.rename(), 'Renamed to the workspace name')}
              >
                <Pencil size={13} /> Rename to workspace
              </Button>
              <Button variant="outline" size="sm" className="text-red hover:text-red" onClick={() => setUnlinkOpen(true)}>
                <Unlink size={13} /> Unlink
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-orange/40 bg-orange/10 px-3 py-2 text-sm text-orange">
            No wallet account yet — you can't fund payouts until one is provisioned or linked.
          </p>
          {isAdmin && (
            <>
              <div className="flex gap-2">
                {(['provision', 'link'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                      mode === m ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim'
                    }`}
                  >
                    {m === 'provision' ? 'Provision new wallet' : 'Link existing account'}
                  </button>
                ))}
              </div>
              {mode === 'provision' ? (
                <ProvisionForm
                  defaultName={workspaceName}
                  busy={busy === 'provision'}
                  onSubmit={(body) => act('provision', () => walletApi.provision(body), 'Wallet account created')}
                />
              ) : (
                <LinkForm busy={busy === 'link'} onSubmit={(body) => act('link', () => walletApi.link(body), 'Wallet account linked')} />
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        title="Unlink wallet account?"
        description="Transfers into this account will no longer top up the wallet in Paid in Full. The ledger history is kept. You can link it again later."
        confirmText="Unlink"
        isDangerous
        isLoading={busy === 'unlink'}
        onConfirm={async () => {
          if (await act('unlink', walletApi.unlink, 'Wallet account unlinked')) setUnlinkOpen(false)
        }}
      />
    </SectionCard>
  )
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label required={required}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-text-dim">{hint}</p>}
    </div>
  )
}

function ProvisionForm({ defaultName, busy, onSubmit }: { defaultName: string; busy: boolean; onSubmit: (b: ProvisionAccountInput) => Promise<boolean> }) {
  const [f, setF] = useState({ accountName: defaultName, contractCode: '', customerName: '', customerEmail: '', bvn: '', nin: '' })
  const bvnOk = !f.bvn || /^\d{11}$/.test(f.bvn)
  const ninOk = !f.nin || /^\d{11}$/.test(f.nin)
  const emailOk = !f.customerEmail || /^\S+@\S+\.\S+$/.test(f.customerEmail)
  const valid = (!!f.bvn || !!f.nin) && bvnOk && ninOk && emailOk
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          accountName: f.accountName.trim() || undefined,
          contractCode: f.contractCode.trim() || undefined,
          currency: 'NGN',
          customerName: f.customerName.trim() || undefined,
          customerEmail: f.customerEmail.trim() || undefined,
          bvn: f.bvn || undefined,
          nin: f.nin || undefined,
        })
      }}
    >
      <Field label="Account name">
        <Input value={f.accountName} onChange={set('accountName')} maxLength={100} />
      </Field>
      <Field label="Contract code" hint="Leave blank to use the platform contract.">
        <Input value={f.contractCode} onChange={set('contractCode')} />
      </Field>
      <Field label="Currency">
        <Input value="NGN" disabled />
      </Field>
      <Field label="Customer name">
        <Input value={f.customerName} onChange={set('customerName')} />
      </Field>
      <Field label="Customer email">
        <Input type="email" value={f.customerEmail} onChange={set('customerEmail')} error={emailOk ? undefined : 'Enter a valid email'} />
      </Field>
      <div />
      <Field label="BVN" hint="BVN or NIN is required.">
        <Input inputMode="numeric" maxLength={11} value={f.bvn} onChange={set('bvn')} error={bvnOk ? undefined : 'BVN must be 11 digits'} />
      </Field>
      <Field label="NIN">
        <Input inputMode="numeric" maxLength={11} value={f.nin} onChange={set('nin')} error={ninOk ? undefined : 'NIN must be 11 digits'} />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" isLoading={busy} disabled={!valid}>
          Provision wallet
        </Button>
      </div>
    </form>
  )
}

function LinkForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: LinkAccountInput) => Promise<boolean> }) {
  const [f, setF] = useState({ accountReference: '', accountNumber: '', bankName: '', accountName: '' })
  const nubanOk = !f.accountNumber || /^\d{10}$/.test(f.accountNumber)
  const valid = !!f.accountReference.trim() && nubanOk
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          accountReference: f.accountReference.trim(),
          accountNumber: f.accountNumber || undefined,
          bankName: f.bankName.trim() || undefined,
          accountName: f.accountName.trim() || undefined,
        })
      }}
    >
      <Field label="Account number">
        <Input inputMode="numeric" maxLength={10} value={f.accountNumber} onChange={set('accountNumber')} error={nubanOk ? undefined : 'Account number must be 10 digits'} />
      </Field>
      <Field label="Bank">
        <Input value={f.bankName} onChange={set('bankName')} />
      </Field>
      <Field label="Account name">
        <Input value={f.accountName} onChange={set('accountName')} />
      </Field>
      <Field label="Reserved account reference" required hint="Verified with Monnify before linking.">
        <Input value={f.accountReference} onChange={set('accountReference')} />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" isLoading={busy} disabled={!valid}>
          Link account
        </Button>
      </div>
    </form>
  )
}
