import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { apiError, invCustomersApi } from '@/lib/api/invoicing'
import type { InvCustomer } from '@/types/invoicing'
import { CancelButton, Dialog, Field, optStr } from './shared'

const EMPTY = { name: '', email: '', phone: '', address: '', taxId: '', notes: '' }

export function CustomerFormDialog({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer?: InvCustomer | null
  onSaved?: (c: InvCustomer) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (!open) return
    setForm(
      customer
        ? {
            name: customer.name,
            email: customer.email ?? '',
            phone: customer.phone ?? '',
            address: customer.address ?? '',
            taxId: customer.taxId ?? '',
            notes: customer.notes ?? '',
          }
        : EMPTY,
    )
  }, [open, customer])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        email: optStr(form.email),
        phone: optStr(form.phone),
        address: optStr(form.address),
        taxId: optStr(form.taxId),
        notes: optStr(form.notes),
      }
      return customer ? invCustomersApi.update(customer.id, body) : invCustomersApi.create(body)
    },
    onSuccess: (c) => {
      toast.success(customer ? 'Customer updated' : 'Customer added')
      qc.invalidateQueries({ queryKey: ['inv-customers'] })
      onSaved?.(c)
      onClose()
    },
    onError: (e) => toast.error(apiError(e, 'Could not save customer')),
  })

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const emailBad = form.email.trim() !== '' && !/^\S+@\S+\.\S+$/.test(form.email.trim())

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'New customer'}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" isLoading={save.isPending} disabled={!form.name.trim() || emailBad} onClick={() => save.mutate()}>
            {customer ? 'Save' : 'Add customer'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="Acme Ltd" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set('email')} error={emailBad ? 'Enter a valid email' : undefined} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set('phone')} placeholder="0803…" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea rows={2} value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Tax ID (TIN)">
          <Input value={form.taxId} onChange={set('taxId')} />
        </Field>
        <Field label="Notes">
          <Input value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Dialog>
  )
}
