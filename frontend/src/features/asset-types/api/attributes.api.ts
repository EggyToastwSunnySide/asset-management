import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'
import type { Attribute, AttributeInput } from '../types'

// Backend calls: backend/api/routes/assetTypes.js. Errors of note:
//   409 DUPLICATE_KEY (fields.key; hidden attributes keep their key reserved),
//   409 DATA_TYPE_LOCKED (fields.dataType; assets already hold a value),
//   422 VALIDATION_FAILED (fields.*).

const base = (code: string) => `/asset-types/${encodeURIComponent(code)}/attributes`
const one = (code: string, key: string) => `${base(code)}/${encodeURIComponent(key)}`

export const attributeKeys = {
  list: (code: string) => ['asset-types', code, 'attributes'] as const,
}

/** Active and hidden attributes together; the page splits them on `isActive`. */
export function useAttributesQuery(code: string) {
  return useQuery({
    queryKey: attributeKeys.list(code),
    queryFn: () => apiClient.get<Attribute[]>(base(code), { includeInactive: true }),
  })
}

function useAttributeMutation<TVars, TData = Attribute>(
  code: string,
  mutationFn: (vars: TVars) => Promise<TData>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attributeKeys.list(code) }),
  })
}

export const useCreateAttributeMutation = (code: string) =>
  useAttributeMutation(code, (input: AttributeInput) => apiClient.post<Attribute>(base(code), input))

export const useUpdateAttributeMutation = (code: string) =>
  useAttributeMutation(code, (input: AttributeInput) =>
    apiClient.put<Attribute>(one(code, input.key), input),
  )

export const useHideAttributeMutation = (code: string) =>
  useAttributeMutation(code, (key: string) => apiClient.delete(one(code, key)))

export const useRestoreAttributeMutation = (code: string) =>
  useAttributeMutation(code, (key: string) =>
    apiClient.post<Attribute>(`${one(code, key)}/restore`),
  )
