import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, identityReset } from '@/app/store'
import { useToast } from '@/components/ui/Toast'
import {
  clearAuthTransportState,
  establishAuthGeneration,
  subscribeToAuthEvents,
  ApiError,
} from '@/lib/apiClient'
import { authKeys, useCurrentSessionQuery, useSignOutMutation } from '../api/auth.api'
import { firstPermittedRoute, safeInternalPath } from '../permissions'
import type { AuthSession } from '../types'
import { AuthActionsContext } from './AuthActionsContext'

function currentInternalPath(pathname: string, search: string, hash: string) {
  return safeInternalPath(`${pathname}${search}${hash}`)
}

export function AuthEventBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const signOutMutation = useSignOutMutation()
  const sessionQuery = useCurrentSessionQuery()

  const handlingRef = useRef(false)
  const authenticatedUserIdRef = useRef<string | null>(null)
  const locationRef = useRef(location)

  useEffect(() => {
    locationRef.current = location
  }, [location])

  const clearIdentity = useCallback(
    async ({ message, preservePath = true }: { message?: string; preservePath?: boolean } = {}) => {
      if (handlingRef.current) return
      handlingRef.current = true
      authenticatedUserIdRef.current = null
      clearAuthTransportState()

      await queryClient.cancelQueries()
      queryClient.clear()
      queryClient.setQueryData(authKeys.session(), null)
      dispatch(identityReset())

      const current = locationRef.current
      const requestedPath =
        preservePath && current.pathname !== '/sign-in'
          ? currentInternalPath(current.pathname, current.search, current.hash)
          : null

      navigate('/sign-in', {
        replace: true,
        state: requestedPath ? { from: requestedPath } : undefined,
      })
      if (message) toast.show(message)
      handlingRef.current = false
    },
    [dispatch, navigate, queryClient, toast],
  )

  const completeSignIn = useCallback(
    async (session: AuthSession, requestedPath?: string | null) => {
      handlingRef.current = true
      await queryClient.cancelQueries()
      queryClient.clear()
      dispatch(identityReset())

      establishAuthGeneration(session.csrfToken)
      authenticatedUserIdRef.current = session.user.id
      queryClient.setQueryData(authKeys.session(), session)

      const destination = safeInternalPath(requestedPath) ?? firstPermittedRoute(session)
      navigate(destination, { replace: true })
      handlingRef.current = false
    },
    [dispatch, navigate, queryClient],
  )

  const signOut = useCallback(async () => {
    try {
      await signOutMutation.mutateAsync()
      await clearIdentity({ preservePath: false })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearIdentity({ preservePath: false })
        return
      }
      toast.show('Sign out could not be completed. You are still signed in. Try again.')
    }
  }, [clearIdentity, signOutMutation, toast])

  useEffect(() => {
    return subscribeToAuthEvents(() => {
      void clearIdentity({ message: 'Your session ended. Sign in again.' })
    })
  }, [clearIdentity])

  useEffect(() => {
    if (sessionQuery.data === undefined) return

    const nextUserId = sessionQuery.data?.user.id ?? null
    const previousUserId = authenticatedUserIdRef.current

    if (previousUserId && !nextUserId) {
      void clearIdentity({ message: 'Your session ended. Sign in again.' })
      return
    }
    if (previousUserId && nextUserId && previousUserId !== nextUserId) {
      void clearIdentity({ message: 'Your signed-in identity changed. Sign in again.' })
      return
    }
    authenticatedUserIdRef.current = nextUserId
  }, [clearIdentity, sessionQuery.data])

  return (
    <AuthActionsContext.Provider
      value={{
        completeSignIn,
        signOut,
        isSigningOut: signOutMutation.isPending,
      }}
    >
      {children}
    </AuthActionsContext.Provider>
  )
}
