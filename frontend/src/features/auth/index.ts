export { SignInPage } from './pages/SignInPage'
export { ForbiddenPage } from './pages/ForbiddenPage'
export { AuthEventBoundary } from './components/AuthEventBoundary'
export { useAuthActions } from './components/AuthActionsContext'
export {
  RequireAuth,
  PublicOnlyRoute,
  RequirePermission,
  PermissionGate,
} from './components/AuthGuards'
export { BootstrapLoading } from './components/RouteStatus'
export { useCurrentSessionQuery } from './api/auth.api'
export {
  firstPermittedRoute,
  hasPermission,
  hasAnyPermission,
  hasEveryPermission,
  safeInternalPath,
  ROUTE_PERMISSIONS,
} from './permissions'
export { PERMISSIONS } from './types'
export type {
  AuthSession,
  AuthUser,
  AuthRole,
  PermissionKey,
  SignInInput,
} from './types'
