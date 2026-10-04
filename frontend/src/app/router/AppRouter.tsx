import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/app/layout'
import {
  BootstrapLoading,
  ForbiddenPage,
  PublicOnlyRoute,
  RequireAuth,
  RequirePermission,
  SignInPage,
  firstPermittedRoute,
  useCurrentSessionQuery,
} from '@/features/auth'

const InventoryPage = lazy(() =>
  import('@/features/assets').then((module) => ({ default: module.InventoryPage })),
)
const ExportProfilesPage = lazy(() =>
  import('@/features/export-profiles').then((module) => ({ default: module.ExportProfilesPage })),
)
const AssetTypesPage = lazy(() =>
  import('@/features/asset-types').then((module) => ({ default: module.AssetTypesPage })),
)
const AssetTypeDetailPage = lazy(() =>
  import('@/features/asset-types').then((module) => ({ default: module.AssetTypeDetailPage })),
)
const AccessControlPage = lazy(() =>
  import('@/features/access-control').then((module) => ({ default: module.AccessControlPage })),
)

function FirstPermittedRoute() {
  const { data: session } = useCurrentSessionQuery()
  return <Navigate to={firstPermittedRoute(session)} replace />
}

export function AppRouter() {
  return (
    <Suspense fallback={<BootstrapLoading />}>
      <Routes>
        <Route
          path="/sign-in"
          element={
            <PublicOnlyRoute>
              <SignInPage />
            </PublicOnlyRoute>
          }
        />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<FirstPermittedRoute />} />
            <Route
              path="/inventory"
              element={
                <RequirePermission permission="assets.view">
                  <InventoryPage />
                </RequirePermission>
              }
            />
            <Route
              path="/export-profiles"
              element={
                <RequirePermission permission="exportProfiles.view">
                  <ExportProfilesPage />
                </RequirePermission>
              }
            />
            <Route
              path="/asset-types"
              element={
                <RequirePermission permission="assets.view">
                  <AssetTypesPage />
                </RequirePermission>
              }
            />
            <Route
              path="/asset-types/:code"
              element={
                <RequirePermission permission="assets.view">
                  <AssetTypeDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="/admin/access"
              element={
                <RequirePermission permissions={['roles.view', 'users.view']} mode="any">
                  <AccessControlPage />
                </RequirePermission>
              }
            />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            <Route path="*" element={<FirstPermittedRoute />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
