import type { AuthSession, PermissionKey } from './types'

export function hasPermission(
  session: Pick<AuthSession, 'permissions'> | null | undefined,
  permission: PermissionKey,
) {
  return session?.permissions.includes(permission) ?? false
}

export function hasEveryPermission(
  session: Pick<AuthSession, 'permissions'> | null | undefined,
  permissions: readonly PermissionKey[],
) {
  return permissions.every((permission) => hasPermission(session, permission))
}

export function hasAnyPermission(
  session: Pick<AuthSession, 'permissions'> | null | undefined,
  permissions: readonly PermissionKey[],
) {
  return permissions.some((permission) => hasPermission(session, permission))
}

export const ROUTE_PERMISSIONS = {
  inventory: ['assets.view'],
  exportProfiles: ['exportProfiles.view'],
  accessControl: ['roles.view', 'users.view'],
} as const satisfies Record<string, readonly PermissionKey[]>

export function firstPermittedRoute(session: Pick<AuthSession, 'permissions'> | null | undefined) {
  if (hasPermission(session, 'assets.view')) return '/inventory'
  if (hasPermission(session, 'exportProfiles.view')) return '/export-profiles'
  if (hasAnyPermission(session, ROUTE_PERMISSIONS.accessControl)) return '/admin/access'
  return '/forbidden'
}

/** Keep only an app-local path when carrying a requested route through sign-in. */
export function safeInternalPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
  try {
    const url = new URL(path, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
