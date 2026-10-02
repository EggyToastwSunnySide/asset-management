import { FileSpreadsheet, Pencil, Trash2 } from 'lucide-react'
import { Badge, Button, Card, IconButton } from '@/components/ui'
import type { ExportProfile } from '../types'
import styles from './ProfileCard.module.css'

export interface ProfileCardProps {
  profile: ExportProfile
  onEdit: () => void
  onDelete: () => void
  canUpdate: boolean
  canDelete: boolean
}

export function ProfileCard({ profile, onEdit, onDelete, canUpdate, canDelete }: ProfileCardProps) {
  const included = profile.columns.filter((c) => c.included)

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <div className={styles.icon} aria-hidden="true">
          <FileSpreadsheet size={20} />
        </div>
        <div className={styles.main}>
          <h2 className={styles.name}>{profile.name}</h2>
          <p className={styles.meta}>
            {included.length} of {profile.columns.length} columns &middot; dates as{' '}
            {profile.dateFormat}
          </p>
        </div>
      </div>

      {/* The header row of the file this profile produces, in order. */}
      <ol className={styles.columns} aria-label="Exported columns, in order">
        {included.map((col) => (
          <li key={col.key}>
            <Badge shape="rect">{col.label}</Badge>
          </li>
        ))}
      </ol>

      {(canUpdate || canDelete) && (
        <div className={styles.actions}>
          {canDelete && (
            <IconButton danger aria-label={`Delete ${profile.name}`} onClick={onDelete}>
              <Trash2 size={18} aria-hidden="true" />
            </IconButton>
          )}
          {canUpdate && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              Edit
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
