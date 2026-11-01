import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link to="/" className="mb-8 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold font-display text-xl font-black text-primary-foreground">₦</div>
        <span className="font-display text-lg font-bold tracking-tight text-foreground">Paid in Full</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {subtitle && <div className="mt-1.5 text-sm text-text-dim">{subtitle}</div>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-center text-sm text-text-dim">{footer}</div>}
      <p className="mt-10 text-xs text-text-muted">One Approval. Every Vendor. Paid In Full.</p>
    </div>
  )
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return <div className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-sm text-red">{message}</div>
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null
  return <div className="rounded-xl border border-green/30 bg-green/10 px-3.5 py-2.5 text-sm text-green">{message}</div>
}
