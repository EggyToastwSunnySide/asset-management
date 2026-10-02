import { Button, EmptyState } from '@/components/ui'
import type { ExportProfile } from '../types'
import { ProfileCard } from './ProfileCard'
import styles from './ProfileList.module.css'

export interface ProfileListProps {
  /** The profiles to show — already narrowed by the page's search. */
  profiles: ExportProfile[]
  /** How many profiles exist before search, to tell "none yet" from "no match". */
  totalCount: number
  isLoading: boolean
  onCreate: () => void
  onClearSearch: () => void
  onEdit: (profile: ExportProfile) => void
  onDelete: (profile: ExportProfile) => void
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export function ProfileList({
  profiles,
  totalCount,
  isLoading,
  onCreate,
  onClearSearch,
  onEdit,
  onDelete,
  canCreate,
  canUpdate,
  canDelete,
}: ProfileListProps) {
  if (isLoading) {
    return <EmptyState title="Loading profiles…" />
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        title="No saved profiles yet"
        description="Save a column layout from the export dialog, or start a new one here."
        action={
          canCreate ? (
            <Button variant="primary" onClick={onCreate}>
              New profile
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No profiles match your search"
        description="Try a different name."
        action={
          <Button variant="outline" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    )
  }

  return (
    <>
      <p className={styles.count}>
        {profiles.length === totalCount
          ? `${totalCount} profile${totalCount === 1 ? '' : 's'}`
          : `${profiles.length} of ${totalCount} profiles`}
      </p>
      <ul className={styles.grid}>
        {profiles.map((profile) => (
          <li key={profile.id}>
            <ProfileCard
              profile={profile}
              onEdit={() => onEdit(profile)}
              onDelete={() => onDelete(profile)}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
