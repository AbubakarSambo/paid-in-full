import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workspaceApi, costCentersApi, departmentsApi, locationsApi, payCategoriesApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function TaxonomyEditor({
  title,
  api,
}: {
  title: string
  api: { list: (p?: Record<string, unknown>) => Promise<unknown>; create: (p: { name: string }) => Promise<unknown>; remove: (id: string) => Promise<unknown> }
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const { data } = useQuery({ queryKey: [title], queryFn: () => api.list() })
  const items = (Array.isArray(data) ? data : (data as { data?: { id: string; name: string }[] })?.data ?? []) as {
    id: string
    name: string
  }[]

  const createMutation = useMutation({
    mutationFn: () => api.create({ name }),
    onSuccess: () => {
      setName('')
      qc.invalidateQueries({ queryKey: [title] })
    },
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [title] }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder={`New ${title.toLowerCase()}`} value={name} onChange={(e) => setName(e.target.value)} />
          <Button
            type="button"
            disabled={!name}
            isLoading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium"
            >
              {item.name}
              <button onClick={() => removeMutation.mutate(item.id)} className="text-muted-foreground hover:text-destructive">
                ×
              </button>
            </span>
          ))}
          {items.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function WorkspaceSettings() {
  const qc = useQueryClient()
  const { data: workspace } = useQuery({ queryKey: ['workspace'], queryFn: workspaceApi.get })
  const [name, setName] = useState('')

  useEffect(() => {
    if (workspace?.name) setName(workspace.name)
  }, [workspace?.name])

  const updateMutation = useMutation({
    mutationFn: () => workspaceApi.update({ name }),
    onSuccess: () => {
      toast.success('Workspace updated')
      qc.invalidateQueries({ queryKey: ['workspace'] })
    },
    onError: () => toast.error('Could not update workspace'),
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div>
            <Label>Workspace name</Label>
            <Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button isLoading={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
            Save changes
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TaxonomyEditor title="Cost centers" api={costCentersApi} />
        <TaxonomyEditor title="Departments" api={departmentsApi} />
        <TaxonomyEditor title="Locations" api={locationsApi} />
        <TaxonomyEditor title="Pay categories" api={payCategoriesApi} />
      </div>
    </div>
  )
}
