import { api } from '@/lib/api'
import type { RecurringPayload, RecurringPayment, RecurringRunResult } from '@/types/queue'

export const recurringKeys = { all: ['recurring'] as const }

export const recurringApi = {
  list: () => api.get<RecurringPayment[]>('/recurring').then((r) => r.data),
  create: (body: RecurringPayload) => api.post<RecurringPayment>('/recurring', body).then((r) => r.data),
  update: (id: string, body: Partial<RecurringPayload>) => api.patch<RecurringPayment>(`/recurring/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/recurring/${id}`).then((r) => r.data),
  run: () => api.post<RecurringRunResult>('/recurring/run').then((r) => r.data),
}
