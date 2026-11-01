import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clientErrorsApi } from '@/lib/api'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void clientErrorsApi.report({
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    })
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined })
    window.location.href = '/app'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred. It has been reported automatically. Try reloading the page.
          </p>
          <button
            onClick={this.handleReload}
            className="rounded-xl bg-gold px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Back to the app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    void clientErrorsApi.report({
      message: event.message,
      stack: event.error?.stack,
      url: window.location.href,
      type: 'window.onerror',
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    void clientErrorsApi.report({
      message: String(event.reason?.message ?? event.reason),
      stack: event.reason?.stack,
      url: window.location.href,
      type: 'unhandledrejection',
    })
  })
}
