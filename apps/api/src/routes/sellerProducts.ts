import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { requireActiveSeller } from '../auth/sellerAccess.js'
import { prisma } from '../db.js'
import { requireAllowedOrigin } from '../security/origin.js'

export const sellerProductRouter = Router()

const maximumPriceMinor = 2_000_000_000
const maximumStock = 2_147_483_647
const productStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
const moderationStatuses = ['PENDING_REVIEW', 'APPROVED', 'DISABLED'] as const

const positivePrice = z.number().int().min(1).max(maximumPriceMinor)
const stockQuantity = z.number().int().min(0).max(maximumStock)
const lowStockThreshold = z.number().int().min(0).max(maximumStock)
const sku = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/)
const imageUrl = z.string().trim().url().max(2048).refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}, 'Product image URLs must use HTTPS')

const imageInput = z.object({
  url: imageUrl,
  altText: z.string().trim().max(300).optional().nullable(),
  isPrimary: z.boolean().optional(),
}).strict()

const specificationInput = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(1000),
}).strict()

const variantCreateInput = z.object({
  sku,
  name: z.string().trim().min(1).max(120),
  priceMinor: positivePrice.nullable().optional(),
  stockOnHand: stockQuantity,
  lowStockThreshold: lowStockThreshold.default(5),
}).strict()

const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(10_000),
  categoryId: z.string().trim().min(1).max(64),
  basePriceMinor: positivePrice,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'),
  images: z.array(imageInput).min(1).max(12),
  specifications: z.array(specificationInput).max(50).default([]),
  variants: z.array(variantCreateInput).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.variants.map((variant) => variant.sku)).size !== value.variants.length) {
    context.addIssue({ code: 'custom', message: 'Variant SKUs must be unique within a product', path: ['variants'] })
  }
  const primaryCount = value.images.filter((image) => image.isPrimary).length
  if (primaryCount > 1) {
    context.addIssue({ code: 'custom', message: 'Only one product image can be primary', path: ['images'] })
  }
  if (new Set(value.specifications.map((specification) => specification.name.toLowerCase())).size !== value.specifications.length) {
    context.addIssue({ code: 'custom', message: 'Specification names must be unique within a product', path: ['specifications'] })
  }
})

const variantPatchInput = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  sku: sku.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  priceMinor: positivePrice.nullable().optional(),
  stockOnHand: stockQuantity.optional(),
  lowStockThreshold: lowStockThreshold.optional(),
}).strict().superRefine((variant, context) => {
  if (variant.id) {
    if (variant.stockOnHand !== undefined || variant.lowStockThreshold !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Inventory values are managed separately and cannot be changed through product editing',
        path: ['stockOnHand'],
      })
    }
    if (variant.sku === undefined && variant.name === undefined && variant.priceMinor === undefined) {
      context.addIssue({ code: 'custom', message: 'Provide a variant field to update', path: ['id'] })
    }
  } else if (variant.sku === undefined || variant.name === undefined) {
    context.addIssue({ code: 'custom', message: 'New variants require a SKU and name', path: ['sku'] })
  }
})

const productPatchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().min(10).max(10_000).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
  basePriceMinor: positivePrice.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED'] as const).optional(),
  images: z.array(imageInput).max(12).optional(),
  specifications: z.array(specificationInput).max(50).optional(),
  variants: z.array(variantPatchInput).min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({ code: 'custom', message: 'Provide at least one product field to update' })
  }
  if (value.images) {
    const primaryCount = value.images.filter((image) => image.isPrimary).length
    if (primaryCount > 1) {
      context.addIssue({ code: 'custom', message: 'Only one product image can be primary', path: ['images'] })
    }
  }
  if (value.specifications
    && new Set(value.specifications.map((specification) => specification.name.toLowerCase())).size !== value.specifications.length) {
    context.addIssue({ code: 'custom', message: 'Specification names must be unique within a product', path: ['specifications'] })
  }
  if (value.variants) {
    const ids = value.variants.flatMap((variant) => variant.id ? [variant.id] : [])
    const skus = value.variants.flatMap((variant) => variant.sku ? [variant.sku] : [])
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'A variant can only be updated once per request', path: ['variants'] })
    }
    if (new Set(skus).size !== skus.length) {
      context.addIssue({ code: 'custom', message: 'Variant SKUs must be unique within this request', path: ['variants'] })
    }
  }
})

