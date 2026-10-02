import { useEffect, useState, type FormEvent } from 'react'
import { Button, FormField, Modal, Input, Select } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import {
  useCreateProfileMutation,
  useProfilesQuery,
  useUpdateProfileMutation,
} from '../api/profiles.api'
import { useExportColumns } from '../hooks/useExportColumns'
import { DEFAULT_EXPORT_COLUMNS, type ExportDateFormat } from '../types'
import { ColumnEditor } from './ColumnEditor'
import styles from './ExportModal.module.css'

export interface ProfileFormModalProps {
  /** null = closed, 'new' = creating, an id = editing that profile. */
  editingProfileId: string | 'new' | null
  onClose: () => void
}

export function ProfileFormModal({ editingProfileId, onClose }: ProfileFormModalProps) {
  const open = editingProfileId !== null
  const { data: profiles = [] } = useProfilesQuery(open)
  const createProfile = useCreateProfileMutation()
  const updateProfile = useUpdateProfileMutation()
  const toast = useToast()

  const existing = profiles.find((p) => p.id === editingProfileId) ?? null

  const [name, setName] = useState('')
  const [dateFormat, setDateFormat] = useState<ExportDateFormat>('DD/MM/YYYY')
  const { columns, reset, toggle, rename, move } = useExportColumns(DEFAULT_EXPORT_COLUMNS)

  // Same reasoning as AssetFormModal: the Modal stays mounted for its
  // open/close transition, so resetting via effect (not a `key` remount) is the
  // pragmatic choice, keyed on open state + which profile is being edited.
  useEffect(() => {
    if (!open) return
    if (existing) {
      setName(existing.name)
      setDateFormat(existing.dateFormat)
      reset(existing.columns)
    } else {
      setName('')
      setDateFormat('DD/MM/YYYY')
      reset(DEFAULT_EXPORT_COLUMNS)
    }
  }, [open, existing])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.show('Give the profile a name before saving.')
      return
    }

    const input = { name: name.trim(), dateFormat, columns }
    const onSuccess = () => {
      toast.show(existing ? `Updated profile "${input.name}".` : `Saved profile "${input.name}".`)
      onClose()
    }

    // e.g. DUPLICATE_NAME — the dialog stays open so the name can be changed.
    const onError = (error: Error) => toast.show(describeError(error))

    if (existing) {
      updateProfile.mutate({ id: existing.id, input }, { onSuccess, onError })
    } else {
      createProfile.mutate(input, { onSuccess, onError })
    }
  }

  const isSaving = createProfile.isPending || updateProfile.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit profile' : 'New export profile'}
      description={existing ? `Update "${existing.name}".` : 'Define a reusable column layout.'}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="profile-form" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save profile'}
          </Button>
        </>
      }
    >
      <form id="profile-form" onSubmit={handleSubmit} className={styles.form}>
        <FormField label="Profile name" htmlFor="profile-name">
          <Input
            id="profile-name"
            placeholder="e.g. Monthly IT report"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <div>
          <div className={styles.sectionLabel}>Columns &amp; order</div>
          <ColumnEditor columns={columns} onToggle={toggle} onRename={rename} onMove={move} />
        </div>

        <FormField label="Date format in file" htmlFor="profile-date-format">
          <Select
            id="profile-date-format"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as ExportDateFormat)}
          >
            <option value="DD/MM/YYYY">DD/MM/YYYY — 14/03/2024</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY — 03/14/2024</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD — 2024-03-14</option>
          </Select>
        </FormField>
      </form>
    </Modal>
  )
}
