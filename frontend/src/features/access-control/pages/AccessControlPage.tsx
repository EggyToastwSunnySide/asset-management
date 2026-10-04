import { PageHeader } from '@/components/ui'
import {
  hasEveryPermission,
  hasPermission,
  useCurrentSessionQuery,
} from '@/features/auth'
import { RoleManagement } from '../components/RoleManagement'
import { UserManagement } from '../components/UserManagement'
import styles from './AccessControlPage.module.css'

export function AccessControlPage() {
  const { data: session } = useCurrentSessionQuery()
  if (!session) return null

  const canViewRoles = hasPermission(session, 'roles.view')
  const canViewUsers = hasPermission(session, 'users.view')

  return (
    <>
      <PageHeader
        title="Access control"
        subtitle="Manage roles, permissions and user assignments."
      />
      <div className={styles.stack}>
        {canViewRoles && (
          <RoleManagement
            canCreate={hasPermission(session, 'roles.create')}
            canUpdate={hasPermission(session, 'roles.update')}
          />
        )}
        {canViewUsers && (
          <UserManagement
            currentUserId={session.user.id}
            canAssign={hasEveryPermission(session, ['roles.view', 'roles.assign'])}
            actorPermissions={session.permissions}
          />
        )}
      </div>
    </>
  )
}
