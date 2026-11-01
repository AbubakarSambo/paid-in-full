import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/components/shared/SettingsSection'
import { Field, ReadOnlyNote, Toggle } from '@/components/invoices/shared'
import { apiError, invoiceSettingsApi } from '@/lib/api/invoicing'
import { usePermissions } from '@/lib/permissions'

const MAX_IMAGE_BYTES = 1_000_000
const PREFIX_RE = /^[A-Za-z0-9]{1,10}$/
const HEX_RE = /^#?[0-9a-fA-F]{6}$/

/** Settings §24: invoice branding & numbering, plus VAT on new invoices. */
export default function InvoiceBranding() {
  const qc = useQueryClient()
  const { canInvoice } = usePermissions()
  const { data: s, isLoading } = useQuery({ queryKey: ['invoice-settings'], queryFn: invoiceSettingsApi.get, enabled: canInvoice })
  const [f, setF] = useState({
    logoUrl: '' as string,
    signatureUrl: '' as string,
    themeColor: 'F4B942',
    footerText: '',
    invoicePrefix: 'INV',
    quotePrefix: 'QTE',
    vatOnNewInvoices: true,
    defaultTerms: '',
  })

  useEffect(() => {
    if (!s) return
    setF({
      logoUrl: s.branding.logoUrl ?? '',
      signatureUrl: s.branding.signatureUrl ?? '',
      themeColor: s.branding.themeColor || 'F4B942',
      footerText: s.branding.footerText ?? '',
      invoicePrefix: s.invoicePrefix,
      quotePrefix: s.quotePrefix,
      vatOnNewInvoices: s.vatOnNewInvoices,
      defaultTerms: s.defaultTerms,
    })
  }, [s])

  const save = useMutation({
    mutationFn: () =>
      invoiceSettingsApi.update({
        logoUrl: f.logoUrl || null,
        signatureUrl: f.signatureUrl || null,
        themeColor: f.themeColor.replace(/^#/, '').toUpperCase(),
        footerText: f.footerText.trim() || null,
        invoicePrefix: f.invoicePrefix.toUpperCase(),
        quotePrefix: f.quotePrefix.toUpperCase(),
        vatOnNewInvoices: f.vatOnNewInvoices,
        defaultTerms: f.defaultTerms.trim() || undefined,
      }),
    onSuccess: (next) => {
      toast.success('Invoice branding saved')
      qc.setQueryData(['invoice-settings'], next)
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const errors = {
    themeColor: !HEX_RE.test(f.themeColor) ? '6-digit hex, e.g. F4B942' : undefined,
    invoicePrefix: !PREFIX_RE.test(f.invoicePrefix) ? '1–10 letters/digits' : undefined,
    quotePrefix: !PREFIX_RE.test(f.quotePrefix)
      ? '1–10 letters/digits'
      : f.quotePrefix.toUpperCase() === f.invoicePrefix.toUpperCase()
        ? 'Must differ from the invoice prefix'
        : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)
  const color = `#${f.themeColor.replace(/^#/, '')}`

  return (
    <SettingsSection id="invoice-branding" title="Invoice branding & numbering" description="How your invoices and quotes look, and how they're numbered.">
      {!canInvoice ? (
        <ReadOnlyNote>Read-only — Biller or Admin role required.</ReadOnlyNote>
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <ImagePick label="Logo" value={f.logoUrl} onChange={(v) => setF({ ...f, logoUrl: v })} />
            <ImagePick label="Signature image" value={f.signatureUrl} onChange={(v) => setF({ ...f, signatureUrl: v })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Theme colour">
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label="Pick theme colour"
                  value={HEX_RE.test(f.themeColor) ? color : '#F4B942'}
                  onChange={(e) => setF({ ...f, themeColor: e.target.value.slice(1).toUpperCase() })}
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1"
                />
                <Input value={f.themeColor} onChange={(e) => setF({ ...f, themeColor: e.target.value.replace(/^#/, '') })} maxLength={7} error={errors.themeColor} />
              </div>
            </Field>
            <Field label="Invoice prefix" hint={`Next numbers look like ${f.invoicePrefix.toUpperCase() || 'INV'}-…`}>
              <Input value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value })} error={errors.invoicePrefix} />
            </Field>
            <Field label="Quote prefix">
              <Input value={f.quotePrefix} onChange={(e) => setF({ ...f, quotePrefix: e.target.value })} error={errors.quotePrefix} />
            </Field>
          </div>
          <Field label="Footer text">
            <Input value={f.footerText} onChange={(e) => setF({ ...f, footerText: e.target.value })} placeholder="Thank you for your business" />
          </Field>
          <Field label="Default terms">
            <Textarea rows={2} value={f.defaultTerms} onChange={(e) => setF({ ...f, defaultTerms: e.target.value })} />
          </Field>
          <Toggle
            checked={f.vatOnNewInvoices}
            onChange={(v) => setF({ ...f, vatOnNewInvoices: v })}
            label={`VAT on new invoices (${s?.defaultVatRate ?? 7.5}% default on new lines)`}
          />
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs text-text-dim">
              <span className="h-4 w-10 rounded" style={{ background: color }} /> Preview accent
            </div>
            <Button size="sm" disabled={!valid} isLoading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function ImagePick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const onFile = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Choose an image file')
    if (file.size > MAX_IMAGE_BYTES) return toast.error('Image must be 1 MB or smaller')
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result))
    reader.readAsDataURL(file)
  }
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-white">
          {value ? <img src={value} alt={label} className="max-h-full max-w-full object-contain" /> : <ImagePlus size={18} className="text-neutral-400" />}
        </div>
        <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:text-gold">
          {value ? 'Replace' : 'Upload'}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
        </label>
        {value && (
          <button type="button" className="rounded-lg p-1.5 text-text-dim hover:text-red" onClick={() => onChange('')} aria-label={`Remove ${label}`}>
            <X size={14} />
          </button>
        )}
      </div>
    </Field>
  )
}