const listQuerySchema = z.object({
  status: z.enum(productStatuses).optional(),
  moderationStatus: z.enum(moderationStatuses).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

const inventoryAdjustmentSchema = z.object({
  quantityChange: z.number().int().min(-maximumStock).max(maximumStock).refine((value) => value !== 0, 'Quantity change must not be zero'),
  reason: z.enum(['RESTOCK', 'CORRECTION', 'DAMAGE', 'RETURN', 'OTHER']),
  note: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (['CORRECTION', 'DAMAGE', 'OTHER'].includes(value.reason) && !value.note) {
    context.addIssue({ code: 'custom', message: 'A note is required for this adjustment reason', path: ['note'] })
  }
})

const inventoryThresholdSchema = z.object({
  lowStockThreshold: lowStockThreshold,
}).strict()

const inventoryHistoryQuerySchema = z.object({
  productId: z.string().trim().min(1).max(64).optional(),
  variantId: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict().refine((value) => value.productId !== undefined || value.variantId !== undefined, {
  message: 'Specify a productId or variantId',
})

const inventoryPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

const productSelection = {
  id: true,
  slug: true,
  name: true,
  description: true,
  basePriceMinor: true,
  currency: true,
  status: true,
  moderationStatus: true,
  moderationNote: true,
  moderatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, url: true, altText: true, sortOrder: true, isPrimary: true },
  },
  specifications: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, value: true, sortOrder: true },
  },
  variants: {
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, sku: true, name: true, priceMinor: true, stockOnHand: true, lowStockThreshold: true, status: true },
  },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductSelect

type SellerProductRow = Prisma.ProductGetPayload<{ select: typeof productSelection }>

function toSellerProduct(product: SellerProductRow) {
  const { _count, variants, ...details } = product
  return {
    ...details,
    variants,
    variantCount: _count.variants,
    stockOnHand: variants.reduce((total, variant) => total + variant.stockOnHand, 0),
  }
}

function slugBase(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'product'
}

function imageRows(images: z.infer<typeof imageInput>[]) {
  const hasPrimary = images.some((image) => image.isPrimary)
  return images.map((image, sortOrder) => ({
    url: image.url,
    altText: image.altText ?? null,
    sortOrder,
    isPrimary: image.isPrimary ?? (!hasPrimary && sortOrder === 0),
  }))
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isMissingRelation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2003' || error.code === 'P2025')
}

function sendWriteError(error: unknown, response: Response) {
  if (isUniqueConflict(error)) {
    response.status(409).json({ error: 'A product SKU is already in use.' })
    return true
  }
  if (isMissingRelation(error)) {
    response.status(400).json({ error: 'A selected category or variant is no longer available.' })
    return true
  }
  return false
}

function validatedProductId(value: unknown) {
  return z.string().trim().min(1).max(64).safeParse(value)
}

sellerProductRouter.use(requireAuth, requireActiveSeller)

