export const PERMISSIONS = [
  'assets.view',
  'assets.create',
  'assets.update',
  'assets.archive',
  'assets.restore',
  'exports.run',
  'exportProfiles.view',
  'exportProfiles.create',
  'exportProfiles.update',
  'exportProfiles.delete',
  'users.view',
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.assign',
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]

export interface AuthUser {
  id: string
  email: string
  displayName: string
}

export interface AuthRole {
  id: string
  name: string
  systemKey: string | null
}

export interface SessionExpiry {
  idleExpiresAt: string
  absoluteExpiresAt: string
}

export interface AuthSession {
  user: AuthUser
  roles: AuthRole[]
  permissions: PermissionKey[]
  session: SessionExpiry
  csrfToken: string
}

export interface SignInInput {
  email: string
  password: string
}
