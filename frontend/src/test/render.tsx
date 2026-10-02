import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider as ReduxProvider } from 'react-redux'
import { MemoryRouter, type InitialEntry } from 'react-router-dom'
import { createAppStore, type AppStore } from '@/app/store'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthEventBoundary } from '@/features/auth'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

interface RenderOptions {
  route?: InitialEntry
  queryClient?: QueryClient
  store?: AppStore
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const store = options.store ?? createAppStore()
  const user = userEvent.setup()

  const result = render(
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[options.route ?? '/']}>
            <AuthEventBoundary>{ui}</AuthEventBoundary>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ReduxProvider>,
  )

  return { ...result, user, queryClient, store }
}
