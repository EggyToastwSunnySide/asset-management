import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { firstPermittedRoute } from '../permissions'
import { useCurrentSessionQuery } from '../api/auth.api'
import styles from '../components/RouteStatus.module.css'

export function ForbiddenPage() {
  const navigate = useNavigate()
  const { data: session } = useCurrentSessionQuery()
  if (!session) return <Navigate to="/sign-in" replace />

  const destination = firstPermittedRoute(session)

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>You don't have access</h1>
        <p className={styles.description}>
          Your account does not have permission to open this page.
        </p>
        {destination !== '/forbidden' && (
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => navigate(destination, { replace: true })}>
              Go to an available page
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
