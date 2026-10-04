import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, EmptyState, PageHeader, Table } from '@/components/ui'
import { PermissionGate } from '@/features/auth'
import { useReferenceDataQuery } from '@/features/assets'
import { describeError } from '@/lib/apiClient'
import { AssetTypeFormModal } from '../components/AssetTypeFormModal'

export function AssetTypesPage() {
  const { data, isPending, isError, error } = useReferenceDataQuery()
  // Page-local: nothing else needs to know whether the form is open.
  const [formOpen, setFormOpen] = useState(false)
  const types = data?.types ?? []

  let content
  // isPending, not isLoading: a fetch paused while the tab is hidden or the
  // browser is offline is pending but not loading, and would otherwise fall
  // through to "No asset types yet".
  if (isPending) {
    content = <EmptyState title="Loading asset types…" />
  } else if (isError) {
    content = <EmptyState title="Couldn't load asset types" description={describeError(error)} />
  } else if (types.length === 0) {
    content = (
      <EmptyState
        title="No asset types yet"
        description="Create the first type to start filing assets under it."
      />
    )
  } else {
    content = (
      <Table.Container>
        <Table.Root>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Code</Table.HeaderCell>
              <Table.HeaderCell>Name</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {types.map((type) => (
              <Table.Row key={type.code}>
                <Table.Cell>
                  <Link to={`/asset-types/${encodeURIComponent(type.code)}`}>{type.code}</Link>
                </Table.Cell>
                <Table.Cell>{type.name}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.Container>
    )
  }

  return (
    <>
      <PageHeader
        title="Asset types"
        subtitle="The categories assets are filed under, as offered in the asset form's type selector."
        actions={
          <PermissionGate permission="assets.create">
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus size={18} aria-hidden="true" />
              Create asset type
            </Button>
          </PermissionGate>
        }
      />

      {content}

      <AssetTypeFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  )
}
