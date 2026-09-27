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
  workspaceName: z.string().min(2, 'Workspace name is required'),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
})
type FormValues = z.infer<typeof schema>

export default function RegisterPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      login(data)
      toast.success('Workspace created')
      navigate('/dashboard')
    },
    onError: () => toast.error('Could not create workspace. Check your details.'),
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-gold flex items-center justify-center text-primary-foreground font-black">
            ₦
          </div>
          <span className="font-display font-bold text-lg text-foreground">Paid in Full</span>
        </div>
        <h1 className="text-xl font-bold text-foreground">Create your workspace</h1>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div>
            <Label htmlFor="workspaceName" required>
              Workspace name
            </Label>
            <Input
              id="workspaceName"
              className="mt-1.5"
              placeholder="e.g. Kulode Hospitality"
              {...register('workspaceName')}
              error={errors.workspaceName?.message}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName" required>
                First name
              </Label>
              <Input id="firstName" className="mt-1.5" {...register('firstName')} error={errors.firstName?.message} />
            </div>
            <div>
              <Label htmlFor="lastName" required>
                Last name
              </Label>
              <Input id="lastName" className="mt-1.5" {...register('lastName')} error={errors.lastName?.message} />
            </div>
          </div>
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
            Create workspace
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
