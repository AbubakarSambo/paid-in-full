import { create } from 'zustand'

/** Theme (per device) + per-user skin, and shell-level UI toggles (tour, what's new, top-up). */

export type ThemeMode = 'dark' | 'light'
const THEME_KEY = 'pif-theme'
const SKIN_KEY = 'pif-skin'

function readTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** "classic" = gold accent; anything else = turquoise default skin (spec §2/§12). */
export function applySkin(skin: string | null | undefined) {
  const classic = skin === 'classic'
  document.documentElement.classList.toggle('skin-turquoise', !classic)
  try {
    localStorage.setItem(SKIN_KEY, classic ? 'classic' : 'default')
  } catch {
    /* ignore */
  }
}

interface ShellUiState {
  theme: ThemeMode
  setTheme: (m: ThemeMode) => void
  toggleTheme: () => void
  tourOpen: boolean
  setTourOpen: (v: boolean) => void
  whatsNewOpen: boolean
  setWhatsNewOpen: (v: boolean) => void
  topUpOpen: boolean
  setTopUpOpen: (v: boolean) => void
}

export const useShellUi = create<ShellUiState>((set, get) => ({
  theme: readTheme(),
  setTheme: (m) => {
    applyTheme(m)
    set({ theme: m })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  tourOpen: false,
  setTourOpen: (v) => set({ tourOpen: v }),
  whatsNewOpen: false,
  setWhatsNewOpen: (v) => set({ whatsNewOpen: v }),
  topUpOpen: false,
  setTopUpOpen: (v) => set({ topUpOpen: v }),
}))

/** Per-user localStorage flags (tour, what's new, last-seen activity). */
export const userFlag = {
  get(userId: string | undefined, key: string): string | null {
    if (!userId) return null
    try {
      return localStorage.getItem(`pif:${key}:${userId}`)
    } catch {
      return null
    }
  },
  set(userId: string | undefined, key: string, value: string) {
    if (!userId) return
    try {
      localStorage.setItem(`pif:${key}:${userId}`, value)
    } catch {
      /* ignore */
    }
  },
}

/** "just now / 5m ago / 3h ago / 2d ago" (spec §10). */
export function timeAgo(date: string | Date, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Whole-naira money for the UI (spec §12). */
export function naira(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0
  return `₦${Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-NG')}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const COMMON_TZ = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'UTC']

/** Common African timezones first, then everything the browser knows. */
export function timezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return Array.from(new Set([...COMMON_TZ, ...supported]))
}

export const CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'ZAR', 'KES']
export const INDUSTRIES = ['Hospitality', 'Clinic/Pharmacy', 'Professional Services', 'Logistics/Transport', 'Retail', 'Manufacturing', 'Education', 'Real Estate', 'Technology', 'Other']
