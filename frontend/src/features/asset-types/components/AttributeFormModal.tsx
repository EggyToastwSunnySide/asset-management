import { useState, type FormEvent } from 'react'
import { Button, Checkbox, FormField, Input, Modal, Select } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { ApiError, describeError } from '@/lib/apiClient'
import { cn } from '@/utils/cn'
import {
  useCreateAttributeMutation,
  useUpdateAttributeMutation,
} from '../api/attributes.api'
import {
  ATTRIBUTE_DATA_TYPES,
  DATA_TYPE_LABELS,
  type Attribute,
  type AttributeDataType,
  type AttributeInput,
} from '../types'
import styles from './AttributeFormModal.module.css'

export interface AttributeFormModalProps {
  /** Code of the asset type the attribute belongs to. */
  typeCode: string
  /** The attribute being edited, or `null` to add a new one. */
  attribute: Attribute | null
  onClose: () => void
}

type FieldErrors = Partial<Record<keyof AttributeInput, string>>

// Same limits as the `asset_type_attributes` table (backend/db/init/001_schema.sql).
const KEY_MAX = 32
const LABEL_MAX = 255
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

const DUPLICATE_KEY_MESSAGE =
  'This key is already used by an attribute of this type. It may be hidden — check "Hidden attributes" and restore it instead. Keys are never reused.'

function validate({ key, label }: AttributeInput): FieldErrors {
  const errors: FieldErrors = {}
  if (!key) errors.key = 'Enter a key.'
  else if (key.length > KEY_MAX) errors.key = `Use at most ${KEY_MAX} characters.`
  else if (!KEY_PATTERN.test(key)) {
    errors.key = 'Use lowercase letters, digits and _ only, starting with a letter.'
  }

  if (!label) errors.label = 'Enter a label.'
  else if (label.length > LABEL_MAX) errors.label = `Use at most ${LABEL_MAX} characters.`
  return errors
}

/**
 * Add or edit a custom attribute. Mounted only while open (the parent renders
 * it conditionally), so the form always starts from `attribute`'s values.
 */
export function AttributeFormModal({ typeCode, attribute, onClose }: AttributeFormModalProps) {
  const editing = attribute !== null
  const [form, setForm] = useState<AttributeInput>({
    key: attribute?.key ?? '',
    label: attribute?.label ?? '',
    dataType: attribute?.dataType ?? 'text',
    isRequired: attribute?.isRequired ?? false,
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')

  const create = useCreateAttributeMutation(typeCode)
  const update = useUpdateAttributeMutation(typeCode)
  const mutation = editing ? update : create
  const toast = useToast()

  function handleError(err: Error) {
    const fields = err instanceof ApiError ? (err.fields ?? {}) : {}
    const next: FieldErrors = {
      key: fields.key,
      label: fields.label,
      dataType: fields.dataType,
      isRequired: fields.isRequired,
    }
    if (err instanceof ApiError && err.code === 'DUPLICATE_KEY') next.key = DUPLICATE_KEY_MESSAGE
    // DATA_TYPE_LOCKED belongs under the data type, even if the server sent no field.
    if (err instanceof ApiError && err.code === 'DATA_TYPE_LOCKED') {
      next.dataType = next.dataType ?? err.message
    }
    setFieldErrors(next)

    const shown = Object.values(next).some(Boolean)
    if (!shown) setError(describeError(err))
    else setError('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    const input: AttributeInput = { ...form, key: form.key.trim(), label: form.label.trim() }
    const errors = validate(input)
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    mutation.mutate(input, {
      onSuccess: () => {
        toast.show(`${editing ? 'Saved' : 'Added'} attribute "${input.label}".`)
        onClose()
      },
      onError: handleError,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit attribute' : 'Add attribute'}
      description={
        editing
          ? 'The key is fixed once created. Everything else can change.'
          : `A custom field for ${typeCode} assets.`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="attribute-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add attribute'}
          </Button>
        </>
      }
    >
      {/* noValidate: the checks above show their message under the field,
          instead of the browser's bubble. */}
      <form id="attribute-form" onSubmit={handleSubmit} className={styles.form} noValidate>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <FormField
          label="Key"
          htmlFor="attr-key"
          hint={
            editing
              ? "Keys can't be changed after creation"
              : 'Lowercase letters, digits and _, starting with a letter. Cannot be changed later.'
          }
          error={fieldErrors.key}
        >
          <Input
            id="attr-key"
            className={cn(styles.mono, editing && styles.readOnly)}
            aria-readonly={editing || undefined}
            placeholder="e.g. ram_gb"
            maxLength={KEY_MAX}
            spellCheck={false}
            autoCapitalize="none"
            readOnly={editing}
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
          />
        </FormField>

        <FormField label="Label" htmlFor="attr-label" error={fieldErrors.label}>
          <Input
            id="attr-label"
            placeholder="e.g. RAM (GB)"
            maxLength={LABEL_MAX}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </FormField>

        <FormField label="Data type" htmlFor="attr-data-type" error={fieldErrors.dataType}>
          <Select
            id="attr-data-type"
            value={form.dataType}
            onChange={(e) => setForm({ ...form, dataType: e.target.value as AttributeDataType })}
          >
            {ATTRIBUTE_DATA_TYPES.map((type) => (
              <option key={type} value={type}>
                {DATA_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </FormField>

        <label className={styles.required}>
          <Checkbox
            checked={form.isRequired}
            onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
          />
          Required when saving an asset
        </label>
      </form>
    </Modal>
  )
}
