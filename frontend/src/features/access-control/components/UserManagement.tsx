import { useState } from 'react'
import { Badge, Button, Checkbox, Pagination, SearchField } from '@/components/ui'
import { describeError } from '@/lib/apiClient'
import { useDebouncedValue } from '@/utils/useDebouncedValue'
import {
  useReplaceUserRolesMutation,
  useRolesQuery,
  useUsersQuery,
} from '../api/accessControl.api'
import type { AccessUser, Role } from '../types'
import styles from '../pages/AccessControlPage.module.css'

function AssignmentEditor({
  user,
  roles,
  onClose,
}: {
  user: AccessUser
  roles: Role[]
  onClose: () => void
}) {
  const replaceRoles = useReplaceUserRolesMutation()
  const [roleIds, setRoleIds] = useState<string[]>(() => user.roles.map((role) => role.id))
  const [error, setError] = useState('')

  const hasInactiveAssignment = roleIds.some(
    (roleId) => roles.find((role) => role.id === roleId)?.isActive === false,
  )

  async function save() {
    setError('')
    try {
      await replaceRoles.mutateAsync({ id: user.id, roleIds })
      onClose()
    } catch (saveError) {
      setError(describeError(saveError))
    }
  }

  return (
    <div className={styles.assignmentEditor}>
      <div className={styles.assignmentHeader}>
        <div>
          <h3>Assign roles</h3>
          <p>{user.displayName} · {user.email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {hasInactiveAssignment && (
        <div className={styles.notice} role="note">
          Remove inactive role assignments before saving.
        </div>
      )}
      <fieldset className={styles.assignmentRoles} disabled={replaceRoles.isPending}>
        <legend className={styles.visuallyHidden}>Roles for {user.displayName}</legend>
        {roles.map((role) => {
          const checked = roleIds.includes(role.id)
          return (
            <label key={role.id}>
              <Checkbox
                checked={checked}
                disabled={!role.isActive && !checked}
                onChange={(event) =>
                  setRoleIds((current) =>
                    event.target.checked
                      ? [...current, role.id]
                      : current.filter((id) => id !== role.id),
                  )
                }
              />
              <span>
                <strong>{role.name}{role.isActive ? '' : ' (inactive)'}</strong>
                {role.description && <small>{role.description}</small>}
              </span>
            </label>
          )
        })}
      </fieldset>
      <div className={styles.formActions}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={replaceRoles.isPending || hasInactiveAssignment}
        >
          {replaceRoles.isPending ? 'Saving…' : 'Replace roles'}
        </Button>
      </div>
    </div>
  )
}

export function UserManagement({
  currentUserId,
  canAssign,
}: {
  currentUserId: string
  canAssign: boolean
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const params = { page, pageSize: 10, search: debouncedSearch.trim() || undefined }
  const usersQuery = useUsersQuery(params, true)
  const rolesQuery = useRolesQuery(canAssign)

  const users = usersQuery.data?.items ?? []
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null
  const total = usersQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <section className={styles.section} aria-labelledby="users-heading">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="users-heading">Users</h2>
          <p>Review accounts and replace their assigned roles.</p>
        </div>
      </div>

      <SearchField
        className={styles.userSearch}
        aria-label="Search users"
        placeholder="Search by name or email…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setPage(1)
        }}
      />

      {usersQuery.isError && (
        <div className={styles.error} role="alert">{describeError(usersQuery.error)}</div>
      )}
      {rolesQuery.isError && canAssign && (
        <div className={styles.error} role="alert">{describeError(rolesQuery.error)}</div>
      )}

      {selectedUser && canAssign && rolesQuery.data ? (
        <AssignmentEditor
          key={selectedUser.id}
          user={selectedUser}
          roles={rolesQuery.data}
          onClose={() => setSelectedUserId(null)}
        />
      ) : (
        <div className={styles.userList} aria-busy={usersQuery.isFetching}>
          {usersQuery.isLoading && <p className={styles.placeholder}>Loading users…</p>}
          {!usersQuery.isLoading && users.length === 0 && (
            <p className={styles.placeholder}>No users match your search.</p>
          )}
          {users.map((user) => {
            const isSelf = user.id === currentUserId
            return (
              <article key={user.id} className={styles.userRow}>
                <div className={styles.userIdentity}>
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                </div>
                <div className={styles.userRoles} aria-label={`Roles for ${user.displayName}`}>
                  {user.roles.length ? user.roles.map((role) => (
                    <Badge key={role.id} shape="rect">{role.name}</Badge>
                  )) : <span>No roles</span>}
                </div>
                <div className={styles.userActions}>
                  {!user.isActive && <Badge shape="rect">Inactive</Badge>}
                  {canAssign && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf}
                      title={isSelf ? 'You cannot change your own roles' : undefined}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      {isSelf ? 'Current user' : 'Manage roles'}
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {!selectedUser && total > 0 && (
        <div className={styles.pagination}>
          <span>{total} user{total === 1 ? '' : 's'}</span>
          <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}
    </section>
  )
}
