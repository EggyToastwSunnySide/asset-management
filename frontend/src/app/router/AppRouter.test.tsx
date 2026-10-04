import { HttpResponse, delay, http } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { sessionFixture } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { AppRouter } from './AppRouter'

const unauthenticated = http.get('/api/auth/session', () =>
  HttpResponse.json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
    { status: 401 },
  ),
)

const profile = {
  id: 'profile-1',
  name: 'Standard export',
  dateFormat: 'YYYY-MM-DD',
  columns: [{ key: 'tag', label: 'Tag', included: true }],
}

describe('AppRouter authentication and authorization', () => {
  it('shows bootstrap progress, then redirects an unauthenticated protected route', async () => {
    server.use(
      http.get('/api/auth/session', async () => {
        await delay(40)
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
          { status: 401 },
        )
      }),
    )

    renderWithProviders(<AppRouter />, { route: '/inventory?search=laptop' })
    expect(screen.getByRole('status')).toHaveTextContent('Loading your workspace')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('keeps a bootstrap network failure distinct from unauthenticated state', async () => {
    server.use(http.get('/api/auth/session', () => HttpResponse.error()))

    renderWithProviders(<AppRouter />, { route: '/inventory' })
    expect(await screen.findByRole('heading', { name: "Couldn't reach the server" }, { timeout: 3000 }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('sends an authenticated user without the route permission to forbidden', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFixture(['exportProfiles.view'])),
      ),
    )

    renderWithProviders(<AppRouter />, { route: '/inventory' })
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
  })

  it('uses the first permitted destination for unknown routes', async () => {
    server.use(http.get('/api/auth/session', () => HttpResponse.json(sessionFixture([]))))

    renderWithProviders(<AppRouter />, { route: '/not-a-real-route' })
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
  })

  it('restores a valid session after refresh without another sign-in', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFixture(['exportProfiles.view'])),
      ),
      http.get('/api/export-profiles', () => HttpResponse.json([profile])),
    )

    renderWithProviders(<AppRouter />, { route: '/export-profiles' })
    expect(await screen.findByRole('heading', { name: 'Export profiles' })).toBeInTheDocument()
    expect(await screen.findByText('Standard export')).toBeInTheDocument()
  })

  it('redirects an authenticated user away from the public sign-in route', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFixture(['exportProfiles.view'])),
      ),
      http.get('/api/export-profiles', () => HttpResponse.json([])),
    )

    renderWithProviders(<AppRouter />, { route: '/sign-in' })
    expect(await screen.findByRole('heading', { name: 'Export profiles' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('returns the user to the requested internal destination after sign-in', async () => {
    server.use(
      unauthenticated,
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json(sessionFixture(['assets.view', 'exportProfiles.view'])),
      ),
      http.get('/api/export-profiles', () => HttpResponse.json([])),
    )

    const { user } = renderWithProviders(<AppRouter />, { route: '/export-profiles' })
    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText('Email'), 'alex@example.com')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Export profiles' })).toBeInTheDocument()
  })

  it('protects asset types with assets.view and hides creation without assets.create', async () => {
    server.use(
      http.get('/api/auth/session', () => HttpResponse.json(sessionFixture(['assets.view']))),
      http.get('/api/reference-data', () =>
        HttpResponse.json({ types: [], statuses: [], locations: [] }),
      ),
    )

    renderWithProviders(<AppRouter />, { route: '/asset-types' })
    expect(await screen.findByRole('heading', { name: 'Asset types' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create asset type' })).not.toBeInTheDocument()
  })

  it('gates the access-control route behind roles.view or users.view', async () => {
    server.use(
      http.get('/api/auth/session', () => HttpResponse.json(sessionFixture(['roles.view']))),
      http.get('/api/roles', () => HttpResponse.json([])),
      http.get('/api/permissions', () => HttpResponse.json([])),
    )

    renderWithProviders(<AppRouter />, { route: '/admin/access' })
    expect(await screen.findByRole('heading', { name: 'Access control' })).toBeInTheDocument()
  })
})
