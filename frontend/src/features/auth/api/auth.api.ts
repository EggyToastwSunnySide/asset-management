import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ApiError,
  apiClient,
  captureAuthGeneration,
  setCsrfTokenForGeneration,
} from '@/lib/apiClient'
import type { AuthSession, SignInInput } from '../types'

async function fetchCurrentSession(): Promise<AuthSession | null> {
  const requestGeneration = captureAuthGeneration()
  try {
    const session = await apiClient.get<AuthSession>('/auth/session', undefined, {
      suppressUnauthorizedEvent: true,
    })
    if (!setCsrfTokenForGeneration(session.csrfToken, requestGeneration)) {
      throw new ApiError('Authentication state changed', 0, 'STALE_AUTH_GENERATION')
    }
    return session
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (!setCsrfTokenForGeneration(null, requestGeneration)) {
        throw new ApiError('Authentication state changed', 0, 'STALE_AUTH_GENERATION')
      }
      return null
    }
    throw error
  }
}

const signIn = (input: SignInInput) =>
  apiClient.post<AuthSession>('/auth/sign-in', input, { suppressUnauthorizedEvent: true })

const signOut = () =>
  apiClient.post<void>('/auth/sign-out', undefined, { suppressUnauthorizedEvent: true })

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
}

export function useCurrentSessionQuery() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: fetchCurrentSession,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false
      return failureCount < 1
    },
    refetchOnWindowFocus: true,
  })
}

export function useSignInMutation() {
  return useMutation({ mutationFn: signIn })
}

export function useSignOutMutation() {
  return useMutation({ mutationFn: signOut })
}
