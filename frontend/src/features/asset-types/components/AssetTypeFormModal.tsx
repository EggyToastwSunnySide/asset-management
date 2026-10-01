import { useState, type FormEvent } from 'react'
import { Button, FormField, Modal, Input } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { ApiError, describeError } from '@/lib/apiClient'
import { useCreateAssetTypeMutation, type AssetTypeInput } from '../api/assetTypes.api'
import styles from './AssetTypeFormModal.module.css'

export interface AssetTypeFormModalProps {
  open: boolean
  onClose: () => void
}

type FieldErrors = Partial<Record<keyof AssetTypeInput, string>>

const EMPTY_FORM: AssetTypeInput = { code: '', name: '' }

// Same limits as the `asset_types` table (backend/db/init/001_schema.sql).
const NAME_MAX = 255
const CODE_MAX = 32
const CODE_PATTERN = /^[A-Z0-9_-]+$/

function validate({ code, name }: AssetTypeInput): FieldErrors {
  const errors: FieldErrors = {}
  if (!name) errors.name = 'Enter a name.'
  else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`

  if (!code) errors.code = 'Enter a code.'
  else if (code.length > CODE_MAX) errors.code = `Use at most ${CODE_MAX} characters.`
  else if (!CODE_PATTERN.test(code)) {
    errors.code = 'Use only letters A–Z, digits, hyphens and underscores.'
  }
  return errors
}

export function AssetTypeFormModal({ open, onClose }: AssetTypeFormModalProps) {
  const [form, setForm] = useState<AssetTypeInput>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')

  const createAssetType = useCreateAssetTypeMutation()
  const toast = useToast()

  // The Modal stays mounted while closed, so the form is cleared on the way
  // out; the next open then starts from a clean state.
  function handleClose() {
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setError('')
    createAssetType.reset()
    onClose()
  }

  function handleError(err: Error) {
    // `fields.code` / `fields.name` go under their input; any other field,
    // or an error with no fields at all (e.g. 404 until US17-T3), goes on top.
    const { code, name, ...otherFields } = err instanceof ApiError ? (err.fields ?? {}) : {}
    setFieldErrors({ code, name })

    const other = Object.entries(otherFields).map(([field, message]) => `${field}: ${message}`)
    if (!code && !name) setError(describeError(err))
    else if (other.length) setError(other.join('; '))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    const input = { code: form.code.trim(), name: form.name.trim() }
    const errors = validate(input)
    setFieldErrors(errors)
    if (errors.code || errors.name) return

    createAssetType.mutate(input, {
      onSuccess: () => {
        toast.show(`Created asset type "${input.name}".`)
        handleClose()
      },
      onError: handleError,
    })
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create asset type"
      description="Add a new category that assets can be filed under."
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="asset-type-form"
            disabled={createAssetType.isPending}
          >
            {createAssetType.isPending ? 'Saving…' : 'Create type'}
          </Button>
        </>
      }
    >
      {/* noValidate: the checks above show their message under the field,
          instead of the browser's bubble. */}
      <form id="asset-type-form" onSubmit={handleSubmit} className={styles.form} noValidate>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <FormField label="Name" htmlFor="at-name">
          <Input
            id="at-name"
            placeholder="e.g. Laptop"
            required
            maxLength={NAME_MAX}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? 'at-name-error' : undefined}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && (
            <span id="at-name-error" className={styles.fieldError}>
              {fieldErrors.name}
            </span>
          )}
        </FormField>

        <FormField
          label="Code"
          htmlFor="at-code"
          hint="Short unique key: letters A–Z, digits, hyphens and underscores."
        >
          <Input
            id="at-code"
            className={styles.mono}
            placeholder="e.g. LAPTOP"
            required
            maxLength={CODE_MAX}
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldErrors.code ? true : undefined}
            aria-describedby={fieldErrors.code ? 'at-code-error' : undefined}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
          {fieldErrors.code && (
            <span id="at-code-error" className={styles.fieldError}>
              {fieldErrors.code}
            </span>
          )}
        </FormField>
      </form>
    </Modal>
  )
}
