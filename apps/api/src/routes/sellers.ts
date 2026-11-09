import { Router, type Response } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { requireActiveSeller } from '../auth/sellerAccess.js'
import { requireRoles } from '../auth/rbac.js'
import { prisma } from '../db.js'
import { requireAllowedOrigin } from '../security/origin.js'

export const sellerRouter = Router()
export const sellerStoreRouter = Router()

const businessTypes = ['INDIVIDUAL', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'OTHER'] as const
const applicationStatuses = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED'] as const

const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  storeName: z.string().trim().min(2).max(100),
  businessType: z.enum(businessTypes),
  description: z.string().trim().min(20).max(2000),
  contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  contactPhone: z.string().trim().min(7).max(30),
  addressLine1: z.string().trim().min(3).max(160),
  addressLine2: z.string().trim().max(160).optional().or(z.literal('')),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(2).max(24),
  country: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens'),
})

const reviewSchema = z.object({
  action: z.enum(['under-review', 'needs-information', 'approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if ((value.action === 'needs-information' || value.action === 'reject') && !value.note?.trim()) {
    context.addIssue({ code: 'custom', message: 'A note is required for this decision', path: ['note'] })
  }
})

const sellerProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  slug: z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().min(20).max(2000).optional(),
  contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  contactPhone: z.string().trim().min(7).max(30).nullable().optional(),
  shippingPolicy: z.string().trim().max(2000).nullable().optional(),
  returnPolicy: z.string().trim().max(2000).nullable().optional(),
  logoUrl: z.string().url().max(2048).startsWith('https://').nullable().optional(),
  bannerUrl: z.string().url().max(2048).startsWith('https://').nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one profile field' })

const sellerStatusSchema = z.object({
  action: z.enum(['suspend', 'reactivate']),
  note: z.string().trim().max(2000).optional(),
})

function normalizedStoreName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function sendConflict(response: Response) {
  response.status(409).json({ error: 'That store name or URL is already in use.' })
}

async function checkStoreIdentity(
  storeName: string,
  slug: string,
  applicationId?: string,
  sellerId?: string,
) {
  const [sameApplicationName, sameApplicationSlug, sameSellerName, sameSellerSlug] = await Promise.all([
    prisma.sellerApplication.findFirst({
      where: { storeNameNormalized: normalizedStoreName(storeName), ...(applicationId ? { id: { not: applicationId } } : {}) },
      select: { id: true },
    }),
    prisma.sellerApplication.findFirst({
      where: { slug, ...(applicationId ? { id: { not: applicationId } } : {}) },
      select: { id: true },
    }),
    prisma.seller.findFirst({
      where: { displayName: { equals: storeName, mode: 'insensitive' }, ...(sellerId ? { id: { not: sellerId } } : {}) },
      select: { id: true },
    }),
    prisma.seller.findFirst({
      where: { slug, ...(sellerId ? { id: { not: sellerId } } : {}) },
      select: { id: true },
    }),
  ])
  return Boolean(sameApplicationName || sameApplicationSlug || sameSellerName || sameSellerSlug)
}

sellerRouter.get(
  '/applications/me',
  requireAuth,
  requireRoles('CUSTOMER'),
  async (request, response, next) => {
    try {
      const application = await prisma.sellerApplication.findUnique({ where: { userId: request.auth!.sub } })
      response.json({ application })
    } catch (error) {
      next(error)
    }
  },
)

sellerRouter.put(
  '/applications/me',
  requireAuth,
  requireRoles('CUSTOMER'),
  requireAllowedOrigin,
  async (request, response, next) => {
    const parsed = applicationSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid seller application', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
      return
    }
    try {
      const userId = request.auth!.sub
      const existing = await prisma.sellerApplication.findUnique({ where: { userId } })
      if (existing && !['DRAFT', 'NEEDS_INFORMATION', 'REJECTED'].includes(existing.status)) {
        response.status(409).json({ error: 'This application is already under review or approved and cannot be edited.' })
        return
      }
      if (await checkStoreIdentity(parsed.data.storeName, parsed.data.slug, existing?.id)) {
        response.status(409).json({ error: 'That store name or URL is already in use.' })
        return
      }
      const values = {
        ...parsed.data,
        addressLine2: parsed.data.addressLine2 || null,
        storeNameNormalized: normalizedStoreName(parsed.data.storeName),
      }
      let application
      if (existing) {
        const updated = await prisma.sellerApplication.updateMany({
          where: { id: existing.id, status: existing.status },
          data: { ...values, ...(existing.status === 'REJECTED' ? { status: 'DRAFT', reviewMessage: null } : {}) },
        })
        if (updated.count !== 1) {
          response.status(409).json({ error: 'Application status changed while editing. Reload before saving again.' })
          return
        }
        application = await prisma.sellerApplication.findUniqueOrThrow({ where: { id: existing.id } })
      } else {
        application = await prisma.sellerApplication.create({ data: { ...values, userId } })
      }
      response.json({ application })
    } catch (error) {
      if (isUniqueConflict(error)) {
        sendConflict(response)
        return
      }
      next(error)
    }
  },
)

