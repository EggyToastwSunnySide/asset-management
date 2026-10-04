import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, EyeOff, Pencil, Plus, RotateCcw } from 'lucide-react'
import { Button, EmptyState, PageHeader, Table } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import { useReferenceDataQuery } from '@/features/assets'
import { hasPermission, useCurrentSessionQuery } from '@/features/auth'
import {
  useAttributesQuery,
  useHideAttributeMutation,
  useRestoreAttributeMutation,
} from '../api/attributes.api'
import { AttributeFormModal } from '../components/AttributeFormModal'
import { DATA_TYPE_LABELS, type Attribute } from '../types'
import styles from './AssetTypeDetailPage.module.css'

/** `null` = closed; `{ attribute: null }` = adding; otherwise editing that attribute. */
type FormState = { attribute: Attribute | null } | null

export function AssetTypeDetailPage() {
  const { code = '' } = useParams()
  const { data: session } = useCurrentSessionQuery()
  const canCreate = hasPermission(session, 'assets.create')
  const canUpdate = hasPermission(session, 'assets.update')

  const reference = useReferenceDataQuery()
  const attributes = useAttributesQuery(code)
  const hide = useHideAttributeMutation(code)
  const restore = useRestoreAttributeMutation(code)
  const toast = useToast()
  const [form, setForm] = useState<FormState>(null)

  const type = reference.data?.types.find((t) => t.code === code)
  const active = attributes.data?.filter((a) => a.isActive) ?? []
  const hidden = attributes.data?.filter((a) => !a.isActive) ?? []

  const onError = (error: Error) => toast.show(describeError(error))

  function handleHide(attribute: Attribute) {
    hide.mutate(attribute.key, {
      onSuccess: () =>
        toast.show(`Hid "${attribute.label}".`, {
          undo: { onUndo: () => restore.mutate(attribute.key, { onError }) },
        }),
      onError,
    })
  }

  function handleRestore(attribute: Attribute) {
    restore.mutate(attribute.key, {
      onSuccess: () => toast.show(`Restored "${attribute.label}".`),
      onError,
    })
  }

  let content
  // isPending, not isLoading — see AssetTypesPage.
  if (attributes.isPending || reference.isPending) {
    content = <EmptyState title="Loading attributes…" />
  } else if (attributes.isError) {
    content = (
      <EmptyState title="Couldn't load attributes" description={describeError(attributes.error)} />
    )
  } else if (!type) {
    content = (
      <EmptyState title="Asset type not found" description={`There is no type with code ${code}.`} />
    )
  } else {
    content = (
      <>
        {active.length === 0 ? (
          <EmptyState
            title="No custom attributes yet"
            description="Add an attribute to record extra details on every asset of this type."
          />
        ) : (
          <Table.Container>
            <Table.Root>
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell>Key</Table.HeaderCell>
                  <Table.HeaderCell>Label</Table.HeaderCell>
                  <Table.HeaderCell>Data type</Table.HeaderCell>
                  <Table.HeaderCell>Required</Table.HeaderCell>
                  {canUpdate && <Table.HeaderCell>Actions</Table.HeaderCell>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {active.map((attribute) => (
                  <Table.Row key={attribute.key}>
                    <Table.Cell className={styles.mono}>{attribute.key}</Table.Cell>
                    <Table.Cell>{attribute.label}</Table.Cell>
                    <Table.Cell>{DATA_TYPE_LABELS[attribute.dataType]}</Table.Cell>
                    <Table.Cell>{attribute.isRequired ? 'Required' : 'Optional'}</Table.Cell>
                    {canUpdate && (
                      <Table.Cell>
                        <div className={styles.actions}>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Edit ${attribute.label}`}
                            onClick={() => setForm({ attribute })}
                          >
                            <Pencil size={16} aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Hide ${attribute.label}`}
                            onClick={() => handleHide(attribute)}
                          >
                            <EyeOff size={16} aria-hidden="true" />
                            Hide
                          </Button>
                        </div>
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.Container>
        )}

        {hidden.length > 0 && (
          <section className={styles.section} aria-labelledby="hidden-attributes">
            <h2 id="hidden-attributes" className={styles.heading}>
              Hidden attributes
            </h2>
            <p className={styles.hint}>
              Hidden attributes are not asked for on assets and are never required. Their keys stay
              reserved. Restore one to use it again.
            </p>
            <Table.Container>
              <Table.Root>
                <Table.Head>
                  <Table.Row>
                    <Table.HeaderCell>Key</Table.HeaderCell>
                    <Table.HeaderCell>Label</Table.HeaderCell>
                    <Table.HeaderCell>Data type</Table.HeaderCell>
                    {canUpdate && <Table.HeaderCell>Actions</Table.HeaderCell>}
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {hidden.map((attribute) => (
                    <Table.Row key={attribute.key}>
                      <Table.Cell className={styles.mono}>{attribute.key}</Table.Cell>
                      <Table.Cell>{attribute.label}</Table.Cell>
                      <Table.Cell>{DATA_TYPE_LABELS[attribute.dataType]}</Table.Cell>
                      {canUpdate && (
                        <Table.Cell>
                          <div className={styles.actions}>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Restore ${attribute.label}`}
                              onClick={() => handleRestore(attribute)}
                            >
                              <RotateCcw size={16} aria-hidden="true" />
                              Restore
                            </Button>
                          </div>
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.Container>
          </section>
        )}
      </>
    )
  }

  return (
    <>
      <Link to="/asset-types" className={styles.back}>
        <ArrowLeft size={16} aria-hidden="true" />
        Asset types
      </Link>
      <PageHeader
        title={type?.name ?? code}
        subtitle={`Custom attributes for ${code} assets.`}
        actions={
          canCreate && type ? (
            <Button variant="primary" onClick={() => setForm({ attribute: null })}>
              <Plus size={18} aria-hidden="true" />
              Add attribute
            </Button>
          ) : undefined
        }
      />

      {content}

      {form && (
        <AttributeFormModal
          typeCode={code}
          attribute={form.attribute}
          onClose={() => setForm(null)}
        />
      )}
    </>
  )
}
