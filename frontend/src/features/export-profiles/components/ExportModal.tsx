import { useEffect, useState } from 'react'
import { Button, FormField, Modal, Input, Select } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import { hasEveryPermission, hasPermission, useCurrentSessionQuery } from '@/features/auth'
import { useExportAssetsMutation } from '../api/exports.api'
import { useCreateProfileMutation, useProfilesQuery } from '../api/profiles.api'
import { useExportColumns } from '../hooks/useExportColumns'
import { DEFAULT_EXPORT_COLUMNS, type ExportDateFormat, type ExportScope } from '../types'
import { ColumnEditor } from './ColumnEditor'
import styles from './ExportModal.module.css'

export interface ExportModalProps {
  open: boolean
  onClose: () => void
  /** Row count the export will contain — every asset matching the current filters (ADR-0008). */
  scopeCount: number
  /** The list's current filters and sort; the server re-applies them to build the file. */
  scope: ExportScope
}

/** The "Export to Excel" dialog opened from the Inventory page (S-03 / S-04). */
export function ExportModal({ open, onClose, scopeCount, scope }: ExportModalProps) {
  const { data: session } = useCurrentSessionQuery()
  const canExport = hasEveryPermission(session, ['assets.view', 'exports.run'])
  const canViewProfiles = hasPermission(session, 'exportProfiles.view')
  const canCreateProfile = hasPermission(session, 'exportProfiles.create')
  const { data: profiles = [] } = useProfilesQuery(open && canViewProfiles)
  const createProfile = useCreateProfileMutation()
  const exportAssets = useExportAssetsMutation()
  const toast = useToast()

  const [profileId, setProfileId] = useState('')
  const [dateFormat, setDateFormat] = useState<ExportDateFormat>('DD/MM/YYYY')
  const [profileName, setProfileName] = useState('')
  const { columns, reset, toggle, rename, move } = useExportColumns(DEFAULT_EXPORT_COLUMNS)

  // Intentionally keyed on `open` alone: this should reset the form each time
  // the dialog opens, not whenever `reset`'s identity changes between renders.
  useEffect(() => {
    if (!open) return
    setProfileId('')
    setProfileName('')
    setDateFormat('DD/MM/YYYY')
    reset(DEFAULT_EXPORT_COLUMNS)
  }, [open])

  function handleProfileSelect(id: string) {
    setProfileId(id)
    const profile = profiles.find((p) => p.id === id)
    if (profile) {
      reset(profile.columns)
      setDateFormat(profile.dateFormat)
      setProfileName(profile.name)
    } else {
      reset(DEFAULT_EXPORT_COLUMNS)
      setProfileName('')
    }
  }

  function handleSaveProfile() {
    if (!canCreateProfile) return
    if (!profileName.trim()) {
      toast.show('Give the profile a name before saving.')
      return
    }
    createProfile.mutate(
      { name: profileName.trim(), dateFormat, columns },
      {
        onSuccess: () => toast.show(`Saved profile "${profileName.trim()}".`),
        onError: (error) => toast.show(describeError(error)),
      },
    )
  }

  function handleExport() {
    if (!canExport) return
    if (!columns.some((c) => c.included)) {
      toast.show('Pick at least one column to export.')
      return
    }
    exportAssets.mutate(
      { ...scope, columns, dateFormat },
      {
        onSuccess: ({ filename, rowCount }) => {
          onClose()
          toast.show(`Exported ${rowCount} row${rowCount === 1 ? '' : 's'} to ${filename}`)
        },
        onError: (error) => toast.show(`Export failed: ${describeError(error)}`),
      },
    )
  }

  if (!canExport) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export to Excel"
      description="Choose columns, order, labels and a date format."
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleExport} disabled={exportAssets.isPending}>
            {exportAssets.isPending ? 'Exporting…' : 'Export rows'}
          </Button>
        </>
      }
    >
      <div className={styles.scopeNote}>
        Exporting {scopeCount} row{scopeCount === 1 ? '' : 's'} — every asset matching your
        current filters.
      </div>

      {canViewProfiles && (
        <FormField label="Start from" htmlFor="profile-select">
          <Select
            id="profile-select"
            value={profileId}
            onChange={(e) => handleProfileSelect(e.target.value)}
          >
            <option value="">Ad-hoc (default columns)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <div>
        <div className={styles.sectionLabel}>Columns &amp; order</div>
        <ColumnEditor columns={columns} onToggle={toggle} onRename={rename} onMove={move} />
      </div>

      <FormField label="Date format in file" htmlFor="date-format-select">
        <Select
          id="date-format-select"
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value as ExportDateFormat)}
        >
          <option value="DD/MM/YYYY">DD/MM/YYYY — 14/03/2024</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY — 03/14/2024</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD — 2024-03-14</option>
        </Select>
      </FormField>

      {canCreateProfile && (
        <div>
          <div className={styles.sectionLabel}>Save this layout</div>
          <div className={styles.saveRow}>
            <Input
              aria-label="Profile name"
              placeholder="Profile name, e.g. Monthly IT report"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={handleSaveProfile}>
              Save profile
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
