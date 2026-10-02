import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Upload, Filter, Plus, X } from 'lucide-react'
import { Button, IconButton, SearchField, Select } from '@/components/ui'
import { useAppDispatch, useAppSelector } from '@/app/store'
import {
  setSearch,
  addFilter,
  updateFilter,
  removeFilter,
  clearConditions,
} from '../store/assetsUiSlice'
import { useReferenceDataQuery } from '../api/assets.api'
import {
  FILTER_FIELDS,
  type FilterField,
  type FilterOperator,
  type ReferenceData,
  type ReferenceItem,
} from '../types'
import styles from './AssetToolbar.module.css'

export interface AssetToolbarProps {
  onExport: () => void
  onAdd: () => void
  canExport: boolean
  canCreate: boolean
}

/**
 * Cloudflare-dashboard layout: search takes the slack on the left, and the
 * actions sit together on the right — the filters folded into one popover so
 * the bar stays a single row however many conditions are applied.
 */
export function AssetToolbar({ onExport, onAdd, canExport, canCreate }: AssetToolbarProps) {
  const dispatch = useAppDispatch()
  const search = useAppSelector((state) => state.assetsUi.filters.search)

  return (
    <div className={styles.toolbar}>
      <SearchField
        className={styles.search}
        placeholder="Search…"
        aria-label="Search assets by tag or name"
        value={search}
        onChange={(e) => dispatch(setSearch(e.target.value))}
      />

      <div className={styles.actions}>
        <FiltersPopover />

        {canExport && (
          <Button variant="outline" onClick={onExport}>
            <Upload size={18} aria-hidden="true" />
            Export
          </Button>
        )}

        {canCreate && (
          <Button variant="primary" onClick={onAdd}>
            <Plus size={18} aria-hidden="true" />
            Add record
          </Button>
        )}
      </div>
    </div>
  )
}

const FIELD_LABELS: Record<FilterField, string> = {
  type: 'Type',
  status: 'Status',
  location: 'Location',
}

/** Which reference-data list offers the values for each filter field. */
const VALUES_KEY: Record<FilterField, keyof ReferenceData> = {
  type: 'types',
  status: 'statuses',
  location: 'locations',
}

const NO_VALUES: ReferenceItem[] = []

function FiltersPopover() {
  const dispatch = useAppDispatch()
  const { data: referenceData } = useReferenceDataQuery()
  const conditions = useAppSelector((state) => state.assetsUi.filters.conditions)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  // Set when the user adds a row, so the effect below can focus that row's
  // first select once it has rendered.
  const focusNewRow = useRef(false)
  const id = useId()

  // Only rows with a value filter anything; search lives in the bar itself.
  const activeCount = conditions.filter((c) => c.value).length

  // Options carry the code (what filters match on) and show the display name.
  const valuesFor = (field: FilterField) => referenceData?.[VALUES_KEY[field]] ?? NO_VALUES

  useEffect(() => {
    if (!open) return
    const firstSelect = panelRef.current?.querySelector('select')
    ;(firstSelect ?? addRef.current)?.focus()

    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!focusNewRow.current) return
    focusNewRow.current = false
    const rows = panelRef.current?.querySelectorAll<HTMLElement>('[data-filter-row]')
    rows?.[rows.length - 1]?.querySelector('select')?.focus()
  }, [conditions.length])

  function update(conditionId: string, changes: Parameters<typeof updateFilter>[0]['changes']) {
    dispatch(updateFilter({ id: conditionId, changes }))
  }

  return (
    <div className={styles.filters} ref={containerRef}>
      <Button
        ref={triggerRef}
        variant="outline"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter size={18} aria-hidden="true" />
        Filters
        {activeCount > 0 && (
          <span className={styles.count} aria-hidden="true">
            {activeCount}
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" className={open ? styles.chevronOpen : undefined} />
      </Button>

      {open && (
        <div
          id={`${id}-panel`}
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Filters"
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Filters</span>
            <Button
              variant="ghost-accent"
              size="sm"
              disabled={conditions.length === 0}
              onClick={() => {
                dispatch(clearConditions())
                addRef.current?.focus()
              }}
            >
              Clear all
            </Button>
          </div>

          {conditions.length === 0 ? (
            <p className={styles.panelEmpty}>No filters applied. Add one to narrow the list.</p>
          ) : (
            <ul className={styles.conditions}>
              {conditions.map((condition, index) => {
                const n = index + 1
                return (
                  <li key={condition.id} className={styles.condition} data-filter-row>
                    <Select
                      aria-label={`Filter ${n} field`}
                      className={styles.conditionSelect}
                      value={condition.field}
                      onChange={(e) => update(condition.id, { field: e.target.value as FilterField })}
                    >
                      {FILTER_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field]}
                        </option>
                      ))}
                    </Select>

                    <Select
                      aria-label={`Filter ${n} operator`}
                      className={styles.conditionSelect}
                      value={condition.operator}
                      onChange={(e) =>
                        update(condition.id, { operator: e.target.value as FilterOperator })
                      }
                    >
                      <option value="is">is</option>
                      <option value="isNot">is not</option>
                    </Select>

                    <Select
                      aria-label={`Filter ${n} value`}
                      className={styles.conditionSelect}
                      value={condition.value}
                      onChange={(e) => update(condition.id, { value: e.target.value })}
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      {valuesFor(condition.field).map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </Select>

                    <IconButton
                      aria-label={`Remove filter ${n}`}
                      onClick={() => {
                        dispatch(removeFilter(condition.id))
                        addRef.current?.focus()
                      }}
                    >
                      <X size={18} aria-hidden="true" />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}

          <div className={styles.panelFooter}>
            <Button
              ref={addRef}
              variant="ghost-accent"
              size="sm"
              onClick={() => {
                focusNewRow.current = true
                dispatch(addFilter())
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Add filter
            </Button>
            {conditions.length > 1 && (
              <span className={styles.panelHint}>
                Different fields must all match; values of one field match any.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
