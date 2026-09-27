import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      login(data)
      toast.success('Welcome back')
      navigate('/dashboard')
    },
    onError: () => toast.error('Invalid email or password'),
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-gold flex items-center justify-center text-primary-foreground font-black">
            ₦
          </div>
          <span className="font-display font-bold text-lg text-foreground">Paid in Full</span>
        </div>
        <h1 className="text-xl font-bold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Batch vendor disbursements, done right.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div>
            <Label htmlFor="email" required>
              Email
            </Label>
            <Input id="email" type="email" className="mt-1.5" {...register('email')} error={errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="password" required>
              Password
            </Label>
            <Input
              id="password"
              type="password"
              className="mt-1.5"
              {...register('password')}
              error={errors.password?.message}
            />
          </div>
          <Button type="submit" className="w-full" isLoading={mutation.isPending}>
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have a workspace?{' '}
          <Link to="/register" className="font-semibold text-gold hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
