import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'

export const productRouter = Router()

export type CatalogProductDto = {
  id: string
  slug: string
  name: string
  description: string
  images: { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean }[]
  basePriceMinor: number
  currency: string
  category: { name: string; slug: string }
  seller: { displayName: string; slug: string; status: string }
  specifications: { id: string; name: string; value: string; sortOrder: number }[]
  variants: { id: string; sku: string; name: string; priceMinor: number | null; stockOnHand: number }[]
  rating: number | null
  reviewCount: number
  stockOnHand: number
  available: boolean
}

export type ProductListResponse = {
  items: CatalogProductDto[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
}

export type ProductCategoriesResponse = {
  items: { name: string; slug: string; productCount: number }[]
}

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  seller: z.string().trim().max(80).optional(),
  minPriceMinor: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  available: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'rating']).default('newest'),
}).refine(
  ({ minPriceMinor, maxPriceMinor }) => minPriceMinor === undefined
    || maxPriceMinor === undefined
    || minPriceMinor <= maxPriceMinor,
  { message: 'Minimum price cannot exceed maximum price', path: ['minPriceMinor'] },
)

const productSelection = {
  id: true,
  slug: true,
  name: true,
  description: true,
  basePriceMinor: true,
  currency: true,
  category: { select: { name: true, slug: true } },
  seller: { select: { displayName: true, slug: true, status: true } },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, url: true, altText: true, sortOrder: true, isPrimary: true },
  },
  specifications: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, value: true, sortOrder: true },
  },
  variants: {
    where: { status: 'ACTIVE' as const },
    orderBy: { name: 'asc' },
    select: { id: true, sku: true, name: true, priceMinor: true, stockOnHand: true },
  },
} satisfies Prisma.ProductSelect
type CatalogProductRow = Prisma.ProductGetPayload<{ select: typeof productSelection }>

function buildProductWhere(
  q?: string,
  category?: string,
  seller?: string,
  minPriceMinor?: number,
  maxPriceMinor?: number,
  available?: boolean,
) {
  return {
    status: 'PUBLISHED' as const,
    moderationStatus: 'APPROVED' as const,
    ...(category ? { category: { slug: category } } : {}),
    seller: { status: 'VERIFIED' as const, ...(seller ? { slug: seller } : {}) },
    ...(minPriceMinor !== undefined || maxPriceMinor !== undefined ? {
      basePriceMinor: {
        ...(minPriceMinor !== undefined ? { gte: minPriceMinor } : {}),
        ...(maxPriceMinor !== undefined ? { lte: maxPriceMinor } : {}),
      },
    } : {}),
    ...(available === true ? {
      variants: { some: { status: 'ACTIVE' as const, stockOnHand: { gt: 0 } } },
    } : {}),
    ...(available === false ? {
      NOT: { variants: { some: { status: 'ACTIVE' as const, stockOnHand: { gt: 0 } } } },
    } : {}),
    ...(q ? {
      AND: q.split(/\s+/).filter(Boolean).map((term) => ({
        OR: [
          { name: { contains: term, mode: 'insensitive' as const } },
          { description: { contains: term, mode: 'insensitive' as const } },
          { category: { name: { contains: term, mode: 'insensitive' as const } } },
          { seller: { displayName: { contains: term, mode: 'insensitive' as const } } },
          { specifications: { some: { OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { value: { contains: term, mode: 'insensitive' as const } },
          ] } } },
        ],
      })),
    } : {}),
  }
}

async function reviewStats(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, { rating: number | null; reviewCount: number }>()

  const grouped = await prisma.review.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _avg: { rating: true },
    _count: { _all: true },
  })
  return new Map(grouped.map((entry) => [
    entry.productId,
    { rating: entry._avg.rating, reviewCount: entry._count._all },
  ]))
}

