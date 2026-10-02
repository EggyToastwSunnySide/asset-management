import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, PageHeader, SearchField } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import { useAppDispatch, useAppSelector } from '@/app/store'
import { hasPermission, useCurrentSessionQuery } from '@/features/auth'
import {
  useCreateProfileMutation,
  useDeleteProfileMutation,
  useProfilesQuery,
} from '../api/profiles.api'
import { closeProfileForm, openEditProfile, openNewProfile } from '../store/exportProfilesUiSlice'
import type { ExportProfile } from '../types'
import { ProfileFormModal } from '../components/ProfileFormModal'
import { ProfileList } from '../components/ProfileList'
import styles from './ExportProfilesPage.module.css'

export function ExportProfilesPage() {
  const dispatch = useAppDispatch()
  const editingProfileId = useAppSelector((state) => state.exportProfilesUi.editingProfileId)
  const { data: session } = useCurrentSessionQuery()
  const canView = hasPermission(session, 'exportProfiles.view')
  const canCreate = hasPermission(session, 'exportProfiles.create')
  const canUpdate = hasPermission(session, 'exportProfiles.update')
  const canDelete = hasPermission(session, 'exportProfiles.delete')

  const { data: profiles = [], isLoading } = useProfilesQuery(canView)
  const deleteProfile = useDeleteProfileMutation()
  const createProfile = useCreateProfileMutation()
  const toast = useToast()

  // Page-local: unlike the inventory filters, nothing else needs to read it.
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const visible = query
    ? profiles.filter((p) => p.name.toLowerCase().includes(query))
    : profiles

  function handleDelete(profile: ExportProfile) {
    if (!canDelete) return
    const onError = (error: Error) => toast.show(describeError(error))
    deleteProfile.mutate(profile.id, {
      onSuccess: () =>
        toast.show(
          `Deleted profile "${profile.name}".`,
          canCreate
            ? {
                undo: {
                  // Profiles are hard-deleted, so undo re-creates the held copy.
                  onUndo: () =>
                    createProfile.mutate(
                      {
                        name: profile.name,
                        dateFormat: profile.dateFormat,
                        columns: profile.columns,
                      },
                      { onError },
                    ),
                },
              }
            : undefined,
        ),
      onError,
    })
  }

  return (
    <>
      <PageHeader
        title="Export profiles"
        subtitle="Save a column layout, header labels and date format once, then reuse it every time you export."
      />

      {/* Same shape as the Inventory toolbar: search takes the slack, the
          primary action sits at the right end. */}
      <div className={styles.toolbar}>
        <SearchField
          className={styles.search}
          placeholder="Search profiles…"
          aria-label="Search profiles by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canCreate && (
          <Button variant="primary" onClick={() => dispatch(openNewProfile())}>
            <Plus size={18} aria-hidden="true" />
            New profile
          </Button>
        )}
      </div>

      <ProfileList
        profiles={visible}
        totalCount={profiles.length}
        isLoading={isLoading}
        onCreate={() => dispatch(openNewProfile())}
        onClearSearch={() => setSearch('')}
        onEdit={(profile) => dispatch(openEditProfile(profile.id))}
        onDelete={handleDelete}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
      />

      {editingProfileId &&
        ((editingProfileId === 'new' && canCreate) ||
          (editingProfileId !== 'new' && canUpdate)) && (
          <ProfileFormModal
            editingProfileId={editingProfileId}
            onClose={() => dispatch(closeProfileForm())}
          />
        )}
    </>
  )
}
