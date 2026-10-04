import { useMemo, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Checkbox, FormField, Input } from '@/components/ui'
import { useCurrentSessionQuery } from '@/features/auth'
import { describeError } from '@/lib/apiClient'
import {
  useCreateRoleMutation,
  usePermissionsQuery,
  useRoleQuery,
  useRolesQuery,
  useUpdateRoleMutation,
} from '../api/accessControl.api'
import { missingPermissionPrerequisites } from '../permissionPrerequisites'
import type { Permission, Role } from '../types'
import styles from '../pages/AccessControlPage.module.css'

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function PermissionGroups({
  permissions,
  selected,
  disabled,
  canSelect,
  onChange,
}: {
  permissions: Permission[]
  selected: Role['permissions']
  disabled: boolean
  canSelect: (key: Permission['key'], checked: boolean) => boolean
  onChange: (keys: Role['permissions']) => void
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Permission[]>()
    for (const permission of permissions) {
      const group = permission.group || permission.key.split('.')[0]
      grouped.set(group, [...(grouped.get(group) ?? []), permission])
    }
    return [...grouped.entries()]
  }, [permissions])

  return (
    <div className={styles.permissionGroups}>
      {groups.map(([group, items]) => (
        <fieldset key={group} className={styles.permissionGroup} disabled={disabled}>
          <legend>{humanize(group)}</legend>
          {items.map((permission) => {
            const checked = selected.includes(permission.key)
            return (
              <label key={permission.key} className={styles.permissionOption}>
                <Checkbox
                  checked={checked}
                  disabled={disabled || !canSelect(permission.key, checked)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, permission.key]
                        : selected.filter((key) => key !== permission.key),
                    )
                  }
                />
                <span>
                  <strong>{permission.name || humanize(permission.key.split('.').at(-1) ?? '')}</strong>
                  <small>{permission.description || permission.key}</small>
                </span>
              </label>
            )
          })}
        </fieldset>
      ))}
    </div>
  )
}

function RoleForm({
  role,
  creating,
  canUpdate,
  onSaved,
  onCancelCreate,
}: {
  role: Role | null
  creating: boolean
  canUpdate: boolean
  onSaved: (role: Role) => void
  onCancelCreate: () => void
}) {
  const permissionsQuery = usePermissionsQuery(true)
  const createRole = useCreateRoleMutation()
  const updateRole = useUpdateRoleMutation()
  const { data: session } = useCurrentSessionQuery()

  const heldPermissions = useMemo(() => new Set(session?.permissions ?? []), [session])
  const visiblePermissions = useMemo(
    () =>
      (permissionsQuery.data ?? []).filter(
        (permission) => heldPermissions.has(permission.key) || role?.permissions.includes(permission.key),
      ),
    [permissionsQuery.data, heldPermissions, role],
  )

  const immutable = Boolean(role?.isSystem)
  const editable = creating || (canUpdate && !immutable)
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [isActive, setIsActive] = useState(role?.isActive ?? true)
  const [permissionKeys, setPermissionKeys] = useState<Role['permissions']>(role?.permissions ?? [])
  const [error, setError] = useState('')
  const unheldSelected = permissionKeys.filter((key) => !heldPermissions.has(key))
  const missingPrerequisites = missingPermissionPrerequisites(permissionKeys)
  const invalidPermissionSet = unheldSelected.length > 0 || missingPrerequisites.length > 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editable || !name.trim() || invalidPermissionSet) return
    setError('')

    try {
      const saved = creating
        ? await createRole.mutateAsync({
            name: name.trim(),
            description: description.trim() || undefined,
            permissionKeys: permissionKeys as Role['permissions'],
          })
        : await updateRole.mutateAsync({
            id: role!.id,
            input: {
              name: name.trim(),
              description: description.trim() || undefined,
              isActive,
              permissionKeys: permissionKeys as Role['permissions'],
            },
          })
      onSaved(saved)
    } catch (saveError) {
      setError(describeError(saveError))
    }
  }

  const isSaving = createRole.isPending || updateRole.isPending

  return (
    <form className={styles.editor} onSubmit={handleSubmit}>
      <div className={styles.editorHeader}>
        <div>
          <h3>{creating ? 'New role' : role?.name}</h3>
          {role?.systemKey && <p>System key: {role.systemKey}</p>}
        </div>
        {role?.isSystem && <Badge shape="rect">System role</Badge>}
      </div>

      {immutable && (
        <div className={styles.notice} role="note">
          System roles are read-only and cannot be changed.
        </div>
      )}
      {!creating && !immutable && !canUpdate && (
        <div className={styles.notice} role="note">
          You can view this role, but you do not have permission to update it.
        </div>
      )}
      {editable && unheldSelected.length > 0 && (
        <div className={styles.notice} role="note">
          Remove permissions you do not hold before saving: {unheldSelected.join(', ')}.
        </div>
      )}
      {editable && missingPrerequisites.length > 0 && (
        <div className={styles.notice} role="note">
          Add required permissions before saving:{' '}
          {missingPrerequisites
            .map(({ permission, prerequisite }) => `${permission} requires ${prerequisite}`)
            .join('; ')}.
        </div>
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}

      <fieldset className={styles.editorFields} disabled={!editable || isSaving}>
        <FormField label="Role name" htmlFor="role-name">
          <Input
            id="role-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="Description" htmlFor="role-description" hint="Optional">
          <Input
            id="role-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        {!creating && (
          <label className={styles.activeToggle}>
            <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Active role
          </label>
        )}
      </fieldset>

      <div>
        <h4 className={styles.subheading}>Permissions</h4>
        {permissionsQuery.isLoading ? (
          <p className={styles.placeholder}>Loading permissions…</p>
        ) : permissionsQuery.isError ? (
          <div className={styles.error} role="alert">{describeError(permissionsQuery.error)}</div>
        ) : (
          <PermissionGroups
            permissions={visiblePermissions}
            selected={permissionKeys}
            disabled={!editable || isSaving}
            canSelect={(key, checked) => checked || heldPermissions.has(key)}
            onChange={setPermissionKeys}
          />
        )}
      </div>

      {editable && (
        <div className={styles.formActions}>
          {creating && (
            <Button variant="outline" onClick={onCancelCreate}>
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={isSaving || !name.trim() || invalidPermissionSet}
          >
            {isSaving ? 'Saving…' : creating ? 'Create role' : 'Save role'}
          </Button>
        </div>
      )}
    </form>
  )
}

