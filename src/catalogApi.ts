export type CatalogVariant = {
  id: string
  sku: string
  name: string
  priceMinor: number | null
  stockOnHand: number
}

export type CatalogProductImage = {
  id: string
  url: string
  altText: string | null
  sortOrder: number
  isPrimary: boolean
}

export type CatalogSpecification = {
  id: string
  name: string
  value: string
  sortOrder: number
}

export type CatalogProduct = {
  id: string
  slug: string
  name: string
  description: string
  images: CatalogProductImage[]
  basePriceMinor: number
  currency: string
  category: { name: string; slug: string }
  seller: { displayName: string; slug: string; status: string }
  specifications: CatalogSpecification[]
  variants: CatalogVariant[]
  rating: number | null
  reviewCount: number
  stockOnHand: number
  available: boolean
}

export type CatalogCategory = {
  name: string
  slug: string
  productCount: number
}

export type CatalogPage = {
  items: CatalogProduct[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
}

export type CatalogQuery = {
  q?: string
  category?: string
  seller?: string
  minPriceMinor?: number
  maxPriceMinor?: number
  available?: boolean
  page?: number
  pageSize?: number
  sort?: 'newest' | 'price-asc' | 'price-desc' | 'rating'
}

export class CatalogApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'CatalogApiError'
    this.status = status
  }
}

export const API_BASE_URL = import.meta.env.DEV
  ? ''
  : import.meta.env.VITE_API_BASE_URL
    ?? (typeof window === 'undefined'
      ? 'http://localhost:4000'
      : `${window.location.protocol}//${window.location.hostname}:4000`)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function parseProduct(value: unknown): CatalogProduct {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.slug !== 'string'
    || typeof value.name !== 'string'
    || typeof value.description !== 'string'
    || !Array.isArray(value.images)
    || !isNonNegativeInteger(value.basePriceMinor)
    || typeof value.currency !== 'string'
    || !isRecord(value.category)
    || typeof value.category.name !== 'string'
    || typeof value.category.slug !== 'string'
    || !isRecord(value.seller)
    || typeof value.seller.displayName !== 'string'
    || typeof value.seller.slug !== 'string'
    || typeof value.seller.status !== 'string'
    || !Array.isArray(value.specifications)
    || !Array.isArray(value.variants)
    || !(typeof value.rating === 'number' || value.rating === null)
    || !isNonNegativeInteger(value.reviewCount)
    || !isNonNegativeInteger(value.stockOnHand)
    || typeof value.available !== 'boolean') {
    throw new CatalogApiError('The catalog service returned an invalid product.')
  }

  const variants = value.variants.map((variant): CatalogVariant => {
    if (!isRecord(variant)
      || typeof variant.id !== 'string'
      || typeof variant.sku !== 'string'
      || typeof variant.name !== 'string'
      || !(variant.priceMinor === null || isNonNegativeInteger(variant.priceMinor))
      || !isNonNegativeInteger(variant.stockOnHand)) {
      throw new CatalogApiError('The catalog service returned an invalid product variant.')
    }
    return {
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceMinor: variant.priceMinor,
      stockOnHand: variant.stockOnHand,
    }
  })
  const images = value.images.map((image): CatalogProductImage => {
    if (!isRecord(image)
      || typeof image.id !== 'string'
      || typeof image.url !== 'string'
      || !(typeof image.altText === 'string' || image.altText === null)
      || !isNonNegativeInteger(image.sortOrder)
      || typeof image.isPrimary !== 'boolean') {
      throw new CatalogApiError('The catalog service returned an invalid product image.')
    }
    return {
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    }
  })
  const specifications = value.specifications.map((specification): CatalogSpecification => {
    if (!isRecord(specification)
      || typeof specification.id !== 'string'
      || typeof specification.name !== 'string'
      || typeof specification.value !== 'string'
      || !isNonNegativeInteger(specification.sortOrder)) {
      throw new CatalogApiError('The catalog service returned an invalid product specification.')
    }
    return {
      id: specification.id,
      name: specification.name,
      value: specification.value,
      sortOrder: specification.sortOrder,
    }
  })

  return {
    id: value.id,
    slug: value.slug,
    name: value.name,
    description: value.description,
    images,
    basePriceMinor: value.basePriceMinor,
    currency: value.currency,
    category: { name: value.category.name, slug: value.category.slug },
    seller: { displayName: value.seller.displayName, slug: value.seller.slug, status: value.seller.status },
    specifications,
    variants,
    rating: value.rating,
    reviewCount: value.reviewCount,
    stockOnHand: value.stockOnHand,
    available: value.available,
  }
}

async function requestJson(path: string): Promise<unknown> {
  let response: Response
  try {
    const requestUrl = API_BASE_URL
      ? new URL(path, `${API_BASE_URL.replace(/\/+$/, '')}/`)
      : new URL(path, typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin)
    response = await fetch(requestUrl)
  } catch {
    throw new CatalogApiError('Could not reach the catalog service. Check the API connection and retry.')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new CatalogApiError('The catalog service returned an unreadable response.', response.status)
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The catalog request could not be completed.'
    throw new CatalogApiError(message, response.status)
  }
  return payload
}

export async function getProducts(query: CatalogQuery = {}): Promise<CatalogPage> {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.category) params.set('category', query.category)
  if (query.seller) params.set('seller', query.seller)
  if (query.minPriceMinor !== undefined) params.set('minPriceMinor', String(query.minPriceMinor))
  if (query.maxPriceMinor !== undefined) params.set('maxPriceMinor', String(query.maxPriceMinor))
  if (query.available !== undefined) params.set('available', String(query.available))
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  if (query.sort) params.set('sort', query.sort)

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const payload = await requestJson(`/api/v1/products${suffix}`)
  if (!isRecord(payload)
    || !Array.isArray(payload.items)
    || !isRecord(payload.pagination)
    || !isNonNegativeInteger(payload.pagination.page)
    || !isNonNegativeInteger(payload.pagination.pageSize)
    || !isNonNegativeInteger(payload.pagination.total)
    || !isNonNegativeInteger(payload.pagination.pages)) {
    throw new CatalogApiError('The catalog service returned an invalid product page.')
  }
  return {
    items: payload.items.map(parseProduct),
    pagination: {
      page: payload.pagination.page,
      pageSize: payload.pagination.pageSize,
      total: payload.pagination.total,
      pages: payload.pagination.pages,
    },
  }
}

export async function getProduct(slug: string): Promise<CatalogProduct> {
  const payload = await requestJson(`/api/v1/products/${encodeURIComponent(slug)}`)
  if (!isRecord(payload)) throw new CatalogApiError('The catalog service returned an invalid product.')
  return parseProduct(payload.item)
}

export async function getCategories(): Promise<CatalogCategory[]> {
  const payload = await requestJson('/api/v1/products/categories')
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new CatalogApiError('The catalog service returned invalid categories.')
  }
  return payload.items.map((item): CatalogCategory => {
    if (!isRecord(item)
      || typeof item.name !== 'string'
      || typeof item.slug !== 'string'
      || !isNonNegativeInteger(item.productCount)) {
      throw new CatalogApiError('The catalog service returned an invalid category.')
    }
    return { name: item.name, slug: item.slug, productCount: item.productCount }
  })
}
