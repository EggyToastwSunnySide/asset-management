import { combineReducers, createAction, type UnknownAction } from '@reduxjs/toolkit'
import { assetsUiReducer } from '@/features/assets/store'
import { exportProfilesUiReducer } from '@/features/export-profiles/store'
import { uiReducer } from './uiSlice'

/**
 * Every slice here is client/UI state only (filters, sort, open drawers,
 * row selection). Server data is owned by TanStack Query.
 */
const combinedReducer = combineReducers({
  ui: uiReducer,
  assetsUi: assetsUiReducer,
  exportProfilesUi: exportProfilesUiReducer,
})

export type RootState = ReturnType<typeof combinedReducer>

/** Clears identity-owned UI without discarding viewer sidebar preferences. */
export const identityReset = createAction('app/identityReset')

export function rootReducer(state: RootState | undefined, action: UnknownAction): RootState {
  if (identityReset.match(action)) {
    const freshState = combinedReducer(undefined, { type: '@@app/identity-reset' })
    return state ? { ...freshState, ui: state.ui } : freshState
  }
  return combinedReducer(state, action)
}
