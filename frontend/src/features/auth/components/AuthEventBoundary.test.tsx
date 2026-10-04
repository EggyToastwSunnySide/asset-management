import { HttpResponse, http } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Sidebar } from '@/app/layout/Sidebar'
import { setSidebarCollapsed } from '@/app/store'
import { setSearch } from '@/features/assets/store/assetsUiSlice'
import { openNewProfile } from '@/features/export-profiles/store/exportProfilesUiSlice'
import { sessionFixture } from '@/test/fixtures'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { authKeys } from '../api/auth.api'

describe('AuthEventBoundary', () => {
  it('clears cached and identity-owned state after confirmed sign-out', async () => {
    server.use(http.post('/api/auth/sign-out', () => new HttpResponse(null, { status: 204 })))

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view']))
    queryClient.setQueryData(['private-records'], [{ id: 'private-1' }])

    const { user, store } = renderWithProviders(
      <Routes>
        <Route path="/workspace" element={<Sidebar />} />
        <Route path="/sign-in" element={<h1>Signed out</h1>} />
      </Routes>,
      { route: '/workspace', queryClient },
    )

    store.dispatch(setSidebarCollapsed(true))
    store.dispatch(setSearch('private search'))
    store.dispatch(openNewProfile())

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Signed out' })).toBeInTheDocument()

    await waitFor(() => {
      expect(queryClient.getQueryData(['private-records'])).toBeUndefined()
      expect(store.getState().assetsUi.filters.search).toBe('')
      expect(store.getState().exportProfilesUi.editingProfileId).toBeNull()
    })
    expect(store.getState().ui.sidebarCollapsed).toBe(true)
    expect(queryClient.getQueryData(authKeys.session())).toBeNull()
  })

  it('keeps the active identity when the server cannot confirm sign-out', async () => {
    server.use(http.post('/api/auth/sign-out', () => HttpResponse.error()))

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view']))
    queryClient.setQueryData(['private-records'], [{ id: 'private-1' }])

    const { user, store } = renderWithProviders(
      <Routes>
        <Route path="/workspace" element={<Sidebar />} />
        <Route path="/sign-in" element={<h1>Signed out</h1>} />
      </Routes>,
      { route: '/workspace', queryClient },
    )
    store.dispatch(setSearch('keep identity state'))

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText(/Sign out could not be completed/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Signed out' })).not.toBeInTheDocument()
    expect(queryClient.getQueryData(['private-records'])).toEqual([{ id: 'private-1' }])
    expect(queryClient.getQueryData(authKeys.session())).toMatchObject({ user: { id: 'user-1' } })
    expect(store.getState().assetsUi.filters.search).toBe('keep identity state')
  })

  it('clears local identity when sign-out reports an already invalid session', async () => {
    server.use(
      http.post('/api/auth/sign-out', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Session ended' } },
          { status: 401 },
        ),
      ),
    )

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view']))
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/workspace" element={<Sidebar />} />
        <Route path="/sign-in" element={<h1>Signed out</h1>} />
      </Routes>,
      { route: '/workspace', queryClient },
    )

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Signed out' })).toBeInTheDocument()
    expect(queryClient.getQueryData(authKeys.session())).toBeNull()
  })

  it('clears identity state once for an unexpected 401 but not a 403', async () => {
    server.use(
      http.get('/api/protected-403', () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Denied' } }, { status: 403 }),
      ),
      http.get('/api/protected-401', () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, { status: 401 }),
      ),
    )

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), sessionFixture(['assets.view']))
    const { store } = renderWithProviders(
      <Routes>
        <Route path="/workspace" element={<div>Workspace</div>} />
        <Route path="/sign-in" element={<h1>Session ended</h1>} />
      </Routes>,
      { route: '/workspace', queryClient },
    )
    store.dispatch(setSearch('keep until 401'))

    const { apiClient } = await import('@/lib/apiClient')
    await expect(apiClient.get('/protected-403')).rejects.toMatchObject({ status: 403 })
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(store.getState().assetsUi.filters.search).toBe('keep until 401')

    await expect(apiClient.get('/protected-401')).rejects.toMatchObject({ status: 401 })
    expect(await screen.findByRole('heading', { name: 'Session ended' })).toBeInTheDocument()
    expect(store.getState().assetsUi.filters.search).toBe('')
    expect(screen.getByText('Your session ended. Sign in again.')).toBeInTheDocument()
  })
})
