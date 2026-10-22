/**
 * One row of reference data. Type, status and location are stored as codes
 * (`LAPTOP`, `AVAILABLE`, `HQ`) — what the API accepts and filters on — each
 * with a display name. GET /api/reference-data lists the active ones.
 */
export interface ReferenceItem {
  code: string
  name: string
}

export interface ReferenceData {
  types: ReferenceItem[]
  statuses: ReferenceItem[]
  locations: ReferenceItem[]
}

/** Mirrors the fixed relational schema from ADR-0001 — every asset shares these columns. */
export interface Asset {
  id: string
  tag: string
  name: string
  /** Reference-data codes, each followed by its display name. */
  type: string
  typeName: string
  status: string
  statusName: string
  location: string
  locationName: string
  purchaseDate: string // ISO yyyy-mm-dd
  notes: string | null
}

/** One activity-history entry (US-16), from GET /api/assets/:id/events. */
export interface AssetEvent {
  id: string
  type: 'created' | 'updated' | 'archived' | 'restored' | 'loaned' | 'returned' | 'replaced'
  occurredAt: string // ISO date-time
  /** Null when no user is recorded for the event. */
  actor: { id: string; displayName: string } | null
  description: string
  details: Record<string, unknown>
}

/**
 * Create/update payload. PUT replaces the whole asset (ADR-0004), so an edit
 * sends `notes` back even though the form does not show it. `tag` cannot
 * change after creation.
 */
export interface AssetInput {
  tag: string
  name: string
  type: string
  status: string
  location: string
  purchaseDate: string
  notes: string | null
}

/**
 * GET /api/assets query (ADR-0003). Filter arrays repeat their key
 * (`type=A&type=B`, "any of"); `…Not` keys exclude. See `toApiFilters`.
 */
// `type`, not `interface`: only type aliases satisfy apiClient's QueryParams index signature.
export type AssetListParams = ApiAssetFilters & {
  page: number
  pageSize: number
  sort: AssetSort['key']
  direction: SortDirection
}

/** The list's filters in API form — shared by the list query and the export (ADR-0008). */
export type ApiAssetFilters = {
  search?: string
  type?: string[]
  typeNot?: string[]
  status?: string[]
  statusNot?: string[]
  location?: string[]
  locationNot?: string[]
}

export type SortDirection = 'asc' | 'desc'

/** Columns the table sorts by (a subset of what the API accepts). */
export const SORT_KEYS = ['tag', 'name', 'type', 'status', 'location', 'purchaseDate'] as const

export interface AssetSort {
  key: (typeof SORT_KEYS)[number]
  direction: SortDirection
}

export const FILTER_FIELDS = ['type', 'status', 'location'] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

export type FilterOperator = 'is' | 'isNot'

/** One row of the Filters popover, e.g. "Status is In Use". */
export interface FilterCondition {
  id: string
  field: FilterField
  operator: FilterOperator
  /** '' while the user has not picked a value yet — such a row is ignored. */
  value: string
}

export interface AssetFilters {
  search: string
  conditions: FilterCondition[]
}
