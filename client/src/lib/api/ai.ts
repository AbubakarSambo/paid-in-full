import { api } from '@/lib/api'
import type { ImproveDescriptionInput, ImprovedDescription, ValidateDescriptionResult } from '@/types/spend'

export const aiApi = {
  /** Spec §7 validator on the server. */
  validateDescription: (description: string, vendorName?: string) =>
    api.post<ValidateDescriptionResult>('/ai/validate-description', { description, vendorName: vendorName || undefined }).then((r) => r.data),
  /** "Tidy up / Improve with AI" (max 50 items per call). */
  improveDescriptions: (items: ImproveDescriptionInput[]) =>
    api
      .post<{ items: ImprovedDescription[]; source: 'ai' | 'rules' }>('/ai/improve-descriptions', { items: items.slice(0, 50) })
      .then((r) => r.data),
}
