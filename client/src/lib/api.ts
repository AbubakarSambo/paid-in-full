import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

const baseURL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`

export const api = axios.create({ baseURL })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    // API wraps every payload as { success: true, data: ... } — unwrap it here
    // so callers can keep treating response.data as the payload itself.
    if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
      response.data = response.data.data
    }
    return response
  },
  (error) => {
    if (error?.response?.status === 401) {
      useAuthStore.getState().logout()
      // Only bounce authenticated areas to /login; public pages (auth flows, /i/, /m/) handle 401 themselves.
      const path = typeof window !== 'undefined' ? window.location.pathname : ''
      if (/^\/(app|super-admin|onboarding)(\/|$)/.test(path)) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// ---------- Client errors ----------
export const clientErrorsApi = {
  report: (payload: Record<string, unknown>) =>
    api.post('/client-errors', payload).catch(() => undefined),
}
