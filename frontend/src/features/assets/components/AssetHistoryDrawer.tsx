import { Drawer, EmptyState } from '@/components/ui'
import { useAssetEventsQuery } from '../api/assets.api'
import type { Asset, AssetEvent } from '../types'
import styles from './AssetHistoryDrawer.module.css'

const ACTION_LABELS: Record<AssetEvent['type'], string> = {
  created: 'Created',
  updated: 'Updated',
  archived: 'Archived',
  restored: 'Restored',
  loaned: 'Borrowed',
  returned: 'Returned',
  replaced: 'Replaced',
}

export interface AssetHistoryDrawerProps {
  asset: Asset
  onClose: () => void
}

/** US-16: the asset's activity history, oldest first, with action, acting user and time. */
export function AssetHistoryDrawer({ asset, onClose }: AssetHistoryDrawerProps) {
  const { data: events, isLoading, isError } = useAssetEventsQuery(asset.id)

  return (
    <Drawer open onClose={onClose} title={`History of ${asset.tag}`} description={asset.name}>
      {isLoading ? (
        <EmptyState title="Loading history…" />
      ) : isError || !events ? (
        <EmptyState title="Couldn't load the history" description="Try again shortly." />
      ) : events.length === 0 ? (
        <EmptyState title="No activity recorded yet" />
      ) : (
        <ol className={styles.list} aria-label={`Activity history of ${asset.tag}`}>
          {events.map((event) => (
            <li key={event.id} className={styles.item}>
              <span className={styles.action}>{ACTION_LABELS[event.type]}</span>
              <span className={styles.meta}>
                {event.actor?.displayName ?? 'Unknown user'} ·{' '}
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </span>
              <span className={styles.description}>{event.description}</span>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  )
}
