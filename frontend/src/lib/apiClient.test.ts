import { HttpResponse, delay, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import {
  apiClient,
  captureAuthGeneration,
  clearAuthTransportState,
  establishAuthGeneration,
  setCsrfTokenForGeneration,
  subscribeToAuthEvents,
} from './apiClient'

afterEach(() => clearAuthTransportState())

describe('apiClient authentication transport', () => {
  it('emits one deduplicated event for unexpected 401 responses, but never for 403', async () => {
    server.use(
      http.get('/api/private-a', () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, { status: 401 }),
      ),
      http.get('/api/private-b', () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, { status: 401 }),
      ),
      http.get('/api/forbidden-test', () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'No access' } }, { status: 403 }),
      ),
    )
    const listener = vi.fn()
    const unsubscribe = subscribeToAuthEvents(listener)

    await Promise.allSettled([
      apiClient.get('/private-a'),
      apiClient.get('/private-b'),
      apiClient.get('/forbidden-test'),
    ])

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('suppresses an expected session 401', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'No session' } },
          { status: 401 },
        ),
      ),
    )
    const listener = vi.fn()
    const unsubscribe = subscribeToAuthEvents(listener)

    await expect(
      apiClient.get('/auth/session', undefined, { suppressUnauthorizedEvent: true }),
    ).rejects.toMatchObject({ status: 401 })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('surfaces CSRF_FAILED as a normal 403 without ending the session', async () => {
    server.use(
      http.put('/api/roles/role-9', () =>
        HttpResponse.json(
          { error: { code: 'CSRF_FAILED', message: 'CSRF validation failed' } },
          { status: 403 },
        ),
      ),
    )
    establishAuthGeneration('csrf-test')
    const listener = vi.fn()
    const unsubscribe = subscribeToAuthEvents(listener)

    await expect(apiClient.put('/roles/role-9', { name: 'Nope' })).rejects.toMatchObject({
      status: 403,
      code: 'CSRF_FAILED',
    })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('adds the in-memory CSRF token to unsafe requests', async () => {
    let csrfHeader: string | null = null
    server.use(
      http.put('/api/roles/role-1', ({ request }) => {
        csrfHeader = request.headers.get('X-CSRF-Token')
        return HttpResponse.json({ ok: true })
      }),
    )
    establishAuthGeneration('csrf-new')

    await apiClient.put('/roles/role-1', { name: 'Managers' })
    expect(csrfHeader).toBe('csrf-new')
  })

  it('does not let an old session response replace the new generation CSRF token', async () => {
    let csrfHeader: string | null = null
    server.use(
      http.post('/api/current-generation', ({ request }) => {
        csrfHeader = request.headers.get('X-CSRF-Token')
        return HttpResponse.json({ ok: true })
      }),
    )

    const oldGeneration = captureAuthGeneration()
    establishAuthGeneration('csrf-new-generation')
    expect(setCsrfTokenForGeneration('csrf-stale-session', oldGeneration)).toBe(false)

    await apiClient.post('/current-generation', {})
    expect(csrfHeader).toBe('csrf-new-generation')
  })

  it('ignores a late 401 from an older auth generation', async () => {
    server.use(
      http.get('/api/slow-old-request', async () => {
        await delay(40)
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Old session expired' } },
          { status: 401 },
        )
      }),
    )
    establishAuthGeneration('csrf-old')
    const listener = vi.fn()
    const unsubscribe = subscribeToAuthEvents(listener)

    const oldRequest = apiClient.get('/slow-old-request')
    establishAuthGeneration('csrf-new')
    await expect(oldRequest).rejects.toMatchObject({ status: 401 })

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
