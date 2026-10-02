import { configureStore } from '@reduxjs/toolkit'
import { rootReducer } from './rootReducer'
import { SIDEBAR_STORAGE_KEY } from './uiSlice'

export function createAppStore() {
  return configureStore({ reducer: rootReducer })
}

export const store = createAppStore()

export type AppStore = ReturnType<typeof createAppStore>
export type AppDispatch = AppStore['dispatch']

// Persist the one preference that intentionally crosses identities.
let lastSidebarCollapsed = store.getState().ui.sidebarCollapsed
store.subscribe(() => {
  const { sidebarCollapsed } = store.getState().ui
  if (sidebarCollapsed === lastSidebarCollapsed) return
  lastSidebarCollapsed = sidebarCollapsed
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0')
  } catch {
    // Storage unavailable; collapse state just won't persist.
  }
})
