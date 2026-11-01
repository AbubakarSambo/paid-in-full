import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Minimal anchored dropdown: renders `children` under the trigger while `open`; closes on outside click / Escape. */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  className,
  align = 'left',
}: {
  open: boolean
  onClose: () => void
  trigger: ReactNode
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return (
    <div ref={ref} className="relative w-full">
      {trigger}
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-1 max-h-80 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-2xl',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Uppercase micro-label chip (spec §12). */
export function MicroChip({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={cn('inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', className)}
    >
      {children}
    </span>
  )
}
