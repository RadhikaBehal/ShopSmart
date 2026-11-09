import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { requireRoles } from '../auth/rbac.js'
import { prisma } from '../db.js'
import { requireAllowedOrigin } from '../security/origin.js'

export const adminProductRouter = Router()

const productIdSchema = z.string().trim().min(1).max(64)
const pageSchema = z.coerce.number().int().min(1)
const pageSizeSchema = z.coerce.number().int().min(1).max(50)

const queueQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
  listingStatus: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(20),
}).strict()

const approveSchema = z.object({
  note: z.string().trim().max(2000).optional(),
}).strict()

const disableSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
}).strict()

const rereviewSchema = z.object({
  note: z.string().trim().max(2000).optional(),
}).strict()

const sellerSummary = {
  id: true,
  slug: true,
  displayName: true,
  status: true,
} satisfies Prisma.SellerSelect

const queueSelection = {
  id: true,
  slug: true,
  name: true,
  status: true,
  moderationStatus: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  seller: { select: sellerSummary },
  variants: {
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, sku: true, name: true, priceMinor: true, stockOnHand: true, status: true },
  },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductSelect

const detailsSelection = {
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
  moderatedById: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  seller: { select: sellerSummary },
  moderator: { select: { id: true, displayName: true } },
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
    select: {
      id: true,
      sku: true,
      name: true,
      priceMinor: true,
      stockOnHand: true,
      lowStockThreshold: true,
      status: true,
    },
  },
} satisfies Prisma.ProductSelect

type ModerationAction = 'approve' | 'disable' | 're-review'

function parseBody<T>(schema: z.ZodType<T>, body: unknown) {
  return schema.safeParse(body)
}

adminProductRouter.use(requireAuth, requireRoles('ADMIN', 'SUPER_ADMIN'))

adminProductRouter.get('/pending', async (request, response, next) => {
  const parsed = queueQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid pending product query',
      details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }
  const { q, categoryId, listingStatus, page, pageSize } = parsed.data
  const where: Prisma.ProductWhereInput = {
    moderationStatus: 'PENDING_REVIEW',
    ...(categoryId ? { categoryId } : {}),
    ...(listingStatus ? { status: listingStatus } : {}),
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { seller: { displayName: { contains: q, mode: 'insensitive' } } },
        { seller: { slug: { contains: q, mode: 'insensitive' } } },
      ],
    } : {}),
  }
  try {
    const [items, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: queueSelection,
      }),
      prisma.product.count({ where }),
    ])
    response.json({
      items: items.map(({ _count, ...product }) => ({ ...product, variantCount: _count.variants })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    next(error)
  }
})

adminProductRouter.get('/:productId', async (request, response, next) => {
  const productId = productIdSchema.safeParse(request.params.productId)
  if (!productId.success) {
    response.status(400).json({ error: 'Invalid product identifier' })
    return
  }
  try {
    const item = await prisma.product.findUnique({
      where: { id: productId.data },
      select: detailsSelection,
    })
    if (!item) {
      response.status(404).json({ error: 'Product not found.' })
      return
    }
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

async function moderateProduct(
  productIdValue: unknown,
  body: unknown,
  action: ModerationAction,
  actorId: string,
  response: Parameters<Parameters<typeof adminProductRouter.post>[1]>[1],
  next: Parameters<Parameters<typeof adminProductRouter.post>[1]>[2],
) {
  const productId = productIdSchema.safeParse(productIdValue)
  const parsed = action === 'approve'
    ? parseBody(approveSchema, body)
    : action === 'disable'
      ? parseBody(disableSchema, body)
      : parseBody(rereviewSchema, body)
  if (!productId.success || !parsed.success) {
    response.status(400).json({
      error: 'Invalid product moderation request',
      details: parsed.success ? undefined : parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
    return
  }

  const actionDetails: { toStatus: 'APPROVED' | 'DISABLED' | 'PENDING_REVIEW'; note: string | null; expected: string[] } =
    action === 'approve'
      ? { toStatus: 'APPROVED', note: (parsed.data as z.infer<typeof approveSchema>).note ?? null, expected: ['PENDING_REVIEW'] }
      : action === 'disable'
        ? { toStatus: 'DISABLED', note: (parsed.data as z.infer<typeof disableSchema>).reason, expected: ['PENDING_REVIEW', 'APPROVED'] }
        : { toStatus: 'PENDING_REVIEW', note: (parsed.data as z.infer<typeof rereviewSchema>).note ?? null, expected: ['DISABLED'] }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const current = await transaction.product.findUnique({
        where: { id: productId.data },
        select: { moderationStatus: true, moderationNote: true },
      })
      if (!current) return { kind: 'missing' as const }
      if (!actionDetails.expected.includes(current.moderationStatus)) {
        return { kind: 'conflict' as const, status: current.moderationStatus }
      }

      const moderatedAt = new Date()
      const updated = await transaction.product.updateMany({
        where: {
          id: productId.data,
          moderationStatus: current.moderationStatus,
        },
        data: {
          moderationStatus: actionDetails.toStatus,
          moderationNote: actionDetails.note,
          moderatedAt,
          moderatedById: actorId,
        },
      })
      if (updated.count !== 1) return { kind: 'conflict' as const }

      await transaction.auditLog.create({
        data: {
          actorId,
          action: `PRODUCT_${action.replace('-', '_').toUpperCase()}`,
          entityType: 'Product',
          entityId: productId.data,
          metadata: {
            fromStatus: current.moderationStatus,
            toStatus: actionDetails.toStatus,
            note: actionDetails.note,
            previousNote: current.moderationNote,
          },
        },
      })
      const item = await transaction.product.findUniqueOrThrow({
        where: { id: productId.data },
        select: detailsSelection,
      })
      return { kind: 'updated' as const, item }
    }, { maxWait: 10_000, timeout: 10_000 })

    if (result.kind === 'missing') {
      response.status(404).json({ error: 'Product not found.' })
      return
    }
    if (result.kind === 'conflict') {
      response.status(409).json({
        error: `Product cannot transition from ${result.status ?? 'its current state'} using this action.`,
      })
      return
    }
    response.json({ item: result.item })
  } catch (error) {
    next(error)
  }
}

adminProductRouter.post('/:productId/approve', requireAllowedOrigin, async (request, response, next) => {
  await moderateProduct(request.params.productId, request.body, 'approve', request.auth!.sub, response, next)
})

adminProductRouter.post('/:productId/disable', requireAllowedOrigin, async (request, response, next) => {
  await moderateProduct(request.params.productId, request.body, 'disable', request.auth!.sub, response, next)
})

adminProductRouter.post('/:productId/re-review', requireAllowedOrigin, async (request, response, next) => {
  await moderateProduct(request.params.productId, request.body, 're-review', request.auth!.sub, response, next)
})
