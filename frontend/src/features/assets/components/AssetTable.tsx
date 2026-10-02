import {
  Computer,
  Laptop,
  Monitor,
  Package,
  Printer,
  Router,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'
import { Checkbox, EmptyState, Menu, Pagination, Select, Table } from '@/components/ui'
import { formatDateDisplay } from '@/utils/formatDate'
import { useAppDispatch, useAppSelector } from '@/app/store'
import { clearFilters, setPage, setPageSize, setSort } from '../store/assetsUiSlice'
import { PAGE_SIZE_OPTIONS, savePageSize } from '../store/pageSizePreference'
import type { Asset, AssetSort } from '../types'
import { StatusBadge } from './StatusBadge'
import styles from './AssetTable.module.css'

/** Icon per asset type code (seeded in backend/db/init/002_seed.sql). Types
 *  are reference data, so a code added later falls back to the generic box. */
const ASSET_ICONS: Record<string, LucideIcon> = {
  LAPTOP: Laptop,
  DESKTOP: Computer,
  MONITOR: Monitor,
  PRINTER: Printer,
  NETWORK_DEVICE: Router,
  MOBILE_DEVICE: Smartphone,
}

const COLUMNS: { key: AssetSort['key']; label: string }[] = [
  { key: 'tag', label: 'Asset' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'location', label: 'Location' },
  { key: 'purchaseDate', label: 'Purchased' },
]

export interface AssetTableProps {
  pageItems: Asset[]
  total: number
  /** 1-based index of `pageItems[0]` in the full result. */
  firstRow: number
  page: number
  pageSize: number
  pageCount: number
  isLoading: boolean
  /** Another page is loading; the current rows stay visible, marked busy. */
  isFetching: boolean
  isError: boolean
  onEdit: (asset: Asset) => void
  onDelete: (asset: Asset) => void
  canEdit: boolean
  canArchive: boolean
}

export function AssetTable({
  pageItems,
  total,
  firstRow,
  page,
  pageSize,
  pageCount,
  isLoading,
  isFetching,
  isError,
  onEdit,
  onDelete,
  canEdit,
  canArchive,
}: AssetTableProps) {
  const dispatch = useAppDispatch()
  const sort = useAppSelector((state) => state.assetsUi.sort)

  return (
    <>
      <Table.Container>
        <Table.Root aria-busy={isFetching} className={isFetching ? styles.fetching : undefined}>
          {/* Fixed layout plus these widths is what stops the columns drifting
              apart on a wide window: every other column is pinned, so Asset —
              the only unsized column — absorbs all the slack. */}
          <colgroup>
            <col style={{ width: 52 }} />
            <col />
            <col style={{ width: '10%' }} />
            <col style={{ width: 140 }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 56 }} />
          </colgroup>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell style={{ textAlign: 'right' }}>
                <Checkbox aria-label="Select all assets" disabled={pageItems.length === 0} />
              </Table.HeaderCell>
              {COLUMNS.map((col) => (
                <Table.HeaderCell
                  key={col.key}
                  className={col.key === 'purchaseDate' ? styles.numeric : undefined}
                  sortable
                  sortActive={sort.key === col.key}
                  sortDirection={sort.direction}
                  onClick={() => dispatch(setSort(col.key))}
                >
                  {col.label}
                </Table.HeaderCell>
              ))}
              <Table.HeaderCell aria-label="Actions" />
            </Table.Row>
          </Table.Head>
          <tbody>
            {isLoading ? (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <EmptyState title="Loading assets…" />
                </Table.Cell>
              </Table.Row>
            ) : isError ? (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <EmptyState
                    title="Couldn't load the inventory"
                    description="Something went wrong fetching assets. Try again shortly."
                  />
                </Table.Cell>
              </Table.Row>
            ) : total === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <EmptyState
                    title="No assets match your filters"
                    description="Try removing a filter or clearing the search."
                    action={
                      <button
                        type="button"
                        className={styles.clearFiltersBtn}
                        onClick={() => dispatch(clearFilters())}
                      >
                        Clear filters
                      </button>
                    }
                  />
                </Table.Cell>
              </Table.Row>
            ) : (
              pageItems.map((asset) => {
                const Icon = ASSET_ICONS[asset.type] ?? Package
                return (
                  <Table.Row key={asset.id}>
                    <Table.Cell style={{ textAlign: 'right' }}>
                      <Checkbox aria-label={`Select ${asset.tag}`} />
                    </Table.Cell>
                    <Table.Cell>
                      <div className={styles.assetCell}>
                        {/* Decorative: the type it depicts is already the next
                            column, read out as text. */}
                        <span className={styles.assetIcon}>
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <div className={styles.assetText}>
                          <div className={styles.assetName}>{asset.name}</div>
                          <div className={styles.assetTag}>{asset.tag}</div>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell className={styles.typeText}>{asset.typeName}</Table.Cell>
                    <Table.Cell>
                      <StatusBadge status={asset.status} label={asset.statusName} />
                    </Table.Cell>
                    <Table.Cell className={styles.ellipsis}>{asset.locationName}</Table.Cell>
                    <Table.Cell className={styles.numeric}>
                      {formatDateDisplay(asset.purchaseDate)}
                    </Table.Cell>
                    <Table.Cell style={{ textAlign: 'right' }}>
                      {(canEdit || canArchive) && (
                        <Menu
                          triggerLabel={`More actions for ${asset.tag}`}
                          trigger={
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          }
                          items={[
                            ...(canEdit ? [{ label: 'Edit', onSelect: () => onEdit(asset) }] : []),
                            ...(canArchive
                              ? [{ label: 'Archive', danger: true, onSelect: () => onDelete(asset) }]
                              : []),
                          ]}
                        />
                      )}
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </tbody>
        </Table.Root>
      </Table.Container>

      <div className={styles.footer}>
        <span className={styles.tabular}>
          {total === 0
            ? 'No assets found'
            : `Showing ${firstRow}–${firstRow + pageItems.length - 1} of ${total} asset${
                total === 1 ? '' : 's'
              }`}
        </span>
        <div className={styles.pager}>
          <label className={styles.pageSize}>
            Rows per page
            <Select
              className={styles.pageSizeSelect}
              value={pageSize}
              onChange={(e) => {
                const size = Number(e.target.value)
                dispatch(setPageSize(size))
                savePageSize(size)
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
          <Pagination page={page} pageCount={pageCount} onPageChange={(p) => dispatch(setPage(p))} />
        </div>
      </div>
    </>
  )
}
