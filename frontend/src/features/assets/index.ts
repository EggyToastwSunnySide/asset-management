/**
 * Public API of the assets feature. Import from here across feature/app
 * boundaries — never from this feature's internal `components/`, `api/`,
 * or `hooks/` files. The Redux reducer is the one exception: import it from
 * `./store` instead (see that folder's index.ts for why).
 */
export { InventoryPage } from './pages/InventoryPage'
export { useReferenceDataQuery, assetKeys } from './api/assets.api'
export type {
  Asset,
  AssetInput,
  AssetFilters,
  AssetSort,
  ReferenceData,
  ReferenceItem,
} from './types'
