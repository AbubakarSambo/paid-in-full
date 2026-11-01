import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installGlobalErrorHandlers } from './components/ErrorBoundary'
import { registerServiceWorker } from './lib/push'

installGlobalErrorHandlers()
// PWA: the service worker handles push + notification clicks (public/sw.js).
if (import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true') registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
