import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCategories, getProduct, getProducts, CatalogApiError } from './catalogApi'

const product = {
  id: 'product-1',
  slug: 'ember-speaker',
  name: 'Ember Bluetooth Speaker',
  description: 'Compact speaker',
  images: [{ id: 'image-1', url: 'https://images.example.test/speaker.jpg', altText: 'A compact speaker', sortOrder: 0, isPrimary: true }],
  basePriceMinor: 849900,
  currency: 'INR',
  category: { name: 'Audio', slug: 'audio' },
  seller: { displayName: 'Good Sound Co.', slug: 'good-sound-co', status: 'VERIFIED' },
  specifications: [{ id: 'spec-1', name: 'Connectivity', value: 'Bluetooth', sortOrder: 0 }],
  variants: [{ id: 'variant-1', sku: 'SKU-1', name: 'Graphite', priceMinor: null, stockOnHand: 4 }],
  rating: 4.5,
  reviewCount: 2,
  stockOnHand: 4,
  available: true,
}

afterEach(() => vi.unstubAllGlobals())

describe('catalog API client', () => {
  it('sends search, category, budget, sort and pagination to the API', async () => {
    let requestedUrl: URL | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input))
      return new Response(JSON.stringify({
        items: [product],
        pagination: { page: 2, pageSize: 8, total: 9, pages: 2 },
      }), { status: 200 })
    }))

    const result = await getProducts({
      q: 'ember speaker',
      category: 'audio',
      seller: 'good-sound-co',
      minPriceMinor: 800000,
      maxPriceMinor: 900000,
      available: true,
      page: 2,
      pageSize: 8,
      sort: 'price-asc',
    })

    expect(requestedUrl?.pathname).toBe('/api/v1/products')
    expect(requestedUrl?.searchParams.get('q')).toBe('ember speaker')
    expect(requestedUrl?.searchParams.get('category')).toBe('audio')
    expect(requestedUrl?.searchParams.get('seller')).toBe('good-sound-co')
    expect(requestedUrl?.searchParams.get('minPriceMinor')).toBe('800000')
    expect(requestedUrl?.searchParams.get('maxPriceMinor')).toBe('900000')
    expect(requestedUrl?.searchParams.get('available')).toBe('true')
    expect(requestedUrl?.searchParams.get('page')).toBe('2')
    expect(requestedUrl?.searchParams.get('pageSize')).toBe('8')
    expect(requestedUrl?.searchParams.get('sort')).toBe('price-asc')
    expect(result.items[0].basePriceMinor).toBe(849900)
    expect(result.items[0].variants[0].stockOnHand).toBe(4)
    expect(result.items[0].images[0].isPrimary).toBe(true)
    expect(result.items[0].specifications[0].value).toBe('Bluetooth')
    expect(result.pagination.total).toBe(9)
  })

  it('loads categories and the current product detail by slug', async () => {
    let requestedPath = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedPath = new URL(String(input)).pathname
      return new Response(JSON.stringify(
        requestedPath.endsWith('/categories')
          ? { items: [{ name: 'Audio', slug: 'audio', productCount: 3 }] }
          : { item: product },
      ), { status: 200 })
    }))

    expect(await getCategories()).toEqual([{ name: 'Audio', slug: 'audio', productCount: 3 }])
    expect((await getProduct('ember-speaker')).name).toBe('Ember Bluetooth Speaker')
    expect(requestedPath).toBe('/api/v1/products/ember-speaker')
  })

  it('rejects malformed image, variant and specification data', async () => {
    const invalidProducts = [
      { ...product, images: [{ id: 'image-1', url: 'bad-image-url', altText: null, sortOrder: -1, isPrimary: 'yes' }] },
      { ...product, variants: [{ id: 'variant-1', sku: 'SKU-1', name: 'Graphite', priceMinor: -1, stockOnHand: 4 }] },
      { ...product, specifications: [{ id: 'spec-1', name: 'Material', value: 'Aluminium', sortOrder: -1 }] },
    ]

    for (const invalidProduct of invalidProducts) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        items: [invalidProduct],
        pagination: { page: 1, pageSize: 8, total: 1, pages: 1 },
      }), { status: 200 })))
      await expect(getProducts()).rejects.toMatchObject({ name: 'CatalogApiError' })
    }
  })

  it('surfaces service failures and invalid response shapes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Catalog unavailable' }), { status: 503 })))
    await expect(getProducts()).rejects.toMatchObject({ name: 'CatalogApiError', status: 503, message: 'Catalog unavailable' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [{}], pagination: { page: 1, pageSize: 8, total: 1, pages: 1 } }), { status: 200 })))
    await expect(getProducts()).rejects.toBeInstanceOf(CatalogApiError)
  })
})
