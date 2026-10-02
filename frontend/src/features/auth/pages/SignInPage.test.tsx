import { HttpResponse, http } from 'msw'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import { sessionFixture } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

const unauthenticated = http.get('/api/auth/session', () =>
  HttpResponse.json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
    { status: 401 },
  ),
)

describe('SignInPage', () => {
  it('sends the password exactly as entered and permits paste semantics', async () => {
    let submittedPassword = ''
    server.use(
      unauthenticated,
      http.post('/api/auth/sign-in', async ({ request }) => {
        const body = (await request.json()) as { password: string }
        submittedPassword = body.password
        return HttpResponse.json(sessionFixture([]))
      }),
    )

    const { user } = renderWithProviders(<AppRouter />, {
      route: { pathname: '/sign-in', state: { from: '/forbidden' } },
    })

    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText('Email'), 'alex@example.com')
    const password = screen.getByLabelText('Password')
    fireEvent.change(password, { target: { value: '  exact password  ' } })
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(submittedPassword).toBe('  exact password  '))
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
  })

  it('uses a generic message for invalid credentials', async () => {
    server.use(
      unauthenticated,
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json(
          { error: { code: 'INVALID_CREDENTIALS', message: 'Email did not match' } },
          { status: 401 },
        ),
      ),
    )

    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText('Email'), 'wrong@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.')
    expect(screen.queryByText('Email did not match')).not.toBeInTheDocument()
  })

  it('distinguishes rate limiting from credential errors', async () => {
    server.use(
      unauthenticated,
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Slow down' } },
          { status: 429 },
        ),
      ),
    )

    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText('Email'), 'alex@example.com')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts')
  })
})
