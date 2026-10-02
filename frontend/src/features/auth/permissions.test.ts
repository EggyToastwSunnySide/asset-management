import { describe, expect, it } from 'vitest'
import { sessionFixture } from '@/test/fixtures'
import { firstPermittedRoute, safeInternalPath } from './permissions'

describe('firstPermittedRoute', () => {
  it('picks the first reachable destination in capability order', () => {
    expect(firstPermittedRoute(sessionFixture(['users.view', 'assets.view']))).toBe('/inventory')
    expect(firstPermittedRoute(sessionFixture(['exportProfiles.view', 'roles.view']))).toBe(
      '/export-profiles',
    )
    expect(firstPermittedRoute(sessionFixture(['users.view']))).toBe('/admin/access')
    expect(firstPermittedRoute(sessionFixture([]))).toBe('/forbidden')
    expect(firstPermittedRoute(null)).toBe('/forbidden')
  })
})

describe('safeInternalPath', () => {
  it('keeps an app-local path with query and hash', () => {
    expect(safeInternalPath('/inventory?search=laptop#row-2')).toBe(
      '/inventory?search=laptop#row-2',
    )
  })

  it('rejects external, protocol-relative and relative destinations', () => {
    expect(safeInternalPath('https://evil.example/inventory')).toBeNull()
    expect(safeInternalPath('//evil.example/inventory')).toBeNull()
    expect(safeInternalPath('inventory')).toBeNull()
    expect(safeInternalPath('/\\evil.example')).toBeNull()
    expect(safeInternalPath(undefined)).toBeNull()
    expect(safeInternalPath(42)).toBeNull()
  })
})
