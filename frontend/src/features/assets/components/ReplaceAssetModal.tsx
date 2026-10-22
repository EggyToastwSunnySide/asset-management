import { useState, type FormEvent } from 'react'
import { Button, FormField, Input, Modal, Select } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/apiClient'
import { useAssetsQuery, useReplaceAssetMutation } from '../api/assets.api'
import type { Asset, ReplacementInput } from '../types'
import styles from './AssetFormModal.module.css'

export interface ReplaceAssetModalProps {
  /** The old asset, being replaced. */
  asset: Asset
  onClose: () => void
}

/**
 * US13-T3: pick the replacement asset and enter the date and reason. Only
 * AVAILABLE assets are offered, matching REPLACEMENT_RULES in
 * backend/api/dto/assets.dto.js; the server checks the rules again.
 */
export function ReplaceAssetModal({ asset, onClose }: ReplaceAssetModalProps) {
  const [form, setForm] = useState<ReplacementInput>({
    replacementAssetId: '',
    replacedOn: new Date().toLocaleDateString('en-CA'), // today as YYYY-MM-DD
    reason: '',
  })
  const [error, setError] = useState('')

  // shortcut: offers the first 500 available assets by tag; add a search box if the inventory outgrows it.
  const { data: candidates } = useAssetsQuery({
    page: 1,
    pageSize: 500,
    sort: 'tag',
    direction: 'asc',
    status: ['AVAILABLE'],
  })
  const replaceAsset = useReplaceAssetMutation()
  const toast = useToast()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    replaceAsset.mutate(
      { id: asset.id, input: form },
      {
        onSuccess: () => {
          const replacement = candidates?.items.find((a) => a.id === form.replacementAssetId)
          toast.show(`Recorded ${replacement?.tag ?? 'the replacement'} as replacing ${asset.tag}.`)
          onClose()
        },
        onError: (err) => setError(describeError(err)),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Replace asset"
      description={`Record the asset that replaces ${asset.tag}. ${asset.tag} will be marked Replaced.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="replace-form" disabled={replaceAsset.isPending}>
            {replaceAsset.isPending ? 'Saving…' : 'Record replacement'}
          </Button>
        </>
      }
    >
      <form id="replace-form" onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <FormField label="Replacement asset" htmlFor="r-replacement" hint="Only available assets can be used.">
          <Select
            id="r-replacement"
            required
            value={form.replacementAssetId}
            onChange={(e) => setForm({ ...form, replacementAssetId: e.target.value })}
          >
            <option value="" disabled>
              {candidates ? 'Select…' : 'Loading…'}
            </option>
            {candidates?.items
              .filter((a) => a.id !== asset.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tag} — {a.name}
                </option>
              ))}
          </Select>
        </FormField>

        <FormField label="Replacement date" htmlFor="r-date">
          <Input
            id="r-date"
            type="date"
            required
            value={form.replacedOn}
            onChange={(e) => setForm({ ...form, replacedOn: e.target.value })}
          />
        </FormField>

        <FormField label="Reason" htmlFor="r-reason">
          <Input
            id="r-reason"
            required
            maxLength={2000}
            placeholder="e.g. Screen broken beyond repair"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </FormField>
      </form>
    </Modal>
  )
}
