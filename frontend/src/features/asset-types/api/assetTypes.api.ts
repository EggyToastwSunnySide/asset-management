import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'
import { assetKeys, type ReferenceItem } from '@/features/assets'

// Backend call: POST /api/asset-types (backend/api/routes/assetTypes.js).
// A 409 DUPLICATE_CODE or 422 arrives with `fields.code` / `fields.name`.

/** Body of `POST /api/asset-types` — mirrors `asset_types.code` / `.name`. */
export interface AssetTypeInput {
  code: string
  name: string
}

const createAssetType = (input: AssetTypeInput) =>
  apiClient.post<ReferenceItem>('/asset-types', input)

export function useCreateAssetTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AssetTypeInput) => createAssetType(input),
    // Types are served as reference data, so this also refreshes the asset
    // form's type selector.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.referenceData() }),
  })
}
