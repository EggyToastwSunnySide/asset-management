import type { AuthSession, PermissionKey } from '@/features/auth'

export function sessionFixture(
  permissions: PermissionKey[] = ['assets.view'],
  overrides: Partial<AuthSession> = {},
): AuthSession {
  return {
    user: {
      id: 'user-1',
      email: 'alex@example.com',
      displayName: 'Alex Morgan',
    },
    roles: [{ id: 'role-1', name: 'Asset Manager', systemKey: 'ASSET_MANAGER' }],
    permissions,
    session: {
      idleExpiresAt: '2099-01-01T00:00:00.000Z',
      absoluteExpiresAt: '2099-01-02T00:00:00.000Z',
    },
    csrfToken: 'csrf-test-token',
    ...overrides,
  }
}
