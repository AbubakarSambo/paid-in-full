import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

export function RequireAuth() {
  const { token, _hasHydrated } = useAuthStore()
  const location = useLocation()

  if (!_hasHydrated) return null
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}
