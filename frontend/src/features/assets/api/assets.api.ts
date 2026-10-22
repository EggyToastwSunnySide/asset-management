import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Page } from '@/lib/apiClient'
import type {
  Asset,
  AssetEvent,
  AssetInput,
  AssetListParams,
  ReferenceData,
  ReplacementInput,
} from '../types'

// ---------------------------------------------------------------------------
// Backend calls. Contract: backend/api/routes/assets.js, browsable at /api/docs.
// ---------------------------------------------------------------------------

/**
 * One page of the list, filtered and sorted on the server (ADR-0003: offset/
 * limit with a total count). Array filter values repeat their key, which the
 * API reads as "any of".
 */
const fetchAssetPage = (params: AssetListParams) => apiClient.get<Page<Asset>>('/assets', params)

const createAsset = (input: AssetInput) => apiClient.post<Asset>('/assets', input)

const updateAsset = (id: string, input: AssetInput) =>
  apiClient.put<Asset>(`/assets/${encodeURIComponent(id)}`, input)

/** Soft delete (ADR-0002) — reversible with `restoreAsset`. */
const deleteAsset = (id: string) => apiClient.delete(`/assets/${encodeURIComponent(id)}`)

const restoreAsset = (id: string) => apiClient.post<Asset>(`/assets/${encodeURIComponent(id)}/restore`)

/** Records that `replacementAssetId` replaces the asset `id` (US-13). */
const replaceAsset = (id: string, input: ReplacementInput) =>
  apiClient.post(`/assets/${encodeURIComponent(id)}/replacement`, input)

/** Activity history, oldest first (US-16). */
const fetchAssetEvents = (id: string) =>
  apiClient.get<{ items: AssetEvent[] }>(`/assets/${encodeURIComponent(id)}/events`)

const fetchReferenceData = () => apiClient.get<ReferenceData>('/reference-data')

// ---------------------------------------------------------------------------
// Query keys — one factory so every hook and invalidation call agrees on shape.
// ---------------------------------------------------------------------------

export const assetKeys = {
  all: ['assets'] as const,
  lists: () => [...assetKeys.all, 'list'] as const,
  list: (params: AssetListParams) => [...assetKeys.lists(), params] as const,
  events: (id: string) => [...assetKeys.all, 'events', id] as const,
  referenceData: () => ['reference-data'] as const,
}

// ---------------------------------------------------------------------------
// Public hooks — this is what feature components import.
// ---------------------------------------------------------------------------

export function useAssetsQuery(params: AssetListParams) {
  return useQuery({
    queryKey: assetKeys.list(params),
    queryFn: () => fetchAssetPage(params),
    // Keep showing the current page while the next one loads, instead of
    // flashing the loading state on every page, sort or filter change.
    placeholderData: keepPreviousData,
  })
}

export function useReplaceAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReplacementInput }) => replaceAsset(id, input),
    // The old asset's status and both assets' histories change.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.all }),
  })
}

export function useAssetEventsQuery(id: string) {
  return useQuery({
    queryKey: assetKeys.events(id),
    queryFn: () => fetchAssetEvents(id),
    select: (data) => data.items,
  })
}

/** Codes and display names for the type/status/location pickers; changes rarely. */
export function useReferenceDataQuery() {
  return useQuery({
    queryKey: assetKeys.referenceData(),
    queryFn: fetchReferenceData,
    staleTime: 5 * 60_000,
  })
}

export function useCreateAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AssetInput) => createAsset(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.lists() }),
  })
}

export function useUpdateAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AssetInput }) => updateAsset(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.lists() }),
  })
}

export function useDeleteAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteAsset(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.lists() }),
  })
}

export function useRestoreAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => restoreAsset(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.lists() }),
  })
}
