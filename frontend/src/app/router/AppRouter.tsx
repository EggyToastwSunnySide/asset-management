import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/app/layout'

const InventoryPage = lazy(() =>
  import('@/features/assets').then((m) => ({ default: m.InventoryPage })),
)
const ExportProfilesPage = lazy(() =>
  import('@/features/export-profiles').then((m) => ({ default: m.ExportProfilesPage })),
)
const AssetTypesPage = lazy(() =>
  import('@/features/asset-types').then((m) => ({ default: m.AssetTypesPage })),
)

export function AppRouter() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/export-profiles" element={<ExportProfilesPage />} />
          <Route path="/asset-types" element={<AssetTypesPage />} />
          <Route path="*" element={<Navigate to="/inventory" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
