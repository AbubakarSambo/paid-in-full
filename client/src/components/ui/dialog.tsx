import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}

export function Modal({ isOpen, onClose, title, description, children, className }: ModalProps) {
  if (!isOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-card border border-border p-6 shadow-2xl z-50',
          className
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          aria-label="Close"
        >
          <X size={16} strokeWidth={2} />
        </button>
        <div className="pr-8">
          <h3 className="text-lg font-bold text-foreground leading-tight">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body
  )
}

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  isDangerous?: boolean
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
  isLoading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={isLoading ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl z-50">
        <h3 className="text-lg font-bold text-foreground leading-tight">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" disabled={isLoading} onClick={onClose}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={isDangerous ? 'destructive' : 'default'}
            disabled={isLoading}
            isLoading={isLoading}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
