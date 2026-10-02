import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import { useAppSelector } from '@/app/store'
import { hasEveryPermission, hasPermission, useCurrentSessionQuery } from '@/features/auth'
// Cross-feature import through export-profiles' public barrel only — see
// that feature's index.ts. Never reach into '@/features/export-profiles/...'.
import { ExportModal, type ExportScope } from '@/features/export-profiles'
import { useDeleteAssetMutation, useRestoreAssetMutation } from '../api/assets.api'
import { useAssetPage } from '../hooks/useAssetPage'
import { useListUrlSync } from '../hooks/useListUrlSync'
import type { Asset } from '../types'
import { AssetFormModal } from '../components/AssetFormModal'
import { AssetTable } from '../components/AssetTable'
import { AssetToolbar } from '../components/AssetToolbar'

export function InventoryPage() {
  // Search, filters, sort and page live in the URL too (S-02: they survive a
  // reload). Wait for the URL to be applied so the first request uses it.
  const ready = useListUrlSync()
  return ready ? <InventoryView /> : null
}

function InventoryView() {
  const sort = useAppSelector((state) => state.assetsUi.sort)
  const { data: session } = useCurrentSessionQuery()
  const assetPage = useAssetPage()

  const canCreate = hasPermission(session, 'assets.create')
  const canUpdate = hasPermission(session, 'assets.update')
  const canArchive = hasPermission(session, 'assets.archive')
  const canRestore = hasPermission(session, 'assets.restore')
  const canExport = hasEveryPermission(session, ['assets.view', 'exports.run'])

  // The export re-runs the list's query without paging (ADR-0008), so it
  // gets exactly the filters and sort the shown rows were fetched with.
  const exportScope = useMemo<ExportScope>(
    () => ({ filters: assetPage.apiFilters, sort }),
    [assetPage.apiFilters, sort],
  )

  const deleteAsset = useDeleteAssetMutation()
  const restoreAsset = useRestoreAssetMutation()
  const toast = useToast()

  const [formAsset, setFormAsset] = useState<Asset | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  function handleAdd() {
    setFormAsset(null)
    setFormOpen(true)
  }

  function handleEdit(asset: Asset) {
    setFormAsset(asset)
    setFormOpen(true)
  }

  function handleDelete(asset: Asset) {
    if (!canArchive) return
    const onError = (error: Error) => toast.show(describeError(error))
    deleteAsset.mutate(asset.id, {
      onSuccess: () =>
        toast.show(
          `Archived ${asset.tag}.`,
          canRestore
            ? { undo: { onUndo: () => restoreAsset.mutate(asset.id, { onError }) } }
            : undefined,
        ),
      onError,
    })
  }

  return (
    <>
      {/* Actions live in the toolbar, next to search and filters — the
          Cloudflare-dashboard pattern — so the header is title only. */}
      <PageHeader
        title="Inventory"
        subtitle="Everything the company owns, where it lives, and what condition it's in."
      />

      <AssetToolbar
        onExport={() => setExportOpen(true)}
        onAdd={handleAdd}
        canExport={canExport}
        canCreate={canCreate}
      />

      <AssetTable
        pageItems={assetPage.items}
        total={assetPage.total}
        firstRow={assetPage.firstRow}
        page={assetPage.page}
        pageSize={assetPage.pageSize}
        pageCount={assetPage.pageCount}
        isLoading={assetPage.isLoading}
        isFetching={assetPage.isFetching}
        isError={assetPage.isError}
        onEdit={handleEdit}
        onDelete={handleDelete}
        canEdit={canUpdate}
        canArchive={canArchive}
      />

      {formOpen && (formAsset ? canUpdate : canCreate) && (
        <AssetFormModal open asset={formAsset} onClose={() => setFormOpen(false)} />
      )}
      {canExport && (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          scopeCount={assetPage.total}
          scope={exportScope}
        />
      )}
    </>
  )
}
