import { createContext, useContext } from 'react'
import type { AuthSession } from '../types'

export interface AuthActions {
  completeSignIn: (session: AuthSession, requestedPath?: string | null) => Promise<void>
  signOut: () => Promise<void>
  isSigningOut: boolean
}

export const AuthActionsContext = createContext<AuthActions | null>(null)

export function useAuthActions() {
  const value = useContext(AuthActionsContext)
  if (!value) throw new Error('useAuthActions must be used within AuthEventBoundary')
  return value
}