sellerRouter.post(
  '/applications/me/submit',
  requireAuth,
  requireRoles('CUSTOMER'),
  requireAllowedOrigin,
  async (request, response, next) => {
    try {
      const application = await prisma.sellerApplication.findUnique({ where: { userId: request.auth!.sub } })
      if (!application) {
        response.status(404).json({ error: 'Save an application draft before submitting it.' })
        return
      }
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(application.status)) {
        response.status(409).json({ error: 'This application cannot be submitted in its current status.' })
        return
      }
      const updated = await prisma.$transaction(async (transaction) => {
        const current = await transaction.sellerApplication.findUnique({ where: { id: application.id } })
        if (!current || !['DRAFT', 'NEEDS_INFORMATION'].includes(current.status)) throw new Error('SELLER_SUBMIT_CONFLICT')
        const changed = await transaction.sellerApplication.updateMany({
          where: { id: current.id, status: current.status },
          data: { status: 'SUBMITTED', submittedAt: new Date(), reviewMessage: null },
        })
        if (changed.count !== 1) throw new Error('SELLER_SUBMIT_CONFLICT')
        const saved = await transaction.sellerApplication.findUniqueOrThrow({ where: { id: current.id } })
        await transaction.sellerHistory.create({
          data: { applicationId: current.id, actorId: request.auth!.sub, action: 'APPLICATION_SUBMITTED', fromStatus: current.status, toStatus: 'SUBMITTED' },
        })
        return saved
      })
      response.json({ application: updated })
    } catch (error) {
      if (error instanceof Error && error.message === 'SELLER_SUBMIT_CONFLICT') {
        response.status(409).json({ error: 'Application status changed while submitting. Reload before trying again.' })
        return
      }
      next(error)
    }
  },
)

sellerRouter.get(
  '/admin/applications',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  async (request, response, next) => {
    const parsedStatus = z.enum(applicationStatuses).optional().safeParse(request.query.status)
    if (!parsedStatus.success) {
      response.status(400).json({ error: 'Invalid application status filter' })
      return
    }
    try {
      const items = await prisma.sellerApplication.findMany({
        where: parsedStatus.data ? { status: parsedStatus.data } : undefined,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        include: { user: { select: { id: true, email: true, displayName: true } } },
      })
      response.json({ items })
    } catch (error) {
      next(error)
    }
  },
)

sellerRouter.get(
  '/admin/applications/:applicationId',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  async (request, response, next) => {
    const applicationId = z.string().min(1).max(64).safeParse(request.params.applicationId)
    if (!applicationId.success) {
      response.status(400).json({ error: 'Invalid application identifier' })
      return
    }
    try {
      const application = await prisma.sellerApplication.findUnique({
        where: { id: applicationId.data },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          history: {
            orderBy: { createdAt: 'desc' },
            include: { actor: { select: { displayName: true, email: true } } },
          },
        },
      })
      if (!application) {
        response.status(404).json({ error: 'Seller application not found' })
        return
      }
      response.json({ application })
    } catch (error) {
      next(error)
    }
  },
)

