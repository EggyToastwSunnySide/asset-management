import type { PermissionKey } from '@/features/auth'

export const PERMISSION_PREREQUISITES: Partial<Record<PermissionKey, readonly PermissionKey[]>> = {
  'assets.create': ['assets.view'],
  'assets.update': ['assets.view'],
  'assets.archive': ['assets.view'],
  'assets.restore': ['assets.view'],
  'exports.run': ['assets.view'],
  'exportProfiles.create': ['exportProfiles.view'],
  'exportProfiles.update': ['exportProfiles.view'],
  'exportProfiles.delete': ['exportProfiles.view'],
  'roles.create': ['roles.view'],
  'roles.update': ['roles.view'],
  'roles.assign': ['roles.view', 'users.view'],
}

export function missingPermissionPrerequisites(permissionKeys: readonly PermissionKey[]) {
  const selected = new Set(permissionKeys)
  const missing: Array<{ permission: PermissionKey; prerequisite: PermissionKey }> = []

  for (const permission of permissionKeys) {
    for (const prerequisite of PERMISSION_PREREQUISITES[permission] ?? []) {
      if (!selected.has(prerequisite)) missing.push({ permission, prerequisite })
    }
  }

  return missing
}
