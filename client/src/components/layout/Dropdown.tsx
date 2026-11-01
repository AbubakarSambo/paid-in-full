import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Minimal click-outside dropdown used by the header (switcher, bell, ⋮ menu). */
export function Dropdown({
  trigger,
  children,
  align = 'right',
  className,
  onOpenChange,
}: {
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => onOpenChange?.(open), [open, onOpenChange])

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={cn(
            'absolute top-full z-40 mt-2 min-w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1.5 shadow-2xl',
            align === 'right' ? 'right-0' : 'left-0',
            className
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  onClick,
  icon,
  children,
  danger,
  disabled,
}: {
  onClick?: () => void
  icon?: ReactNode
  children: ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
        danger ? 'text-red hover:bg-red/10' : 'text-foreground hover:bg-surface3'
      )}
    >
      {icon && <span className="text-text-dim">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  )
}

/** Uppercase micro-label chip (spec §12). */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]', className)}>
      {children}
    </span>
  )
}