sellerRouter.post(
  '/admin/applications/:applicationId/review',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  requireAllowedOrigin,
  async (request, response, next) => {
    const applicationId = z.string().min(1).max(64).safeParse(request.params.applicationId)
    const parsed = reviewSchema.safeParse(request.body)
    if (!applicationId.success || !parsed.success) {
      response.status(400).json({ error: 'Invalid application review', details: parsed.success ? undefined : parsed.error.issues.map(({ path, message }) => ({ path, message })) })
      return
    }
    try {
      const application = await prisma.sellerApplication.findUnique({ where: { id: applicationId.data } })
      if (!application) {
        response.status(404).json({ error: 'Seller application not found' })
        return
      }
      const allowedSourceStatuses: Record<typeof parsed.data.action, string[]> = {
        'under-review': ['SUBMITTED'],
        'needs-information': ['SUBMITTED', 'UNDER_REVIEW'],
        approve: ['SUBMITTED', 'UNDER_REVIEW'],
        reject: ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION'],
      }
      if (!allowedSourceStatuses[parsed.data.action].includes(application.status)) {
        response.status(409).json({ error: 'This application cannot be reviewed in its current status.' })
        return
      }
      const nextStatus = ({
        'under-review': 'UNDER_REVIEW',
        'needs-information': 'NEEDS_INFORMATION',
        approve: 'APPROVED',
        reject: 'REJECTED',
      } as const)[parsed.data.action]

      const result = await prisma.$transaction(async (transaction) => {
        const current = await transaction.sellerApplication.findUnique({ where: { id: application.id } })
        if (!current) throw new Error('SELLER_APPLICATION_STATE_CONFLICT')
        if (!allowedSourceStatuses[parsed.data.action].includes(current.status)) {
          throw new Error('SELLER_APPLICATION_STATE_CONFLICT')
        }
        const changed = await transaction.sellerApplication.updateMany({
          where: { id: current.id, status: current.status },
          data: { status: nextStatus, reviewMessage: parsed.data.note ?? null },
        })
        if (changed.count !== 1) throw new Error('SELLER_APPLICATION_STATE_CONFLICT')
        let sellerId: string | undefined
        if (parsed.data.action === 'approve') {
          const conflictingSeller = await transaction.seller.findFirst({
            where: {
              userId: { not: current.userId },
              OR: [
                { slug: current.slug },
                { displayName: { equals: current.storeName, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          })
          if (conflictingSeller) throw new Error('SELLER_SLUG_CONFLICT')
          const seller = await transaction.seller.upsert({
            where: { userId: current.userId },
            create: {
              userId: current.userId,
              slug: current.slug,
              displayName: current.storeName,
              businessName: current.businessName,
              businessType: current.businessType,
              description: current.description,
              contactEmail: current.contactEmail,
              contactPhone: current.contactPhone,
              status: 'VERIFIED',
            },
            update: {
              slug: current.slug,
              displayName: current.storeName,
              businessName: current.businessName,
              businessType: current.businessType,
              description: current.description,
              contactEmail: current.contactEmail,
              contactPhone: current.contactPhone,
              status: 'VERIFIED',
            },
          })
          sellerId = seller.id
          await transaction.user.update({ where: { id: current.userId }, data: { role: 'SELLER' } })
        }
        const updated = await transaction.sellerApplication.findUniqueOrThrow({ where: { id: current.id } })
        await transaction.sellerHistory.create({
          data: {
            applicationId: current.id,
            sellerId,
            actorId: request.auth!.sub,
            action: `APPLICATION_${parsed.data.action.replace('-', '_').toUpperCase()}`,
            fromStatus: current.status,
            toStatus: nextStatus,
            note: parsed.data.note,
          },
        })
        await transaction.auditLog.create({
          data: {
            actorId: request.auth!.sub,
            action: `SELLER_APPLICATION_${parsed.data.action.replace('-', '_').toUpperCase()}`,
            entityType: 'SellerApplication',
            entityId: current.id,
            metadata: { fromStatus: current.status, toStatus: nextStatus, note: parsed.data.note ?? null },
          },
        })
        return updated
      }, { maxWait: 10_000, timeout: 10_000 })
      response.json({ application: result })
    } catch (error) {
      if (error instanceof Error && error.message === 'SELLER_APPLICATION_STATE_CONFLICT') {
        response.status(409).json({ error: 'The application changed during review. Reload it before making another decision.' })
        return
      }
      if (error instanceof Error && error.message === 'SELLER_SLUG_CONFLICT') {
        response.status(409).json({ error: 'That store URL is already in use.' })
        return
      }
      if (isUniqueConflict(error)) {
        sendConflict(response)
        return
      }
      next(error)
    }
  },
)

sellerRouter.get(
  '/admin/applications/:applicationId/history',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  async (request, response, next) => {
    const applicationId = z.string().min(1).max(64).safeParse(request.params.applicationId)
    if (!applicationId.success) {
      response.status(400).json({ error: 'Invalid application identifier' })
      return
    }
    try {
      const history = await prisma.sellerHistory.findMany({
        where: { applicationId: applicationId.data },
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { displayName: true, email: true } } },
      })
      response.json({ items: history })
    } catch (error) {
      next(error)
    }
  },
)

sellerRouter.get(
  '/admin/sellers',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  async (request, response, next) => {
    const parsedStatus = z.enum(['PENDING', 'VERIFIED', 'SUSPENDED']).optional().safeParse(request.query.status)
    if (!parsedStatus.success) {
      response.status(400).json({ error: 'Invalid seller status filter' })
      return
    }
    try {
      const items = await prisma.seller.findMany({
        where: {
          user: { is: { sellerApplication: { is: { status: 'APPROVED' } } } },
          ...(parsedStatus.data ? { status: parsedStatus.data } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, userId: true, slug: true, displayName: true, status: true, createdAt: true,
          user: {
            select: {
              email: true,
              displayName: true,
              sellerApplication: { select: { status: true } },
            },
          },
        },
      })
      response.json({ items })
    } catch (error) {
      next(error)
    }
  },
)

sellerRouter.patch(
  '/admin/sellers/:sellerId/status',
  requireAuth,
  requireRoles('ADMIN', 'SUPER_ADMIN'),
  requireAllowedOrigin,
  async (request, response, next) => {
    const sellerId = z.string().min(1).max(64).safeParse(request.params.sellerId)
    const parsed = sellerStatusSchema.safeParse(request.body)
    if (!sellerId.success || !parsed.success) {
      response.status(400).json({ error: 'Invalid seller status request' })
      return
    }
    try {
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId.data },
        include: { user: { select: { id: true, role: true } } },
      })
      if (!seller) {
        response.status(404).json({ error: 'Seller not found' })
        return
      }
      if (parsed.data.action === 'suspend' && seller.status !== 'VERIFIED') {
        response.status(409).json({ error: 'Only an active seller can be suspended.' })
        return
      }
      if (parsed.data.action === 'reactivate' && seller.status !== 'SUSPENDED') {
        response.status(409).json({ error: 'Only a suspended seller can be reactivated.' })
        return
      }
      const updated = await prisma.$transaction(async (transaction) => {
        const currentSeller = await transaction.seller.findUnique({ where: { id: seller.id } })
        const expectedStatus = parsed.data.action === 'suspend' ? 'VERIFIED' : 'SUSPENDED'
        if (!currentSeller || currentSeller.status !== expectedStatus) throw new Error('SELLER_STATUS_CONFLICT')
        const approvedApplication = await transaction.sellerApplication.findUnique({
          where: { userId: currentSeller.userId },
          select: { id: true, status: true },
        })
        if (approvedApplication?.status !== 'APPROVED') {
          throw new Error('SELLER_APPROVAL_REQUIRED')
        }
        const newStatus = parsed.data.action === 'suspend' ? 'SUSPENDED' : 'VERIFIED'
        const role = parsed.data.action === 'suspend' ? 'CUSTOMER' : 'SELLER'
        const changed = await transaction.seller.updateMany({
          where: { id: currentSeller.id, status: currentSeller.status },
          data: { status: newStatus },
        })
        if (changed.count !== 1) throw new Error('SELLER_STATUS_CONFLICT')
        await transaction.user.update({ where: { id: currentSeller.userId }, data: { role } })
        await transaction.sellerHistory.create({
          data: {
            applicationId: approvedApplication?.id,
            sellerId: currentSeller.id,
            actorId: request.auth!.sub,
            action: parsed.data.action === 'suspend' ? 'SELLER_SUSPENDED' : 'SELLER_REACTIVATED',
            note: parsed.data.note,
          },
        })
        await transaction.auditLog.create({
          data: {
            actorId: request.auth!.sub,
            action: parsed.data.action === 'suspend' ? 'SELLER_SUSPENDED' : 'SELLER_REACTIVATED',
            entityType: 'Seller',
            entityId: currentSeller.id,
            metadata: { previousStatus: currentSeller.status, status: newStatus, note: parsed.data.note ?? null },
          },
        })
        return transaction.seller.findUniqueOrThrow({
          where: { id: currentSeller.id },
          select: {
            id: true, userId: true, slug: true, displayName: true, status: true, createdAt: true,
            user: {
              select: {
                email: true,
                displayName: true,
                sellerApplication: { select: { status: true } },
              },
            },
          },
        })
      }, { maxWait: 10_000, timeout: 10_000 })
      response.json({ seller: updated })
    } catch (error) {
      if (error instanceof Error && error.message === 'SELLER_STATUS_CONFLICT') {
        response.status(409).json({ error: 'Seller status changed during this action. Reload the seller list and try again.' })
        return
      }
      if (error instanceof Error && error.message === 'SELLER_APPROVAL_REQUIRED') {
        response.status(409).json({ error: 'An approved seller application is required to manage seller access.' })
        return
      }
      next(error)
    }
  },
)

