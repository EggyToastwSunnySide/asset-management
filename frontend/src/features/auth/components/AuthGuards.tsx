import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useCurrentSessionQuery } from '../api/auth.api'
import {
  firstPermittedRoute,
  hasAnyPermission,
  hasEveryPermission,
  safeInternalPath,
} from '../permissions'
import type { PermissionKey } from '../types'
import { BootstrapError, BootstrapLoading } from './RouteStatus'

export function RequireAuth({ children }: { children?: ReactNode }) {
  const sessionQuery = useCurrentSessionQuery()
  const location = useLocation()

  if (sessionQuery.isPending) return <BootstrapLoading />
  if (sessionQuery.isError) return <BootstrapError onRetry={() => void sessionQuery.refetch()} />
  if (!sessionQuery.data) {
    const from = safeInternalPath(`${location.pathname}${location.search}${location.hash}`)
    return <Navigate to="/sign-in" replace state={from ? { from } : undefined} />
  }
  return children ?? <Outlet />
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const sessionQuery = useCurrentSessionQuery()

  if (sessionQuery.isPending) return <BootstrapLoading />
  if (sessionQuery.isError) return <BootstrapError onRetry={() => void sessionQuery.refetch()} />
  if (sessionQuery.data) {
    return <Navigate to={firstPermittedRoute(sessionQuery.data)} replace />
  }
  return children
}

interface PermissionRequirement {
  permission?: PermissionKey
  permissions?: readonly PermissionKey[]
  mode?: 'all' | 'any'
}

function isAllowed(
  session: ReturnType<typeof useCurrentSessionQuery>['data'],
  { permission, permissions = [], mode = 'all' }: PermissionRequirement,
) {
  const required = permission ? [permission, ...permissions] : permissions
  return mode === 'any'
    ? hasAnyPermission(session, required)
    : hasEveryPermission(session, required)
}

export function RequirePermission({
  children,
  ...requirement
}: PermissionRequirement & { children?: ReactNode }) {
  const { data: session } = useCurrentSessionQuery()
  if (!session) return <Navigate to="/sign-in" replace />
  if (!isAllowed(session, requirement)) return <Navigate to="/forbidden" replace />
  return children ?? <Outlet />
}

export function PermissionGate({
  children,
  fallback = null,
  ...requirement
}: PermissionRequirement & { children: ReactNode; fallback?: ReactNode }) {
  const { data: session } = useCurrentSessionQuery()
  return isAllowed(session, requirement) ? children : fallback
}
