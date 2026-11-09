import { API_BASE_URL } from './catalogApi'

export type SellerListingStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type SellerModerationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'DISABLED'

export type SellerProductImage = {
  id?: string
  url: string
  altText: string | null
  isPrimary: boolean
}

export type SellerProductSpecification = {
  id?: string
  name: string
  value: string
}

export type SellerProductVariant = {
  id: string
  sku: string
  name: string
  priceMinor: number | null
  stockOnHand: number
  lowStockThreshold: number
  status: 'ACTIVE' | 'INACTIVE'
}

export type SellerProduct = {
  id: string
  slug: string
  name: string
  description: string
  basePriceMinor: number
  currency: string
  status: SellerListingStatus
  moderationStatus: SellerModerationStatus
  moderationNote: string | null
  moderatedAt: string | null
  category: { id: string; name: string; slug: string }
  images: SellerProductImage[]
  specifications: SellerProductSpecification[]
  variants: SellerProductVariant[]
  variantCount: number
  stockOnHand: number
  createdAt?: string
  updatedAt?: string
}

export type SellerCategory = { id: string; name: string; slug: string; parentId: string | null }

export type SellerProductQuery = {
  status?: SellerListingStatus
  moderationStatus?: SellerModerationStatus
  categoryId?: string
  q?: string
  page?: number
  pageSize?: number
}

export type SellerPagination = { page: number; pageSize: number; total: number; pages: number }
export type SellerProductPage = { items: SellerProduct[]; pagination: SellerPagination }

export type SellerProductInput = {
  name: string
  description: string
  categoryId: string
  basePriceMinor: number
  currency: string
  images: Array<{ url: string; altText?: string | null; isPrimary?: boolean }>
  specifications: Array<{ name: string; value: string }>
  variants: Array<{
    id?: string
    sku?: string
    name: string
    priceMinor?: number | null
    stockOnHand?: number
    lowStockThreshold?: number
  }>
  status?: 'DRAFT' | 'PUBLISHED'
}

export type SellerInventoryAdjustment = {
  id: string
  variantId: string
  quantityBefore: number
  quantityChange: number
  quantityAfter: number
  reason: 'INITIAL_STOCK' | 'RESTOCK' | 'CORRECTION' | 'DAMAGE' | 'RETURN' | 'OTHER'
  note: string | null
  createdAt: string
  actor: { id: string; displayName: string } | null
  variant: { sku: string; product: { id: string; name: string } }
}

export type SellerInventoryAdjustmentResult = Pick<
  SellerInventoryAdjustment,
  'id' | 'variantId' | 'quantityBefore' | 'quantityChange' | 'quantityAfter' | 'reason' | 'note' | 'createdAt' | 'actor'
>

export type SellerLowStockVariant = {
  variantId: string
  productId: string
  productName: string
  sku: string
  stockOnHand: number
  lowStockThreshold: number
  difference: number
}

export class SellerManagementApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SellerManagementApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isListingStatus(value: unknown): value is SellerListingStatus {
  return value === 'DRAFT' || value === 'PUBLISHED' || value === 'ARCHIVED'
}

function isModerationStatus(value: unknown): value is SellerModerationStatus {
  return value === 'PENDING_REVIEW' || value === 'APPROVED' || value === 'DISABLED'
}

function isAdjustmentReason(value: unknown): value is SellerInventoryAdjustment['reason'] {
  return value === 'INITIAL_STOCK' || value === 'RESTOCK' || value === 'CORRECTION'
    || value === 'DAMAGE' || value === 'RETURN' || value === 'OTHER'
}

function parseActor(value: unknown): SellerInventoryAdjustment['actor'] {
  if (value === null) return null
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.displayName !== 'string') {
    throw new SellerManagementApiError('The inventory service returned invalid actor information.')
  }
  return { id: value.id, displayName: value.displayName }
}

function parsePage<T>(value: unknown, parseItem: (item: unknown) => T): { items: T[]; pagination: SellerPagination } {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) {
    throw new SellerManagementApiError('The seller service returned an invalid paginated response.')
  }
  const { page, pageSize, total, pages } = value.pagination
  if (typeof page !== 'number' || !Number.isInteger(page)
    || typeof pageSize !== 'number' || !Number.isInteger(pageSize)
    || typeof total !== 'number' || !Number.isInteger(total)
    || typeof pages !== 'number' || !Number.isInteger(pages)) {
    throw new SellerManagementApiError('The seller service returned invalid pagination metadata.')
  }
  return {
    items: value.items.map(parseItem),
    pagination: { page, pageSize, total, pages },
  }
}