sellerRouter.get('/me', requireAuth, requireActiveSeller, async (request, response, next) => {
  try {
    const seller = await prisma.seller.findUnique({
      where: { userId: request.auth!.sub },
      include: {
        user: { select: { email: true } },
        products: { where: { status: 'PUBLISHED' }, select: { id: true }, take: 1 },
      },
    })
    const application = await prisma.sellerApplication.findUnique({ where: { userId: request.auth!.sub } })
    if (!seller) {
      response.status(404).json({ error: 'Seller profile not found' })
      return
    }
    response.json({
      seller: {
        id: seller.id,
        slug: seller.slug,
        displayName: seller.displayName,
        businessName: seller.businessName,
        businessType: seller.businessType,
        description: seller.description,
        contactEmail: seller.contactEmail,
        contactPhone: seller.contactPhone,
        logoUrl: seller.logoUrl,
        bannerUrl: seller.bannerUrl,
        shippingPolicy: seller.shippingPolicy,
        returnPolicy: seller.returnPolicy,
        status: seller.status,
        accountEmail: seller.user.email,
      },
      application,
      publishedProductCount: await prisma.product.count({ where: { sellerId: seller.id, status: 'PUBLISHED' } }),
    })
  } catch (error) {
    next(error)
  }
})

sellerRouter.patch(
  '/me',
  requireAuth,
  requireActiveSeller,
  requireAllowedOrigin,
  async (request, response, next) => {
    const parsed = sellerProfileSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid store profile', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
      return
    }
    try {
      const seller = await prisma.seller.findUnique({ where: { userId: request.auth!.sub } })
      if (!seller) {
        response.status(404).json({ error: 'Seller profile not found' })
        return
      }
      if (parsed.data.slug || parsed.data.displayName) {
        const duplicate = await checkStoreIdentity(
          parsed.data.displayName ?? seller.displayName,
          parsed.data.slug ?? seller.slug,
          (await prisma.sellerApplication.findUnique({ where: { userId: seller.userId }, select: { id: true } }))?.id,
          seller.id,
        )
        if (duplicate) {
          response.status(409).json({ error: 'That store name or URL is already in use.' })
          return
        }
      }
      const updated = await prisma.$transaction(async (transaction) => {
        const profile = await transaction.seller.update({
          where: { id: seller.id },
          data: parsed.data,
          select: {
            id: true, slug: true, displayName: true, description: true, contactEmail: true,
            contactPhone: true, logoUrl: true, bannerUrl: true, shippingPolicy: true,
            returnPolicy: true, status: true,
          },
        })
        if (parsed.data.displayName || parsed.data.slug) {
          await transaction.sellerApplication.updateMany({
            where: { userId: seller.userId },
            data: {
              ...(parsed.data.displayName ? {
                storeName: parsed.data.displayName,
                storeNameNormalized: normalizedStoreName(parsed.data.displayName),
              } : {}),
              ...(parsed.data.slug ? { slug: parsed.data.slug } : {}),
            },
          })
        }
        await transaction.auditLog.create({
          data: { actorId: seller.userId, action: 'SELLER_PROFILE_UPDATED', entityType: 'Seller', entityId: seller.id },
        })
        return profile
      })
      response.json({ seller: updated })
    } catch (error) {
      if (isUniqueConflict(error)) {
        sendConflict(response)
        return
      }
      next(error)
    }
  },
)

sellerStoreRouter.get('/:slug', async (request, response, next) => {
  const slug = z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).safeParse(request.params.slug)
  if (!slug.success) {
    response.status(400).json({ error: 'Invalid store URL' })
    return
  }
  try {
    const seller = await prisma.seller.findFirst({
      where: { slug: slug.data, status: 'VERIFIED' },
      select: {
        displayName: true,
        slug: true,
        description: true,
        businessType: true,
        contactEmail: true,
        contactPhone: true,
        logoUrl: true,
        bannerUrl: true,
        shippingPolicy: true,
        returnPolicy: true,
        status: true,
      },
    })
    if (!seller) {
      response.status(404).json({ error: 'Store not found' })
      return
    }
    response.json({ store: { ...seller, verificationStatus: 'VERIFIED' } })
  } catch (error) {
    next(error)
  }
})