function RoleEditor({
  roleId,
  creating,
  canUpdate,
  onSaved,
  onCancelCreate,
}: {
  roleId: string | null
  creating: boolean
  canUpdate: boolean
  onSaved: (role: Role) => void
  onCancelCreate: () => void
}) {
  const roleQuery = useRoleQuery(roleId, !creating)

  if (!creating && !roleId) {
    return <p className={styles.placeholder}>Select a role to inspect its permissions.</p>
  }
  if (!creating && roleQuery.isLoading) return <p className={styles.placeholder}>Loading role…</p>
  if (!creating && roleQuery.isError) {
    return <div className={styles.error} role="alert">{describeError(roleQuery.error)}</div>
  }

  const role = creating ? null : roleQuery.data ?? null
  return (
    <RoleForm
      key={creating ? 'new' : role!.id}
      role={role}
      creating={creating}
      canUpdate={canUpdate}
      onSaved={onSaved}
      onCancelCreate={onCancelCreate}
    />
  )
}

export function RoleManagement({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const rolesQuery = useRolesQuery(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const activeSelectedId = creating ? null : selectedId ?? rolesQuery.data?.[0]?.id ?? null

  return (
    <section className={styles.section} aria-labelledby="roles-heading">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="roles-heading">Roles</h2>
          <p>Define permission sets used across the application.</p>
        </div>
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
            }}
          >
            <Plus size={16} aria-hidden="true" />
            New role
          </Button>
        )}
      </div>

      {rolesQuery.isError && (
        <div className={styles.error} role="alert">{describeError(rolesQuery.error)}</div>
      )}

      <div className={styles.roleWorkspace}>
        <div className={styles.roleList} aria-label="Roles">
          {rolesQuery.isLoading && <p className={styles.placeholder}>Loading roles…</p>}
          {rolesQuery.data?.map((role) => (
            <button
              type="button"
              key={role.id}
              className={activeSelectedId === role.id && !creating ? styles.roleSelected : undefined}
              onClick={() => {
                setCreating(false)
                setSelectedId(role.id)
              }}
            >
              <span>{role.name}</span>
              <small>{role.isActive ? 'Active' : 'Inactive'}{role.isSystem ? ' · System' : ''}</small>
            </button>
          ))}
        </div>
        <RoleEditor
          roleId={activeSelectedId}
          creating={creating}
          canUpdate={canUpdate}
          onCancelCreate={() => setCreating(false)}
          onSaved={(role) => {
            setCreating(false)
            setSelectedId(role.id)
          }}
        />
      </div>
    </section>
  )
}
