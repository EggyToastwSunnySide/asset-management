import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, Card, FormField, Input } from '@/components/ui'
import { ApiError } from '@/lib/apiClient'
import { useSignInMutation } from '../api/auth.api'
import { useAuthActions } from '../components/AuthActionsContext'
import { safeInternalPath } from '../permissions'
import styles from './SignInPage.module.css'

function signInErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === 'INVALID_CREDENTIALS') {
      return 'The email or password is incorrect.'
    }
    if (error.status === 429 || error.code === 'RATE_LIMITED') {
      return 'Too many sign-in attempts. Wait a moment and try again.'
    }
    if (error.status === 0 || error.code === 'NETWORK_ERROR') {
      return "We couldn't reach the server. Check your connection and try again."
    }
  }
  return 'Sign-in failed. Try again.'
}

export function SignInPage() {
  const location = useLocation()
  const signIn = useSignInMutation()
  const { completeSignIn } = useAuthActions()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      // Password is intentionally passed byte-for-byte: do not trim, normalize,
      // or block paste. Only the email identifier is whitespace-normalized.
      const session = await signIn.mutateAsync({ email: email.trim(), password })
      const requestedPath = safeInternalPath(
        (location.state as { from?: unknown } | null)?.from,
      )
      await completeSignIn(session, requestedPath)
    } catch (submitError) {
      setError(signInErrorMessage(submitError))
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.brand} aria-label="AssetLedger">
        <span className={styles.mark} aria-hidden="true">A</span>
        <span>Asset<span className={styles.brandAccent}>Ledger</span></span>
      </div>

      <Card className={styles.card}>
        <div className={styles.heading}>
          <h1>Sign in</h1>
          <p>Use your company account to open the asset workspace.</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {error && (
            <div className={styles.formError} role="alert">
              {error}
            </div>
          )}

          <FormField label="Email" htmlFor="sign-in-email">
            <Input
              id="sign-in-email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <FormField label="Password" htmlFor="sign-in-password">
            <Input
              id="sign-in-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>

          <Button
            className={styles.submit}
            variant="primary"
            type="submit"
            disabled={signIn.isPending || !email || !password}
          >
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
