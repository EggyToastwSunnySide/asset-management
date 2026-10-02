import { HttpResponse, http } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { authKeys } from '@/features/auth/api/auth.api'
import { sessionFixture } from '@/test/fixtures'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { ExportProfilesPage } from './ExportProfilesPage'

const profile = {
  id: 'profile-1',
  name: 'Standard export',
  dateFormat: 'YYYY-MM-DD',
  columns: [{ key: 'tag', label: 'Tag', included: true }],
}

describe('ExportProfilesPage permission gating', () => {
  it('hides create, edit and delete controls without those permissions', async () => {
    server.use(http.get('/api/export-profiles', () => HttpResponse.json([profile])))
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['exportProfiles.view']))

    renderWithProviders(<ExportProfilesPage />, { queryClient })

    expect(await screen.findByText('Standard export')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Standard export' })).not.toBeInTheDocument()
  })

  it('does not query private profiles without exportProfiles.view', async () => {
    let requested = false
    server.use(
      http.get('/api/export-profiles', () => {
        requested = true
        return HttpResponse.json([])
      }),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view']))

    renderWithProviders(<ExportProfilesPage />, { queryClient })

    expect(await screen.findByText('No saved profiles yet')).toBeInTheDocument()
    expect(requested).toBe(false)
  })
})
