import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { authKeys } from '@/features/auth/api/auth.api'
import { sessionFixture } from '@/test/fixtures'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { AccessControlPage } from './AccessControlPage'

const systemRole = {
  id: 'role-system',
  systemKey: 'ADMIN',
  name: 'Administrator',
  description: 'Built-in administrator role',
  isSystem: true,
  isActive: true,
  permissions: ['roles.view', 'users.view'],
}
const managerRole = {
  id: 'role-manager',
  systemKey: null,
  name: 'Asset manager',
  description: 'Manages inventory',
  isSystem: false,
  isActive: true,
  permissions: ['assets.view'],
}

function useAccessHandlers() {
  server.use(
    http.get('/api/permissions', () =>
      HttpResponse.json([
        { key: 'assets.view', name: 'View assets', description: 'Read inventory records' },
        { key: 'roles.view', name: 'View roles', description: 'Read role definitions' },
      ]),
    ),
    http.get('/api/roles', () => HttpResponse.json([systemRole, managerRole])),
    http.get('/api/roles/role-system', () => HttpResponse.json(systemRole)),
    http.get('/api/roles/role-manager', () => HttpResponse.json(managerRole)),
    http.get('/api/users', () =>
      HttpResponse.json({
        items: [
          {
            id: 'user-1',
            email: 'alex@example.com',
            displayName: 'Alex Morgan',
            isActive: true,
            roles: [{ id: systemRole.id, systemKey: systemRole.systemKey, name: systemRole.name }],
          },
          {
            id: 'user-2',
            email: 'sam@example.com',
            displayName: 'Sam Lee',
            isActive: true,
            roles: [],
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      }),
    ),
  )
}

describe('AccessControlPage', () => {
  it('keeps system roles immutable and disables self-assignment', async () => {
    useAccessHandlers()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      authKeys.session(),
      sessionFixture(['roles.view', 'roles.create', 'roles.update', 'roles.assign', 'users.view']),
    )

    renderWithProviders(<AccessControlPage />, { route: '/admin/access', queryClient })

    expect(await screen.findByText('System roles are read-only and cannot be changed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New role' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument()

    const currentUserButton = await screen.findByRole('button', { name: 'Current user' })
    expect(currentUserButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manage roles' })).toBeEnabled()
  })

  it('offers only permissions the signed-in administrator holds when creating a role', async () => {
    useAccessHandlers()
    server.use(
      http.get('/api/permissions', () =>
        HttpResponse.json([
          { key: 'assets.view', name: 'View assets', description: 'Read inventory records' },
          { key: 'roles.view', name: 'View roles', description: 'Read role definitions' },
          { key: 'users.view', name: 'View users', description: 'Read user accounts' },
        ]),
      ),
    )
    let submitted: { name: string; permissionKeys: string[] } | null = null
    const createdRole = {
      id: 'role-new',
      systemKey: null,
      name: 'Inventory reader',
      description: null,
      isSystem: false,
      isActive: true,
      permissions: ['assets.view'],
    }
    server.use(
      http.post('/api/roles', async ({ request }) => {
        submitted = (await request.json()) as typeof submitted
        return HttpResponse.json(
          { ...createdRole, name: submitted!.name, permissions: submitted!.permissionKeys },
          { status: 201 },
        )
      }),
      http.get('/api/roles/role-new', () => HttpResponse.json(createdRole)),
    )

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      authKeys.session(),
      sessionFixture(['roles.view', 'roles.create', 'assets.view']),
    )
    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    await user.click(await screen.findByRole('button', { name: 'New role' }))
    expect(screen.queryByRole('checkbox', { name: /View users/ })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Role name'), 'Inventory reader')
    await user.click(screen.getByRole('checkbox', { name: /View assets/ }))
    await user.click(screen.getByRole('button', { name: 'Create role' }))

    await waitFor(() =>
      expect(submitted).toEqual({ name: 'Inventory reader', permissionKeys: ['assets.view'] }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Inventory reader', level: 3 }),
    ).toBeInTheDocument()
  })

  it('allows a safe reduction of permissions the administrator does not hold', async () => {
    useAccessHandlers()
    let submitted: { permissionKeys: string[] } | null = null
    server.use(
      http.put('/api/roles/role-manager', async ({ request }) => {
        submitted = (await request.json()) as typeof submitted
        return HttpResponse.json({ ...managerRole, permissions: submitted!.permissionKeys })
      }),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['roles.view', 'roles.update']))

    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    await user.click(await screen.findByRole('button', { name: /Asset manager/ }))
    expect(
      await screen.findByText(/Remove permissions you do not hold before saving: assets\.view/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /View assets/ }))
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save role' }))
    await waitFor(() => expect(submitted).toMatchObject({ permissionKeys: [] }))
  })

  it('requires prerequisite permissions before a custom role can be created', async () => {
    useAccessHandlers()
    server.use(
      http.get('/api/permissions', () =>
        HttpResponse.json([
          { key: 'assets.view', name: 'View assets', description: 'Read inventory records' },
          { key: 'assets.create', name: 'Create assets', description: 'Create inventory records' },
          { key: 'roles.view', name: 'View roles', description: 'Read role definitions' },
        ]),
      ),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      authKeys.session(),
      sessionFixture(['roles.view', 'roles.create', 'assets.view', 'assets.create']),
    )

    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    await user.click(await screen.findByRole('button', { name: 'New role' }))
    await user.type(screen.getByLabelText('Role name'), 'Invalid asset creator')
    await user.click(screen.getByRole('checkbox', { name: /Create assets/ }))

    expect(await screen.findByText(/assets\.create requires assets\.view/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create role' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /View assets/ }))
    expect(screen.getByRole('button', { name: 'Create role' })).toBeEnabled()
  })

  it('shows no role mutation controls to a read-only role viewer', async () => {
    useAccessHandlers()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['roles.view']))

    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    expect(await screen.findByRole('heading', { name: 'Roles' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Asset manager/ }))
    expect(
      await screen.findByText('You can view this role, but you do not have permission to update it.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument()
  })

  it('disables roles that grant permissions the administrator cannot delegate', async () => {
    useAccessHandlers()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      authKeys.session(),
      sessionFixture(['roles.view', 'roles.assign', 'users.view']),
    )

    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    await user.click(await screen.findByRole('button', { name: 'Manage roles' }))
    expect(screen.getByRole('checkbox', { name: /Asset manager.*not delegable/ })).toBeDisabled()
  })

  it('shows server errors while replacing another user roles', async () => {
    useAccessHandlers()
    server.use(
      http.put('/api/users/user-2/roles', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_FAILED', message: 'At least one active role is required' } },
          { status: 400 },
        ),
      ),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      authKeys.session(),
      sessionFixture(['roles.view', 'roles.assign', 'users.view', 'assets.view']),
    )

    const { user } = renderWithProviders(<AccessControlPage />, {
      route: '/admin/access',
      queryClient,
    })

    await user.click(await screen.findByRole('button', { name: 'Manage roles' }))
    const editor = screen.getByRole('group', { name: 'Roles for Sam Lee' })
    await user.click(within(editor).getByText('Asset manager'))
    await user.click(screen.getByRole('button', { name: 'Replace roles' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('At least one active role is required')
    expect(screen.getByRole('heading', { name: 'Assign roles' })).toBeInTheDocument()
  })
})