function parseProduct(value: unknown): SellerProduct {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.slug !== 'string'
    || typeof value.name !== 'string'
    || typeof value.description !== 'string'
    || typeof value.basePriceMinor !== 'number'
    || typeof value.currency !== 'string'
    || !isListingStatus(value.status)
    || !isModerationStatus(value.moderationStatus)
    || !(typeof value.moderationNote === 'string' || value.moderationNote === null)
    || !(typeof value.moderatedAt === 'string' || value.moderatedAt === null)
    || !isRecord(value.category)
    || typeof value.category.id !== 'string'
    || typeof value.category.name !== 'string'
    || typeof value.category.slug !== 'string'
    || !Array.isArray(value.images)
    || !Array.isArray(value.specifications)
    || !Array.isArray(value.variants)
    || typeof value.variantCount !== 'number'
    || typeof value.stockOnHand !== 'number') {
    throw new SellerManagementApiError('The seller service returned an invalid product.')
  }
  const images: SellerProductImage[] = value.images.map((image) => {
    if (!isRecord(image)
      || typeof image.url !== 'string'
      || !(typeof image.altText === 'string' || image.altText === null)
      || typeof image.isPrimary !== 'boolean'
      || (image.id !== undefined && typeof image.id !== 'string')) {
      throw new SellerManagementApiError('The seller service returned an invalid product image.')
    }
    return {
      ...(typeof image.id === 'string' ? { id: image.id } : {}),
      url: image.url,
      altText: image.altText,
      isPrimary: image.isPrimary,
    }
  })
  const specifications: SellerProductSpecification[] = value.specifications.map((specification) => {
    if (!isRecord(specification)
      || typeof specification.name !== 'string'
      || typeof specification.value !== 'string'
      || (specification.id !== undefined && typeof specification.id !== 'string')) {
      throw new SellerManagementApiError('The seller service returned an invalid product specification.')
    }
    return {
      ...(typeof specification.id === 'string' ? { id: specification.id } : {}),
      name: specification.name,
      value: specification.value,
    }
  })
  const variants: SellerProductVariant[] = value.variants.map((variant) => {
    if (!isRecord(variant)
      || typeof variant.id !== 'string'
      || typeof variant.sku !== 'string'
      || typeof variant.name !== 'string'
      || !(typeof variant.priceMinor === 'number' || variant.priceMinor === null)
      || typeof variant.stockOnHand !== 'number'
      || typeof variant.lowStockThreshold !== 'number'
      || (variant.status !== 'ACTIVE' && variant.status !== 'INACTIVE')) {
      throw new SellerManagementApiError('The seller service returned an invalid product variant.')
    }
    return {
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceMinor: variant.priceMinor,
      stockOnHand: variant.stockOnHand,
      lowStockThreshold: variant.lowStockThreshold,
      status: variant.status,
    }
  })
  if ((value.createdAt !== undefined && typeof value.createdAt !== 'string')
    || (value.updatedAt !== undefined && typeof value.updatedAt !== 'string')) {
    throw new SellerManagementApiError('The seller service returned invalid product timestamps.')
  }
  return {
    id: value.id,
    slug: value.slug,
    name: value.name,
    description: value.description,
    basePriceMinor: value.basePriceMinor,
    currency: value.currency,
    status: value.status,
    moderationStatus: value.moderationStatus,
    moderationNote: value.moderationNote,
    moderatedAt: value.moderatedAt,
    category: { id: value.category.id, name: value.category.name, slug: value.category.slug },
    images,
    specifications,
    variants,
    variantCount: value.variantCount,
    stockOnHand: value.stockOnHand,
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  }
}

function parseCategory(value: unknown): SellerCategory {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.slug !== 'string' || (value.parentId !== null && typeof value.parentId !== 'string')) {
    throw new SellerManagementApiError('The seller service returned an invalid category.')
  }
  return { id: value.id, name: value.name, slug: value.slug, parentId: value.parentId }
}

async function requestJson(path: string, accessToken: string, options: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
} = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/seller/products${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new SellerManagementApiError('Could not reach seller product services. Please try again.')
  }
  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The seller product request could not be completed.'
    throw new SellerManagementApiError(message, response.status)
  }
  return payload
}

export async function getSellerCategories(accessToken: string): Promise<SellerCategory[]> {
  const payload = await requestJson('/categories', accessToken)
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new SellerManagementApiError('The seller service returned an invalid category list.')
  }
  return payload.items.map(parseCategory)
}

export async function getSellerProducts(accessToken: string, query: SellerProductQuery = {}): Promise<SellerProductPage> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const payload = await requestJson(`?${params.toString()}`, accessToken)
  return parsePage(payload, parseProduct)
}

export async function getSellerProduct(accessToken: string, productId: string): Promise<SellerProduct> {
  const payload = await requestJson(`/${encodeURIComponent(productId)}`, accessToken)
  if (!isRecord(payload)) throw new SellerManagementApiError('The seller service returned an invalid product response.')
  return parseProduct(payload.item)
}

export async function createSellerProduct(accessToken: string, product: SellerProductInput): Promise<SellerProduct> {
  const payload = await requestJson('', accessToken, { method: 'POST', body: product })
  if (!isRecord(payload)) throw new SellerManagementApiError('The seller service returned an invalid product response.')
  return parseProduct(payload.item)
}

