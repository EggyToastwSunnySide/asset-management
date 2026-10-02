import { Button, Card } from '@/components/ui'
import styles from './RouteStatus.module.css'

export function BootstrapLoading() {
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <Card className={styles.card}>
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.title}>Loading your workspace</p>
        <p className={styles.description}>Checking your session and permissions…</p>
      </Card>
    </div>
  )
}

export function BootstrapError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Couldn't reach the server</h1>
        <p className={styles.description}>
          Your session could not be checked. Check your connection and try again.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </Card>
    </div>
  )
}
