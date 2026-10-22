import { HttpResponse, http } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import type { Asset } from '../types'
import { ReplaceAssetModal } from './ReplaceAssetModal'

const base: Omit<Asset, 'id' | 'tag' | 'name'> = {
  type: 'LAPTOP',
  typeName: 'Laptop',
  status: 'AVAILABLE',
  statusName: 'Available',
  location: 'HQ',
  locationName: 'Head office',
  purchaseDate: '2024-01-15',
  notes: null,
}
const oldAsset: Asset = { ...base, id: 'old-id', tag: 'LAP-001', name: 'Old laptop' }
const newAsset: Asset = { ...base, id: 'new-id', tag: 'LAP-002', name: 'New laptop' }

function mockApi(reply: () => Response) {
  const posts: unknown[] = []
  const listQueries: URLSearchParams[] = []
  server.use(
    http.get('/api/assets', ({ request }) => {
      listQueries.push(new URL(request.url).searchParams)
      return HttpResponse.json({ items: [oldAsset, newAsset], total: 2, page: 1, pageSize: 500 })
    }),
    http.post('/api/assets/old-id/replacement', async ({ request }) => {
      posts.push(await request.json())
      return reply()
    }),
  )
  return { posts, listQueries }
}

describe('ReplaceAssetModal', () => {
  it('offers available assets other than the old one and posts the date and reason', async () => {
    const { posts, listQueries } = mockApi(() => HttpResponse.json({}, { status: 201 }))
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ReplaceAssetModal asset={oldAsset} onClose={onClose} />)

    const select = await screen.findByLabelText('Replacement asset')
    await screen.findByRole('option', { name: 'LAP-002 — New laptop' })
    expect(screen.queryByRole('option', { name: /LAP-001/ })).not.toBeInTheDocument()
    expect(listQueries[0].getAll('status')).toEqual(['AVAILABLE'])

    await user.selectOptions(select, 'new-id')
    await user.clear(screen.getByLabelText('Replacement date'))
    await user.type(screen.getByLabelText('Replacement date'), '2026-10-20')
    await user.type(screen.getByLabelText('Reason'), 'Screen broken')
    await user.click(screen.getByRole('button', { name: 'Record replacement' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts).toEqual([{ replacementAssetId: 'new-id', replacedOn: '2026-10-20', reason: 'Screen broken' }])
  })

  it('shows the server rejection and stays open', async () => {
    mockApi(() =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some fields are invalid',
            fields: { asset: 'LAP-001 cannot be replaced while its status is On loan' },
          },
        },
        { status: 422 },
      ),
    )
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ReplaceAssetModal asset={oldAsset} onClose={onClose} />)

    await screen.findByRole('option', { name: 'LAP-002 — New laptop' })
    await user.selectOptions(screen.getByLabelText('Replacement asset'), 'new-id')
    await user.type(screen.getByLabelText('Reason'), 'Upgrade')
    await user.click(screen.getByRole('button', { name: 'Record replacement' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be replaced')
    expect(onClose).not.toHaveBeenCalled()
  })
})
