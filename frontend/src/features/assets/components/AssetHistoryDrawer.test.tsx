import { HttpResponse, http } from 'msw'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import type { Asset, AssetEvent } from '../types'
import { AssetHistoryDrawer } from './AssetHistoryDrawer'

const asset: Asset = {
  id: '11111111-1111-4111-8111-111111111111',
  tag: 'LAP-001',
  name: 'Dell Latitude',
  type: 'LAPTOP',
  typeName: 'Laptop',
  status: 'AVAILABLE',
  statusName: 'Available',
  location: 'HQ',
  locationName: 'Head office',
  purchaseDate: '2024-01-15',
  notes: null,
}

const events: AssetEvent[] = [
  {
    id: 'e1',
    type: 'created',
    occurredAt: '2026-10-01T08:00:00.000Z',
    actor: { id: 'u1', displayName: 'Kiet' },
    description: 'Asset LAP-001 created',
    details: {},
  },
  {
    id: 'e2',
    type: 'loaned',
    occurredAt: '2026-10-02T09:30:00.000Z',
    actor: null,
    description: 'Asset LAP-001 borrowed',
    details: {},
  },
]

describe('AssetHistoryDrawer', () => {
  it('lists each event in API order with action, actor and time', async () => {
    server.use(http.get(`/api/assets/${asset.id}/events`, () => HttpResponse.json({ items: events })))
    renderWithProviders(<AssetHistoryDrawer asset={asset} onClose={() => {}} />)

    const list = await screen.findByRole('list', { name: 'Activity history of LAP-001' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Created')
    expect(items[0]).toHaveTextContent('Kiet')
    expect(items[1]).toHaveTextContent('Borrowed')
    expect(items[1]).toHaveTextContent('Unknown user')
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T08:00:00.000Z')
  })

  it('says so when the history cannot be loaded, e.g. a 403', async () => {
    server.use(
      http.get(`/api/assets/${asset.id}/events`, () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'No' } }, { status: 403 }),
      ),
    )
    renderWithProviders(<AssetHistoryDrawer asset={asset} onClose={() => {}} />)
    expect(await screen.findByText("Couldn't load the history")).toBeInTheDocument()
  })
})