sellerProductRouter.get('/categories', async (_request, response, next) => {
  try {
    const items = await prisma.category.findMany({
      orderBy: [{ name: 'asc' }, { slug: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true },
    })
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.get('/', async (request, response, next) => {
  const parsed = listQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid seller product query', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  const { status, moderationStatus, categoryId, q, page, pageSize } = parsed.data
  const where: Prisma.ProductWhereInput = {
    seller: { userId: request.auth!.sub },
    ...(status ? { status } : {}),
    ...(moderationStatus ? { moderationStatus } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
  }
  try {
    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: productSelection,
      }),
      prisma.product.count({ where }),
    ])
    response.json({
      items: products.map(toSellerProduct),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.post('/', requireAllowedOrigin, async (request, response, next) => {
  const parsed = productCreateSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid product details', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  try {
    const created = await prisma.$transaction(async (transaction) => {
      const seller = await transaction.seller.findUnique({
        where: { userId: request.auth!.sub },
        select: { id: true },
      })
      if (!seller) throw new Error('ACTIVE_SELLER_NOT_FOUND')
      const category = await transaction.category.findUnique({
        where: { id: parsed.data.categoryId },
        select: { id: true },
      })
      if (!category) throw new Error('PRODUCT_CATEGORY_NOT_FOUND')

      const product = await transaction.product.create({
        data: {
          sellerId: seller.id,
          categoryId: category.id,
          slug: `${slugBase(parsed.data.name)}-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          name: parsed.data.name,
          description: parsed.data.description,
          basePriceMinor: parsed.data.basePriceMinor,
          currency: parsed.data.currency,
          status: 'DRAFT',
          moderationStatus: 'PENDING_REVIEW',
          images: { create: imageRows(parsed.data.images) },
          specifications: {
            create: parsed.data.specifications.map((specification, sortOrder) => ({ ...specification, sortOrder })),
          },
          variants: {
            create: parsed.data.variants.map((variant) => ({
              sku: variant.sku,
              name: variant.name,
              priceMinor: variant.priceMinor ?? null,
              stockOnHand: variant.stockOnHand,
              lowStockThreshold: variant.lowStockThreshold,
            })),
          },
        },
        select: { id: true, variants: { select: { id: true, stockOnHand: true } } },
      })
      const openingEntries = product.variants
        .filter((variant) => variant.stockOnHand > 0)
        .map((variant) => ({
          variantId: variant.id,
          actorId: request.auth!.sub,
          quantityBefore: 0,
          quantityChange: variant.stockOnHand,
          quantityAfter: variant.stockOnHand,
          reason: 'INITIAL_STOCK' as const,
          note: 'Initial stock recorded when this variant was created.',
        }))
      if (openingEntries.length) {
        await transaction.productInventoryAdjustment.createMany({ data: openingEntries })
      }
      return transaction.product.findUniqueOrThrow({ where: { id: product.id }, select: productSelection })
    }, { maxWait: 10_000, timeout: 10_000 })
    response.status(201).json({ item: toSellerProduct(created) })
  } catch (error) {
    if (error instanceof Error && error.message === 'PRODUCT_CATEGORY_NOT_FOUND') {
      response.status(400).json({ error: 'The selected product category does not exist.' })
      return
    }
    if (error instanceof Error && error.message === 'ACTIVE_SELLER_NOT_FOUND') {
      response.status(403).json({ error: 'An active, approved seller account is required.' })
      return
    }
    if (sendWriteError(error, response)) return
    next(error)
  }
})

sellerProductRouter.post('/variants/:variantId/adjustments', requireAllowedOrigin, async (request, response, next) => {
  const variantId = validatedProductId(request.params.variantId)
  const parsed = inventoryAdjustmentSchema.safeParse(request.body)
  if (!variantId.success || !parsed.success) {
    response.status(400).json({
      error: 'Invalid inventory adjustment',
      details: parsed.success ? undefined : parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }

  try {
    const item = await prisma.$transaction(async (transaction) => {
      // Serialize read-modify-write adjustments for this variant across API processes.
      const [variant] = await transaction.$queryRaw<Array<{ id: string; stockOnHand: number }>>(Prisma.sql`
        SELECT v."id", v."stockOnHand"
        FROM "ProductVariant" AS v
        INNER JOIN "Product" AS p ON p."id" = v."productId"
        INNER JOIN "Seller" AS s ON s."id" = p."sellerId"
        WHERE v."id" = ${variantId.data} AND s."userId" = ${request.auth!.sub}
        FOR UPDATE OF v
      `)
      if (!variant) return null

      const quantityAfter = variant.stockOnHand + parsed.data.quantityChange
      if (quantityAfter < 0 || quantityAfter > maximumStock) {
        throw new Error('INVALID_RESULTING_STOCK')
      }

      await transaction.productVariant.update({
        where: { id: variant.id },
        data: { stockOnHand: quantityAfter },
      })
      return transaction.productInventoryAdjustment.create({
        data: {
          variantId: variant.id,
          actorId: request.auth!.sub,
          quantityBefore: variant.stockOnHand,
          quantityChange: parsed.data.quantityChange,
          quantityAfter,
          reason: parsed.data.reason,
          note: parsed.data.note,
        },
        select: {
          id: true,
          variantId: true,
          quantityBefore: true,
          quantityChange: true,
          quantityAfter: true,
          reason: true,
          note: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true } },
        },
      })
    }, { maxWait: 10_000, timeout: 10_000 })

    if (!item) {
      response.status(404).json({ error: 'Variant not found.' })
      return
    }
    response.status(201).json({ item })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_RESULTING_STOCK') {
      response.status(400).json({ error: 'The adjustment would produce an invalid stock quantity.' })
      return
    }
    next(error)
  }
})

sellerProductRouter.patch('/variants/:variantId/low-stock-threshold', requireAllowedOrigin, async (request, response, next) => {
  const variantId = validatedProductId(request.params.variantId)
  const parsed = inventoryThresholdSchema.safeParse(request.body)
  if (!variantId.success || !parsed.success) {
    response.status(400).json({
      error: 'Invalid low-stock threshold',
      details: parsed.success ? undefined : parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }

  try {
    const item = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.productVariant.updateMany({
        where: { id: variantId.data, product: { seller: { userId: request.auth!.sub } } },
        data: { lowStockThreshold: parsed.data.lowStockThreshold },
      })
      if (updated.count === 0) return null
      return transaction.productVariant.findFirstOrThrow({
        where: { id: variantId.data, product: { seller: { userId: request.auth!.sub } } },
        select: {
          id: true,
          sku: true,
          stockOnHand: true,
          lowStockThreshold: true,
          product: { select: { id: true, name: true } },
        },
      })
    })

    if (!item) {
      response.status(404).json({ error: 'Variant not found.' })
      return
    }
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.get('/inventory-adjustments', async (request, response, next) => {
  const parsed = inventoryHistoryQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid inventory history query',
      details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }
  const { productId, variantId, page, pageSize } = parsed.data
  const userId = request.auth!.sub

  try {
    const ownedProductOrVariant = variantId
      ? await prisma.productVariant.findFirst({
        where: { id: variantId, product: { seller: { userId } } },
        select: { id: true },
      })
      : await prisma.product.findFirst({
        where: { id: productId!, seller: { userId } },
        select: { id: true },
      })
    if (!ownedProductOrVariant) {
      response.status(404).json({ error: 'Product or variant not found.' })
      return
    }

    const where: Prisma.ProductInventoryAdjustmentWhereInput = {
      variant: {
        product: {
          seller: { userId },
          ...(productId ? { id: productId } : {}),
        },
        ...(variantId ? { id: variantId } : {}),
      },
    }
    const [items, total] = await prisma.$transaction([
      prisma.productInventoryAdjustment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          variantId: true,
          quantityBefore: true,
          quantityChange: true,
          quantityAfter: true,
          reason: true,
          note: true,
          createdAt: true,
          variant: {
            select: {
              sku: true,
              product: { select: { id: true, name: true } },
            },
          },
          actor: { select: { id: true, displayName: true } },
        },
      }),
      prisma.productInventoryAdjustment.count({ where }),
    ])
    response.json({
      items,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.get('/inventory/low-stock', async (request, response, next) => {
  const parsed = inventoryPageQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid low-stock query',
      details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }
  const { page, pageSize } = parsed.data
  const userId = request.auth!.sub
  const offset = (page - 1) * pageSize

  try {
    const [items, [count]] = await prisma.$transaction([
      prisma.$queryRaw<Array<{
        variantId: string
        productId: string
        productName: string
        sku: string
        stockOnHand: number
        lowStockThreshold: number
        difference: number
      }>>(Prisma.sql`
        SELECT
          v."id" AS "variantId",
          p."id" AS "productId",
          p."name" AS "productName",
          v."sku",
          v."stockOnHand",
          v."lowStockThreshold",
          (v."stockOnHand" - v."lowStockThreshold") AS "difference"
        FROM "ProductVariant" AS v
        INNER JOIN "Product" AS p ON p."id" = v."productId"
        INNER JOIN "Seller" AS s ON s."id" = p."sellerId"
        WHERE s."userId" = ${userId} AND v."stockOnHand" <= v."lowStockThreshold"
        ORDER BY v."stockOnHand" ASC, v."id" ASC
        OFFSET ${offset}
        LIMIT ${pageSize}
      `),
      prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "total"
        FROM "ProductVariant" AS v
        INNER JOIN "Product" AS p ON p."id" = v."productId"
        INNER JOIN "Seller" AS s ON s."id" = p."sellerId"
        WHERE s."userId" = ${userId} AND v."stockOnHand" <= v."lowStockThreshold"
      `),
    ])
    const total = Number(count.total)
    response.json({
      items,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.get('/:productId', async (request, response, next) => {
  const productId = validatedProductId(request.params.productId)
  if (!productId.success) {
    response.status(400).json({ error: 'Invalid product identifier' })
    return
  }
  try {
    const product = await prisma.product.findFirst({
      where: { id: productId.data, seller: { userId: request.auth!.sub } },
      select: productSelection,
    })
    if (!product) {
      response.status(404).json({ error: 'Product not found.' })
      return
    }
    response.json({ item: toSellerProduct(product) })
  } catch (error) {
    next(error)
  }
})

sellerProductRouter.patch('/:productId', requireAllowedOrigin, async (request, response, next) => {
  const productId = validatedProductId(request.params.productId)
  const parsed = productPatchSchema.safeParse(request.body)
  if (!productId.success || !parsed.success) {
    response.status(400).json({
      error: 'Invalid product update',
      details: parsed.success ? undefined : parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }
  const changes = parsed.data
  const listingContentChanged = changes.name !== undefined
    || changes.description !== undefined
    || changes.categoryId !== undefined
    || changes.basePriceMinor !== undefined
    || changes.currency !== undefined
    || changes.images !== undefined
    || changes.specifications !== undefined
    || changes.variants !== undefined

  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await transaction.product.findFirst({
        where: { id: productId.data, seller: { userId: request.auth!.sub } },
        select: { id: true, status: true, moderationStatus: true },
      })
      if (!current) return null

      if (changes.categoryId) {
        const category = await transaction.category.findUnique({ where: { id: changes.categoryId }, select: { id: true } })
        if (!category) throw new Error('PRODUCT_CATEGORY_NOT_FOUND')
      }

      const variantUpdates = changes.variants?.filter((variant) => variant.id) ?? []
      const variantIds = variantUpdates.flatMap((variant) => variant.id ? [variant.id] : [])
      if (variantIds.length) {
        const ownedVariants = await transaction.productVariant.findMany({
          where: { productId: current.id, id: { in: variantIds } },
          select: { id: true },
        })
        if (ownedVariants.length !== variantIds.length) throw new Error('PRODUCT_VARIANT_NOT_FOUND')
      }

      const data: Prisma.ProductUpdateInput = {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.categoryId !== undefined ? { category: { connect: { id: changes.categoryId } } } : {}),
        ...(changes.basePriceMinor !== undefined ? { basePriceMinor: changes.basePriceMinor } : {}),
        ...(changes.currency !== undefined ? { currency: changes.currency } : {}),
        ...(changes.status !== undefined ? {
          status: changes.status,
          publishedAt: changes.status === 'PUBLISHED'
            ? (current.status === 'PUBLISHED' ? undefined : new Date())
            : null,
        } : {}),
        ...(listingContentChanged && current.moderationStatus === 'APPROVED'
          ? { moderationStatus: 'PENDING_REVIEW' }
          : {}),
      }
      await transaction.product.update({ where: { id: current.id }, data })

      if (changes.images !== undefined) {
        await transaction.productImage.deleteMany({ where: { productId: current.id } })
        if (changes.images.length) {
          await transaction.productImage.createMany({
            data: imageRows(changes.images).map((image) => ({ ...image, productId: current.id })),
          })
        }
      }
      if (changes.specifications !== undefined) {
        await transaction.productSpecification.deleteMany({ where: { productId: current.id } })
        if (changes.specifications.length) {
          await transaction.productSpecification.createMany({
            data: changes.specifications.map((specification, sortOrder) => ({ ...specification, sortOrder, productId: current.id })),
          })
        }
      }
      if (changes.variants) {
        for (const variant of changes.variants) {
          if (variant.id) {
            await transaction.productVariant.update({
              where: { id: variant.id },
              data: {
                ...(variant.sku !== undefined ? { sku: variant.sku } : {}),
                ...(variant.name !== undefined ? { name: variant.name } : {}),
                ...(variant.priceMinor !== undefined ? { priceMinor: variant.priceMinor } : {}),
              },
            })
          } else {
            const createdVariant = await transaction.productVariant.create({
              data: {
                productId: current.id,
                sku: variant.sku!,
                name: variant.name!,
                priceMinor: variant.priceMinor ?? null,
                stockOnHand: variant.stockOnHand ?? 0,
                lowStockThreshold: variant.lowStockThreshold ?? 5,
              },
            })
            if (createdVariant.stockOnHand > 0) {
              await transaction.productInventoryAdjustment.create({
                data: {
                  variantId: createdVariant.id,
                  actorId: request.auth!.sub,
                  quantityBefore: 0,
                  quantityChange: createdVariant.stockOnHand,
                  quantityAfter: createdVariant.stockOnHand,
                  reason: 'INITIAL_STOCK',
                  note: 'Initial stock recorded when this variant was created.',
                },
              })
            }
          }
        }
      }
      return transaction.product.findUniqueOrThrow({ where: { id: current.id }, select: productSelection })
    }, { maxWait: 10_000, timeout: 10_000 })
    if (!updated) {
      response.status(404).json({ error: 'Product not found.' })
      return
    }
    response.json({ item: toSellerProduct(updated) })
  } catch (error) {
    if (error instanceof Error && error.message === 'PRODUCT_CATEGORY_NOT_FOUND') {
      response.status(400).json({ error: 'The selected product category does not exist.' })
      return
    }
    if (error instanceof Error && error.message === 'PRODUCT_VARIANT_NOT_FOUND') {
      response.status(404).json({ error: 'A variant was not found for this product.' })
      return
    }
    if (sendWriteError(error, response)) return
    next(error)
  }
})

sellerProductRouter.delete('/:productId', requireAllowedOrigin, async (request, response, next) => {
  const productId = validatedProductId(request.params.productId)
  if (!productId.success) {
    response.status(400).json({ error: 'Invalid product identifier' })
    return
  }
  try {
    const archived = await prisma.product.updateMany({
      where: { id: productId.data, seller: { userId: request.auth!.sub }, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    })
    if (archived.count === 0) {
      const product = await prisma.product.findFirst({
        where: { id: productId.data, seller: { userId: request.auth!.sub } },
        select: { id: true, status: true },
      })
      if (!product) {
        response.status(404).json({ error: 'Product not found.' })
        return
      }
      response.status(409).json({ error: 'Product is already archived.' })
      return
    }
    response.json({ id: productId.data, status: 'ARCHIVED' })
  } catch (error) {
    next(error)
  }
})
