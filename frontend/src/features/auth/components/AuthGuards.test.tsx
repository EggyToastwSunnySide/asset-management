import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { authKeys } from '../api/auth.api'
import { sessionFixture } from '@/test/fixtures'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { PermissionGate } from './AuthGuards'

describe('PermissionGate', () => {
  it('supports independent all and any permission requirements', () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view', 'roles.view']))

    renderWithProviders(
      <>
        <PermissionGate permissions={['assets.view', 'exports.run']}>
          <span>Export allowed</span>
        </PermissionGate>
        <PermissionGate permissions={['roles.view', 'users.view']} mode="any">
          <span>Access administration allowed</span>
        </PermissionGate>
        <PermissionGate permission="assets.create" fallback={<span>Add hidden</span>}>
          <span>Add allowed</span>
        </PermissionGate>
      </>,
      { queryClient },
    )

    expect(screen.queryByText('Export allowed')).not.toBeInTheDocument()
    expect(screen.getByText('Access administration allowed')).toBeInTheDocument()
    expect(screen.getByText('Add hidden')).toBeInTheDocument()
  })
})