export async function updateSellerProduct(accessToken: string, productId: string, changes: Partial<SellerProductInput>): Promise<SellerProduct> {
  const payload = await requestJson(`/${encodeURIComponent(productId)}`, accessToken, { method: 'PATCH', body: changes })
  if (!isRecord(payload)) throw new SellerManagementApiError('The seller service returned an invalid product response.')
  return parseProduct(payload.item)
}

export async function archiveSellerProduct(accessToken: string, productId: string): Promise<void> {
  await requestJson(`/${encodeURIComponent(productId)}`, accessToken, { method: 'DELETE' })
}

export async function adjustSellerInventory(accessToken: string, variantId: string, input: {
  quantityChange: number
  reason: Exclude<SellerInventoryAdjustment['reason'], 'INITIAL_STOCK'>
  note?: string
}): Promise<SellerInventoryAdjustmentResult> {
  const payload = await requestJson(`/variants/${encodeURIComponent(variantId)}/adjustments`, accessToken, {
    method: 'POST',
    body: input,
  })
  if (!isRecord(payload) || !isRecord(payload.item)) throw new SellerManagementApiError('The inventory service returned an invalid adjustment.')
  const item = payload.item
  if (typeof item.id !== 'string' || typeof item.variantId !== 'string'
    || typeof item.quantityBefore !== 'number' || typeof item.quantityChange !== 'number'
    || typeof item.quantityAfter !== 'number' || !isAdjustmentReason(item.reason)
    || !(typeof item.note === 'string' || item.note === null)
    || typeof item.createdAt !== 'string') {
    throw new SellerManagementApiError('The inventory service returned an invalid adjustment.')
  }
  const actor = parseActor(item.actor)
  return {
    id: item.id,
    variantId: item.variantId,
    quantityBefore: item.quantityBefore,
    quantityChange: item.quantityChange,
    quantityAfter: item.quantityAfter,
    reason: item.reason,
    note: item.note,
    createdAt: item.createdAt,
    actor,
  }
}

export async function setSellerLowStockThreshold(accessToken: string, variantId: string, lowStockThreshold: number): Promise<void> {
  await requestJson(`/variants/${encodeURIComponent(variantId)}/low-stock-threshold`, accessToken, {
    method: 'PATCH',
    body: { lowStockThreshold },
  })
}

export async function getSellerLowStock(accessToken: string, page = 1, pageSize = 50): Promise<{
  items: SellerLowStockVariant[]
  pagination: SellerPagination
}> {
  const payload = await requestJson(`/inventory/low-stock?page=${page}&pageSize=${pageSize}`, accessToken)
  return parsePage(payload, (value) => {
    if (!isRecord(value)
      || typeof value.variantId !== 'string'
      || typeof value.productId !== 'string'
      || typeof value.productName !== 'string'
      || typeof value.sku !== 'string'
      || typeof value.stockOnHand !== 'number'
      || typeof value.lowStockThreshold !== 'number'
      || typeof value.difference !== 'number') {
      throw new SellerManagementApiError('The inventory service returned an invalid low-stock item.')
    }
    return {
      variantId: value.variantId,
      productId: value.productId,
      productName: value.productName,
      sku: value.sku,
      stockOnHand: value.stockOnHand,
      lowStockThreshold: value.lowStockThreshold,
      difference: value.difference,
    }
  })
}

export async function getSellerInventoryHistory(accessToken: string, query: {
  productId?: string
  variantId?: string
  page?: number
  pageSize?: number
}): Promise<{ items: SellerInventoryAdjustment[]; pagination: SellerPagination }> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const payload = await requestJson(`/inventory-adjustments?${params.toString()}`, accessToken)
  return parsePage(payload, (value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.variantId !== 'string'
      || typeof value.quantityBefore !== 'number' || typeof value.quantityChange !== 'number'
      || typeof value.quantityAfter !== 'number' || !isAdjustmentReason(value.reason)
      || typeof value.createdAt !== 'string' || !isRecord(value.variant) || !isRecord(value.variant.product)) {
      throw new SellerManagementApiError('The inventory service returned an invalid history entry.')
    }
    const actor = parseActor(value.actor)
    const product = value.variant.product
    if (typeof value.variant.sku !== 'string' || !isRecord(product)
      || typeof product.id !== 'string' || typeof product.name !== 'string'
      || !(typeof value.note === 'string' || value.note === null)) {
      throw new SellerManagementApiError('The inventory service returned an invalid history entry.')
    }
    return {
      id: value.id,
      variantId: value.variantId,
      quantityBefore: value.quantityBefore,
      quantityChange: value.quantityChange,
      quantityAfter: value.quantityAfter,
      reason: value.reason,
      note: value.note,
      createdAt: value.createdAt,
      actor,
      variant: { sku: value.variant.sku, product: { id: product.id, name: product.name } },
    }
  })
}
