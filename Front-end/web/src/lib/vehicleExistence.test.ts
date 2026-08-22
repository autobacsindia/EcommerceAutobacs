/**
 * The fail-open decision is the whole point of these helpers, and it is the kind
 * of behaviour that gets "tidied up" into fail-closed by someone reading the
 * function in isolation. A 404 de-indexes a URL; a transient backend outage must
 * not do that to the entire vehicle section. Only a definitive negative from the
 * API is allowed to 404.
 */

import { makeExists, vehicleExists } from './vehicleExistence'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

beforeEach(() => {
  mockFetch.mockReset()
  // React cache() memoises per request; in Jest there is no request scope, so
  // each assertion below uses a distinct make/model to avoid a cached answer
  // leaking across tests.
})

describe('makeExists', () => {
  it('matches case-insensitively', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true, makes: ['Toyota', 'Audi'] }))
    await expect(makeExists('toyota')).resolves.toBe(true)
  })

  it('rejects a make that is not in the list', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true, makes: ['Toyota', 'Audi'] }))
    await expect(makeExists('delorean')).resolves.toBe(false)
  })

  it('rejects an empty make without calling the API', async () => {
    await expect(makeExists('   ')).resolves.toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails OPEN when the backend errors', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, {}))
    await expect(makeExists('unreachable-make')).resolves.toBe(true)
  })

  it('fails OPEN when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(makeExists('network-down-make')).resolves.toBe(true)
  })
})

describe('vehicleExists', () => {
  it('accepts a make/model pair the backend resolves', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true, vehicle: { _id: '1' } }))
    await expect(vehicleExists('Audi', 'Q7')).resolves.toBe(true)
  })

  it('rejects on a definitive 404 — the only case allowed to 404 a page', async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { success: false }))
    await expect(vehicleExists('Audi', 'NotAModel')).resolves.toBe(false)
  })

  it('fails OPEN on a 5xx', async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, {}))
    await expect(vehicleExists('Audi', 'ServiceDown')).resolves.toBe(true)
  })

  it('fails OPEN when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(vehicleExists('Audi', 'NetworkDown')).resolves.toBe(true)
  })

  it('rejects an empty model without calling the API', async () => {
    await expect(vehicleExists('Audi', '')).resolves.toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
