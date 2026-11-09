import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSellerProducts, SellerManagementApiError } from './sellerManagementApi'

afterEach(() => vi.unstubAllGlobals())

const product = {
  id: 'product-1',
  slug: 'woven-basket',
  name: 'Woven basket',
  description: 'A handwoven storage basket.',
  basePriceMinor: 259900,
  currency: 'INR',
  status: 'DRAFT',
  moderationStatus: 'PENDING_REVIEW',
  moderationNote: null,
  moderatedAt: null,
  category: { id: 'category-1', name: 'Home', slug: 'home' },
  images: [{ id: 'image-1', url: 'https://images.example.test/basket.jpg', altText: null, isPrimary: true }],
  specifications: [{ id: 'spec-1', name: 'Material', value: 'Jute' }],
  variants: [{
    id: 'variant-1',
    sku: 'BASKET-01',
    name: 'Standard',
    priceMinor: null,
    stockOnHand: 5,
    lowStockThreshold: 5,
    status: 'ACTIVE',
  }],
  variantCount: 1,
  stockOnHand: 5,
}

describe('seller management API', () => {
  it('sends authenticated paginated product requests and parses the response', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
      items: [product],
      pagination: { page: 2, pageSize: 10, total: 11, pages: 2 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await getSellerProducts('seller-access-token', { page: 2, pageSize: 10, q: 'woven' })

    expect(result.items[0].name).toBe('Woven basket')
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 11, pages: 2 })
    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('Expected the seller API to make a request.')
    const [url, request] = call
    expect(String(url)).toContain('page=2')
    expect(String(url)).toContain('q=woven')
    expect(request?.credentials).toBe('include')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer seller-access-token')
  })

  it('rejects malformed product responses rather than returning unchecked data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ ...product, variants: [{ id: 'variant-1', sku: 'BAD' }] }],
      pagination: { page: 1, pageSize: 10, total: 1, pages: 1 },
    }), { status: 200 })))

    await expect(getSellerProducts('seller-access-token')).rejects.toBeInstanceOf(SellerManagementApiError)
  })
})
