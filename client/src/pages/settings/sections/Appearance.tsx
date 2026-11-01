import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { apiError, meApi } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import { applySkin, useShellUi } from '@/components/layout/shellStore'
import { Row, SectionCard } from '../SectionCard'

/** §5.10 #2 Appearance: "Classic look (gold accent)" per user (saved on the profile); light/dark per device. */
export default function Appearance() {
  const skin = useAuthStore((s) => s.user?.accentSkin)
  const updateUser = useAuthStore((s) => s.updateUser)
  const { theme, setTheme } = useShellUi()
  const classic = skin === 'classic'

  const save = useMutation({
    mutationFn: (accentSkin: 'default' | 'classic') => meApi.update({ accentSkin }),
    onMutate: (accentSkin) => {
      const prev = skin
      updateUser({ accentSkin })
      applySkin(accentSkin)
      return { prev }
    },
    onError: (e, _v, ctx) => {
      updateUser({ accentSkin: (ctx?.prev as string | null) ?? 'default' })
      applySkin(ctx?.prev as string | undefined)
      toast.error(apiError(e).message)
    },
  })

  return (
    <SectionCard title="Appearance" description="Only affects how the app looks for you.">
      <Row label="Classic look (gold accent)" hint="The original Paid in Full gold instead of the default turquoise.">
        <Switch checked={classic} onChange={(on) => save.mutate(on ? 'classic' : 'default')} disabled={save.isPending} label="Classic look" />
      </Row>
      <Row label="Dark mode" hint="Saved on this device.">
        <Switch checked={theme === 'dark'} onChange={(on) => setTheme(on ? 'dark' : 'light')} label="Dark mode" />
      </Row>
    </SectionCard>
  )
}
