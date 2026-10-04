import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authKeys } from '@/features/auth/api/auth.api'
import type { PermissionKey } from '@/features/auth'
import { sessionFixture } from '@/test/fixtures'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import type { Attribute } from '../types'
import { AssetTypeDetailPage } from './AssetTypeDetailPage'

const ALL: PermissionKey[] = ['assets.view', 'assets.create', 'assets.update']

const referenceData = {
  types: [{ code: 'LAPTOP', name: 'Laptop' }],
  statuses: [],
  locations: [],
}

const seed = (): Attribute[] => [
  { key: 'ram_gb', label: 'RAM (GB)', dataType: 'number', isRequired: true, isActive: true },
  { key: 'warranty', label: 'Warranty end', dataType: 'date', isRequired: false, isActive: true },
  { key: 'old_tag', label: 'Old tag', dataType: 'text', isRequired: false, isActive: false },
]

/** In-memory stand-in for the attribute endpoints; `posts` records create bodies. */
function mockApi(attributes: Attribute[] = seed()) {
  const posts: unknown[] = []
  const find = (key: unknown) => attributes.find((a) => a.key === key)
  server.use(
    http.get('/api/reference-data', () => HttpResponse.json(referenceData)),
    http.get('/api/asset-types/LAPTOP/attributes', () => HttpResponse.json(attributes)),
    http.post('/api/asset-types/LAPTOP/attributes', async ({ request }) => {
      const body = (await request.json()) as Attribute
      posts.push(body)
      if (find(body.key)) {
        return HttpResponse.json(
          { error: { code: 'DUPLICATE_KEY', message: 'Duplicate key', fields: { key: 'Taken' } } },
          { status: 409 },
        )
      }
      attributes.push({ ...body, isActive: true })
      return HttpResponse.json({ ...body, isActive: true }, { status: 201 })
    }),
    http.delete('/api/asset-types/LAPTOP/attributes/:key', ({ params }) => {
      const attribute = find(params.key)
      if (attribute) attribute.isActive = false
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/asset-types/LAPTOP/attributes/:key/restore', ({ params }) => {
      const attribute = find(params.key)!
      attribute.isActive = true
      return HttpResponse.json(attribute)
    }),
  )
  return { posts }
}

function renderPage(permissions: PermissionKey[] = ALL) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(authKeys.session(), sessionFixture(permissions))
  return renderWithProviders(
    <Routes>
      <Route path="/asset-types/:code" element={<AssetTypeDetailPage />} />
    </Routes>,
    { route: '/asset-types/LAPTOP', queryClient },
  )
}

describe('AssetTypeDetailPage', () => {
  it('lists active attributes with key, label, data type and required, and hidden ones apart', async () => {
    mockApi()
    renderPage()

    const row = (await screen.findByText('ram_gb')).closest('tr')!
    expect(within(row).getByText('RAM (GB)')).toBeInTheDocument()
    expect(within(row).getByText('Number')).toBeInTheDocument()
    expect(within(row).getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('warranty').closest('tr')).toHaveTextContent('Optional')

    const hidden = screen.getByRole('region', { name: 'Hidden attributes' })
    expect(within(hidden).getByText('old_tag')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add attribute' })).toBeInTheDocument()
  })

  it('hides add, edit, hide and restore controls without assets.create / assets.update', async () => {
    mockApi()
    renderPage(['assets.view'])

    expect(await screen.findByText('ram_gb')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add attribute' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Hide / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore / })).not.toBeInTheDocument()
  })

  it('validates the add form on the client and lowercases the key as you type', async () => {
    const { posts } = mockApi()
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add attribute' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Add attribute' }))
    expect(within(dialog).getByText('Enter a key.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a label.')).toBeInTheDocument()

    const key = within(dialog).getByLabelText('Key')
    await user.type(key, 'RAM Size')
    expect(key).toHaveValue('ram size')
    await user.type(within(dialog).getByLabelText('Label'), 'RAM')
    await user.click(within(dialog).getByRole('button', { name: 'Add attribute' }))
    expect(
      within(dialog).getByText('Use lowercase letters, digits and _ only, starting with a letter.'),
    ).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('adds an attribute and shows it in the list', async () => {
    const { posts } = mockApi()
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add attribute' }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Key'), 'screen_in')
    await user.type(within(dialog).getByLabelText('Label'), 'Screen (in)')
    await user.selectOptions(within(dialog).getByLabelText('Data type'), 'number')
    await user.click(within(dialog).getByRole('button', { name: 'Add attribute' }))

    expect(await screen.findByText('screen_in')).toBeInTheDocument()
    expect(posts).toEqual([
      { key: 'screen_in', label: 'Screen (in)', dataType: 'number', isRequired: false },
    ])
  })

  it('explains a DUPLICATE_KEY as possibly belonging to a hidden attribute', async () => {
    mockApi()
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add attribute' }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Key'), 'old_tag')
    await user.type(within(dialog).getByLabelText('Label'), 'Another')
    await user.click(within(dialog).getByRole('button', { name: 'Add attribute' }))

    expect(await within(dialog).findByText(/may be hidden/)).toBeInTheDocument()
  })

  it('hides an attribute into the hidden section, then restores it', async () => {
    mockApi()
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Hide Warranty end' }))
    // Gone from the active table, now under "Hidden attributes"; the toast offers Undo.
    const hidden = await screen.findByRole('region', { name: 'Hidden attributes' })
    expect(await within(hidden).findByText('warranty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    await user.click(within(hidden).getByRole('button', { name: 'Restore Warranty end' }))
    await waitFor(() => expect(within(hidden).queryByText('warranty')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Hide Warranty end' })).toBeInTheDocument()
  })

  it('undoes a hide from the toast', async () => {
    mockApi()
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Hide Warranty end' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Hide Warranty end' })).toBeInTheDocument()
  })

  it('marks the key read-only when editing, and editable when adding', async () => {
    mockApi()
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit RAM (GB)' }))
    let dialog = await screen.findByRole('dialog')

    const key = within(dialog).getByLabelText('Key')
    expect(key).toHaveValue('ram_gb')
    expect(key).toHaveAttribute('readonly')
    expect(key).toHaveAttribute('aria-readonly', 'true')
    expect(key).toHaveAccessibleDescription("Keys can't be changed after creation")
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Add attribute' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Key')).not.toHaveAttribute('readonly')
    expect(within(dialog).getByLabelText('Key')).not.toHaveAttribute('aria-readonly')
  })

  it('shows DATA_TYPE_LOCKED under the data type field when editing', async () => {
    mockApi()
    server.use(
      http.put('/api/asset-types/LAPTOP/attributes/ram_gb', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DATA_TYPE_LOCKED',
              message: '2 assets hold a value',
              fields: { dataType: '2 assets hold a value for this attribute' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit RAM (GB)' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByLabelText('Key')).toHaveAttribute('readonly')
    await user.selectOptions(within(dialog).getByLabelText('Data type'), 'text')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByText(/2 assets hold a value/)).toBeInTheDocument()
  })
})