async function findProductsByRating(
  where: ReturnType<typeof buildProductWhere>,
  q: string | undefined,
  category: string | undefined,
  seller: string | undefined,
  minPriceMinor: number | undefined,
  maxPriceMinor: number | undefined,
  available: boolean | undefined,
  page: number,
  pageSize: number,
): Promise<{ items: CatalogProductRow[]; total: number }> {
  const filters: Prisma.Sql[] = [
    Prisma.sql`p."status" = 'PUBLISHED'::"ProductStatus"`,
    Prisma.sql`p."moderationStatus" = 'APPROVED'::"ProductModerationStatus"`,
    Prisma.sql`s."status" = 'VERIFIED'::"SellerStatus"`,
  ]
  if (category) filters.push(Prisma.sql`c.slug = ${category}`)
  if (seller) filters.push(Prisma.sql`s.slug = ${seller}`)
  if (minPriceMinor !== undefined) filters.push(Prisma.sql`p."basePriceMinor" >= ${minPriceMinor}`)
  if (maxPriceMinor !== undefined) filters.push(Prisma.sql`p."basePriceMinor" <= ${maxPriceMinor}`)
  if (available === true) filters.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductVariant" v
    WHERE v."productId" = p.id AND v.status = 'ACTIVE'::"VariantStatus" AND v."stockOnHand" > 0
  )`)
  if (available === false) filters.push(Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "ProductVariant" v
    WHERE v."productId" = p.id AND v.status = 'ACTIVE'::"VariantStatus" AND v."stockOnHand" > 0
  )`)
  const searchFilters = q?.split(/\s+/).filter(Boolean).map((term) => Prisma.sql`
    (p."name" ILIKE ${`%${term}%`}
      OR p."description" ILIKE ${`%${term}%`}
      OR c."name" ILIKE ${`%${term}%`}
      OR s."displayName" ILIKE ${`%${term}%`}
      OR EXISTS (
        SELECT 1 FROM "ProductSpecification" ps
        WHERE ps."productId" = p.id
          AND (ps.name ILIKE ${`%${term}%`} OR ps.value ILIKE ${`%${term}%`})
      )`)
  if (searchFilters?.length) filters.push(Prisma.sql`(${Prisma.join(searchFilters, ' AND ')})`)

  const [ranked, total] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      JOIN "Seller" s ON s.id = p."sellerId"
      LEFT JOIN "Review" r ON r."productId" = p.id
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY p.id
      ORDER BY AVG(r.rating) DESC NULLS LAST, COUNT(r.id) DESC, p."publishedAt" DESC NULLS LAST, p.id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    prisma.product.count({ where }),
  ])
  const ids = ranked.map(({ id }) => id)
  const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: productSelection })
  const byId = new Map(found.map((product) => [product.id, product]))
  return { items: ids.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  }), total }
}

function toCatalogProduct(
  product: {
    id: string
    slug: string
    name: string
    description: string
    basePriceMinor: number
    currency: string
    category: { name: string; slug: string }
    seller: { displayName: string; slug: string; status: string }
    images: { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean }[]
    specifications: { id: string; name: string; value: string; sortOrder: number }[]
    variants: { id: string; sku: string; name: string; priceMinor: number | null; stockOnHand: number }[]
  },
  stats: { rating: number | null; reviewCount: number },
): CatalogProductDto {
  const stockOnHand = product.variants.reduce((total, variant) => total + variant.stockOnHand, 0)
  return {
    ...product,
    images: [...product.images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder),
    currency: product.currency.trim(),
    rating: stats.rating,
    reviewCount: stats.reviewCount,
    stockOnHand,
    available: stockOnHand > 0,
  }
}

productRouter.get('/categories', async (_request, response, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { products: { some: { status: 'PUBLISHED', moderationStatus: 'APPROVED', seller: { status: 'VERIFIED' } } } },
      orderBy: { name: 'asc' },
      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            products: { where: { status: 'PUBLISHED', moderationStatus: 'APPROVED', seller: { status: 'VERIFIED' } } },
          },
        },
      },
    })
    const result: ProductCategoriesResponse = {
      items: categories.map(({ name, slug, _count }) => ({ name, slug, productCount: _count.products })),
    }
    response.json(result)
  } catch (error) {
    next(error)
  }
})

productRouter.get('/', async (request, response, next) => {
  const parsed = querySchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }

  const { q, category, seller, minPriceMinor, maxPriceMinor, available, page, pageSize, sort } = parsed.data
  const where = buildProductWhere(q, category, seller, minPriceMinor, maxPriceMinor, available)
  const orderBy = sort === 'price-asc'
    ? { basePriceMinor: 'asc' as const }
    : sort === 'price-desc'
      ? { basePriceMinor: 'desc' as const }
      : { publishedAt: 'desc' as const }

  try {
    let items: CatalogProductRow[]
    let total: number
    if (sort === 'rating') {
      const ranked = await findProductsByRating(
        where, q, category, seller, minPriceMinor, maxPriceMinor, available, page, pageSize,
      )
      items = ranked.items
      total = ranked.total
    } else {
      [items, total] = await prisma.$transaction([
        prisma.product.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: productSelection,
        }),
        prisma.product.count({ where }),
      ])
    }
    const stats = await reviewStats(items.map(({ id }) => id))
    const result: ProductListResponse = {
      items: items.map((item) => toCatalogProduct(
        item,
        stats.get(item.id) ?? { rating: null, reviewCount: 0 },
      )),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    }
    response.json(result)
  } catch (error) {
    next(error)
  }
})

productRouter.get('/:slug', async (request, response, next) => {
  const parsedSlug = z.string().trim().min(1).max(120).safeParse(request.params.slug)
  if (!parsedSlug.success) {
    response.status(400).json({ error: 'Invalid product slug' })
    return
  }

  try {
    const product = await prisma.product.findFirst({
      where: { slug: parsedSlug.data, status: 'PUBLISHED', moderationStatus: 'APPROVED', seller: { status: 'VERIFIED' } },
      select: productSelection,
    })
    if (!product) {
      response.status(404).json({ error: 'Product not found' })
      return
    }

    const stats = await reviewStats([product.id])
    const result: { item: CatalogProductDto } = {
      item: toCatalogProduct(product, stats.get(product.id) ?? { rating: null, reviewCount: 0 }),
    }
    response.json(result)
  } catch (error) {
    next(error)
  }
})
