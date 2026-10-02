import type { PermissionKey } from '@/features/auth'

export interface Permission {
  key: PermissionKey
  name?: string
  description?: string | null
  group?: string | null
}

export interface RoleSummary {
  id: string
  systemKey: string | null
  name: string
  description: string | null
  isSystem: boolean
  isActive: boolean
  permissions: PermissionKey[]
}

export type Role = RoleSummary

export interface RoleInput {
  name: string
  description?: string
  permissionKeys: PermissionKey[]
}

export interface RoleUpdateInput extends RoleInput {
  isActive: boolean
}

export interface AccessUserRole {
  id: string
  systemKey: string | null
  name: string
}

export interface AccessUser {
  id: string
  email: string
  displayName: string
  isActive: boolean
  roles: AccessUserRole[]
}

export type UserListParams = {
  page: number
  pageSize: number
  search?: string
}
