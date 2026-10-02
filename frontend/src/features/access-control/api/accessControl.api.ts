import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Page } from '@/lib/apiClient'
import type {
  AccessUser,
  Permission,
  Role,
  RoleInput,
  RoleUpdateInput,
  UserListParams,
} from '../types'

interface RoleResponse extends Omit<Role, 'isSystem' | 'permissions'> {
  isSystem?: boolean
  permissions?: Role['permissions']
  permissionKeys?: Role['permissions']
}

function normalizeRole(role: RoleResponse): Role {
  return {
    ...role,
    isSystem: role.isSystem ?? Boolean(role.systemKey),
    permissions: role.permissions ?? role.permissionKeys ?? [],
  }
}

const fetchPermissions = () => apiClient.get<Permission[]>('/permissions')
const fetchRoles = async () => (await apiClient.get<RoleResponse[]>('/roles')).map(normalizeRole)
const fetchRole = async (id: string) =>
  normalizeRole(await apiClient.get<RoleResponse>(`/roles/${encodeURIComponent(id)}`))
const createRole = async (input: RoleInput) =>
  normalizeRole(await apiClient.post<RoleResponse>('/roles', input))
const updateRole = async (id: string, input: RoleUpdateInput) =>
  normalizeRole(await apiClient.put<RoleResponse>(`/roles/${encodeURIComponent(id)}`, input))
const fetchUsers = (params: UserListParams) =>
  apiClient.get<Page<AccessUser>>('/users', params)
const replaceUserRoles = (id: string, roleIds: string[]) =>
  apiClient.put<AccessUser>(`/users/${encodeURIComponent(id)}/roles`, { roleIds })

export const accessKeys = {
  all: ['access-control'] as const,
  permissions: () => [...accessKeys.all, 'permissions'] as const,
  roles: () => [...accessKeys.all, 'roles'] as const,
  role: (id: string) => [...accessKeys.roles(), id] as const,
  users: () => [...accessKeys.all, 'users'] as const,
  userList: (params: UserListParams) => [...accessKeys.users(), params] as const,
}

export function usePermissionsQuery(enabled = true) {
  return useQuery({ queryKey: accessKeys.permissions(), queryFn: fetchPermissions, enabled })
}

export function useRolesQuery(enabled = true) {
  return useQuery({ queryKey: accessKeys.roles(), queryFn: fetchRoles, enabled })
}

export function useRoleQuery(id: string | null, enabled = true) {
  return useQuery({
    queryKey: accessKeys.role(id ?? ''),
    queryFn: () => fetchRole(id!),
    enabled: enabled && Boolean(id),
  })
}

export function useCreateRoleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createRole,
    onSuccess: (role) => {
      queryClient.setQueryData(accessKeys.role(role.id), role)
      return queryClient.invalidateQueries({ queryKey: accessKeys.roles() })
    },
  })
}

export function useUpdateRoleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RoleUpdateInput }) => updateRole(id, input),
    onSuccess: (role) => {
      queryClient.setQueryData(accessKeys.role(role.id), role)
      return queryClient.invalidateQueries({ queryKey: accessKeys.roles() })
    },
  })
}

export function useUsersQuery(params: UserListParams, enabled = true) {
  return useQuery({
    queryKey: accessKeys.userList(params),
    queryFn: () => fetchUsers(params),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useReplaceUserRolesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      replaceUserRoles(id, roleIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKeys.users() }),
  })
}
