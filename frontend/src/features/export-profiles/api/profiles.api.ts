import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'
import type { ExportProfile, ExportProfileInput } from '../types'

// Backend calls (ADR-0013: per-user database record). Contract:
// backend/api/routes/exportProfiles.js, browsable at /api/docs.

const fetchProfiles = () => apiClient.get<ExportProfile[]>('/export-profiles')

const createProfile = (input: ExportProfileInput) =>
  apiClient.post<ExportProfile>('/export-profiles', input)

const updateProfile = (id: string, input: ExportProfileInput) =>
  apiClient.put<ExportProfile>(`/export-profiles/${encodeURIComponent(id)}`, input)

const deleteProfile = (id: string) => apiClient.delete(`/export-profiles/${encodeURIComponent(id)}`)

export const profileKeys = {
  all: ['export-profiles'] as const,
  lists: () => [...profileKeys.all, 'list'] as const,
}

export function useProfilesQuery(enabled = true) {
  return useQuery({
    queryKey: profileKeys.lists(),
    queryFn: fetchProfiles,
    enabled,
  })
}

export function useCreateProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ExportProfileInput) => createProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.lists() }),
  })
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExportProfileInput }) =>
      updateProfile(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.lists() }),
  })
}

export function useDeleteProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.lists() }),
  })
}
