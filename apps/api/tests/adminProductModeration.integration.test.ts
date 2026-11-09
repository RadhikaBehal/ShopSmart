import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { createAccessToken } from '../src/auth/tokens.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed administrator product moderation', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('moderates seller products with explicit transitions, authorization, and audit history', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const users: string[] = []
    let sellerId: string | undefined
    let categoryId: string | undefined
    let databaseAvailable = false
    const productIds: string[] = []

    async function makeAccount(label: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
      const email = `admin-moderation-${label}-${suffix}@example.test`
      const user = await prisma.user.create({
        data: { email, passwordHash: 'integration-fixture-not-used-for-login', displayName: `Moderation ${label}`, role },
      })
      users.push(user.id)
      const session = await prisma.refreshSession.create({
        data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
      return {
        userId: user.id,
        token: await createAccessToken({ sub: user.id, sid: session.id, role: user.role, email }),
      }
    }

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      const admin = await makeAccount('admin', 'ADMIN')
      const customer = await makeAccount('customer')
      const sellerAccount = await makeAccount('seller')
      const foreignAdminRoleTokenAccount = await makeAccount('seller-role')
      await prisma.user.update({ where: { id: sellerAccount.userId }, data: { role: 'SELLER' } })
      await prisma.user.update({ where: { id: foreignAdminRoleTokenAccount.userId }, data: { role: 'SELLER' } })

      const sellerSlug = `moderation-seller-${suffix}`
      const seller = await prisma.$transaction(async (transaction) => {
        const createdSeller = await transaction.seller.create({
          data: {
            userId: sellerAccount.userId,
            slug: sellerSlug,
            displayName: `Moderation Store ${suffix}`,
            status: 'VERIFIED',
          },
        })
        await transaction.sellerApplication.create({
          data: {
            userId: sellerAccount.userId,
            businessName: `Moderation Business ${suffix}`,
            storeName: `Moderation Store ${suffix}`,
            storeNameNormalized: `moderation store ${suffix}`,
            businessType: 'INDIVIDUAL',
            description: 'Integration seller account for administrator moderation API tests.',
            contactEmail: `seller-${suffix}@example.test`,
            contactPhone: '+91 98765 43210',
            addressLine1: '12 Integration Road',
            city: 'Pune',
            state: 'Maharashtra',
            postalCode: '411001',
            country: 'India',
            slug: sellerSlug,
            status: 'APPROVED',
          },
        })
        const secondSeller = await transaction.seller.create({
          data: {
            userId: foreignAdminRoleTokenAccount.userId,
            slug: `moderation-other-${suffix}`,
            displayName: `Other Moderation Store ${suffix}`,
            status: 'VERIFIED',
          },
        })
        await transaction.sellerApplication.create({
          data: {
            userId: foreignAdminRoleTokenAccount.userId,
            businessName: `Other Moderation Business ${suffix}`,
            storeName: `Other Moderation Store ${suffix}`,
            storeNameNormalized: `other moderation store ${suffix}`,
            businessType: 'INDIVIDUAL',
            description: 'Second isolated seller account for moderation API tests.',
            contactEmail: `other-seller-${suffix}@example.test`,
            contactPhone: '+91 98765 43210',
            addressLine1: '14 Integration Road',
            city: 'Pune',
            state: 'Maharashtra',
            postalCode: '411001',
            country: 'India',
            slug: `moderation-other-${suffix}`,
            status: 'APPROVED',
          },
        })
        return { createdSeller, secondSeller }
      })
      sellerId = seller.createdSeller.id
      const otherSellerId = seller.secondSeller.id

      const category = await prisma.category.create({
        data: { slug: `moderation-category-${suffix}`, name: `Moderation Category ${suffix}` },
      })
      categoryId = category.id
      const sellerSession = await prisma.refreshSession.findFirstOrThrow({ where: { userId: sellerAccount.userId } })
      const sellerToken = await createAccessToken({
        sub: sellerAccount.userId,
        sid: sellerSession.id,
        role: 'SELLER',
        email: `seller-${suffix}@example.test`,
      })

      async function createProduct(
        name: string,
        state: 'PENDING_REVIEW' | 'APPROVED',
        sellerRecordId: string = sellerId!,
        listingStatus: 'DRAFT' | 'PUBLISHED' = 'DRAFT',
      ) {
        const product = await prisma.product.create({
          data: {
            sellerId: sellerRecordId,
            categoryId: category.id,
            slug: `moderation-${randomUUID()}`,
            name,
            description: `${name} product listing for moderation integration coverage.`,
            basePriceMinor: 12500,
            status: listingStatus,
            publishedAt: listingStatus === 'PUBLISHED' ? new Date() : null,
            moderationStatus: state,
            moderationNote: state === 'APPROVED' ? 'Existing approved record.' : null,
            moderatedAt: state === 'APPROVED' ? new Date() : null,
            moderatedById: state === 'APPROVED' ? admin.userId : null,
            images: { create: [{ url: 'https://images.example.test/moderation.jpg', altText: 'Moderation image', isPrimary: true }] },
            specifications: { create: [{ name: 'Material', value: 'Steel' }] },
            variants: {
              create: [
                { sku: `MOD-${randomUUID()}`, name: 'Standard', priceMinor: null, stockOnHand: 6, lowStockThreshold: 5 },
              ],
            },
          },
          include: { variants: true },
        })
        productIds.push(product.id)
        const variant = product.variants[0]
        await prisma.productInventoryAdjustment.create({
          data: {
            variantId: variant.id,
            actorId: sellerAccount.userId,
            quantityBefore: 0,
            quantityChange: 6,
            quantityAfter: 6,
            reason: 'INITIAL_STOCK',
            note: 'Opening balance for moderation integration fixture.',
          },
        })
        return product
      }

      const pendingForApproval = await createProduct(`Moderation Approval ${suffix}`, 'PENDING_REVIEW')
      const pendingForDisable = await createProduct(`Moderation Disable ${suffix}`, 'PENDING_REVIEW', sellerId, 'PUBLISHED')
      const existingApproved = await createProduct(`Existing Approved ${suffix}`, 'APPROVED', otherSellerId, 'PUBLISHED')

      const base = '/api/v1/admin/products'
      assert.equal((await request(app).get(`${base}/pending`)).status, 401)
      assert.equal((await request(app).get(`${base}/pending`)
        .set('Authorization', `Bearer ${customer.token}`)).status, 403)
      assert.equal((await request(app).get(`${base}/pending`)
        .set('Authorization', `Bearer ${sellerToken}`)).status, 403)

      const pending = await request(app).get(`${base}/pending`)
        .query({ q: suffix, page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(pending.status, 200)
      assert.equal(pending.body.pagination.total, 2)
      assert.equal(pending.body.items.length, 1)
      assert.equal(pending.body.items[0].moderationStatus, 'PENDING_REVIEW')
      assert.equal(pending.body.items[0].seller.slug, sellerSlug)
      assert.equal(pending.body.items[0].category.id, category.id)
      assert.equal(pending.body.items[0].variantCount, 1)
      assert.equal('email' in pending.body.items[0].seller, false)

      const filtered = await request(app).get(`${base}/pending`)
        .query({ q: `Moderation Disable ${suffix}`, listingStatus: 'PUBLISHED' })
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(filtered.status, 200)
      assert.equal(filtered.body.pagination.total, 1)
      assert.equal(filtered.body.items[0].id, pendingForDisable.id)

      const details = await request(app).get(`${base}/${pendingForApproval.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(details.status, 200)
      assert.equal(details.body.item.images.length, 1)
      assert.equal(details.body.item.specifications[0].value, 'Steel')
      assert.equal(details.body.item.variants[0].stockOnHand, 6)
      assert.equal(details.body.item.moderationStatus, 'PENDING_REVIEW')
      assert.equal('email' in details.body.item.seller, false)

      const badApprovePayload = await request(app).post(`${base}/${pendingForApproval.id}/approve`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`)
        .send({ moderationStatus: 'APPROVED', moderatedById: customer.userId })
      assert.equal(badApprovePayload.status, 400)
      const approved = await request(app).post(`${base}/${pendingForApproval.id}/approve`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`)
        .send({ note: 'Listing content meets marketplace policy.' })
      assert.equal(approved.status, 200)
      assert.equal(approved.body.item.moderationStatus, 'APPROVED')
      assert.equal(approved.body.item.moderatedById, admin.userId)
      assert.equal(approved.body.item.moderator.id, admin.userId)
      assert.ok(approved.body.item.moderatedAt)
      assert.equal(approved.body.item.moderationNote, 'Listing content meets marketplace policy.')
      assert.equal((await request(app).post(`${base}/${pendingForApproval.id}/approve`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`).send({})).status, 409)

      const missingReason = await request(app).post(`${base}/${pendingForDisable.id}/disable`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`).send({ reason: '   ' })
      assert.equal(missingReason.status, 400)
      const disabled = await request(app).post(`${base}/${pendingForDisable.id}/disable`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'Listing makes an unsupported safety claim.' })
      assert.equal(disabled.status, 200)
      assert.equal(disabled.body.item.moderationStatus, 'DISABLED')
      assert.equal(disabled.body.item.moderationNote, 'Listing makes an unsupported safety claim.')
      assert.equal(disabled.body.item.moderator.id, admin.userId)
      assert.ok(disabled.body.item.moderatedAt)
      assert.equal((await request(app).post(`${base}/${pendingForDisable.id}/approve`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`).send({})).status, 409)
      assert.equal((await request(app).post(`${base}/${pendingForDisable.id}/disable`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'Duplicate disable' })).status, 409)

      const sellerEdit = await request(app).patch(`/api/v1/seller/products/${pendingForDisable.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ name: `Seller Edited Disabled ${suffix}` })
      assert.equal(sellerEdit.status, 200)
      assert.equal(sellerEdit.body.item.moderationStatus, 'DISABLED')
      assert.equal(sellerEdit.body.item.moderationNote, 'Listing makes an unsupported safety claim.')
      assert.equal((await request(app).patch(`/api/v1/seller/products/${pendingForDisable.id}`)
        .set('Origin', origin).set('Authorization', `Bearer ${sellerToken}`)
        .send({ moderationStatus: 'APPROVED' })).status, 400)

      const hiddenFromCatalog = await request(app).get('/api/v1/products')
        .query({ q: `Seller Edited Disabled ${suffix}` })
      assert.equal(hiddenFromCatalog.status, 200)
      assert.equal(hiddenFromCatalog.body.items.length, 0)
      assert.equal((await request(app).get(`/api/v1/products/${pendingForDisable.slug}`)).status, 404)

      const reReview = await request(app).post(`${base}/${pendingForDisable.id}/re-review`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`)
        .send({ note: 'Seller provided corrected evidence; queue for fresh review.' })
      assert.equal(reReview.status, 200)
      assert.equal(reReview.body.item.moderationStatus, 'PENDING_REVIEW')
      assert.equal(reReview.body.item.moderationNote, 'Seller provided corrected evidence; queue for fresh review.')
      assert.equal((await request(app).post(`${base}/${existingApproved.id}/re-review`)
        .set('Origin', origin).set('Authorization', `Bearer ${admin.token}`).send({})).status, 409)

      const moderationAudits = await prisma.auditLog.findMany({
        where: { entityType: 'Product', entityId: { in: productIds } },
        orderBy: { createdAt: 'asc' },
      })
      assert.deepEqual(new Set(moderationAudits.map((entry) => entry.action)), new Set([
        'PRODUCT_APPROVE',
        'PRODUCT_DISABLE',
        'PRODUCT_RE_REVIEW',
      ]))
      assert.ok(moderationAudits.every((entry) => entry.actorId === admin.userId))
      assert.equal(moderationAudits[1].metadata && (moderationAudits[1].metadata as { note: string }).note,
        'Listing makes an unsupported safety claim.')

      const unchangedApproved = await prisma.product.findUniqueOrThrow({ where: { id: existingApproved.id } })
      assert.equal(unchangedApproved.moderationStatus, 'APPROVED')
      assert.equal(unchangedApproved.moderatedById, admin.userId)
      const openingEntryAfter = await prisma.productInventoryAdjustment.findFirstOrThrow({
        where: { variantId: existingApproved.variants[0].id, reason: 'INITIAL_STOCK' },
      })
      assert.equal(openingEntryAfter.quantityBefore, 0)
      assert.equal(openingEntryAfter.quantityChange, 6)
      assert.equal(openingEntryAfter.quantityAfter, 6)
    } finally {
      if (databaseAvailable) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { actorId: { in: users } },
              { entityType: 'Product', entityId: { in: productIds } },
            ],
          },
        })
        if (productIds.length) {
          const variants = await prisma.productVariant.findMany({
            where: { productId: { in: productIds } },
            select: { id: true },
          })
          await prisma.productInventoryAdjustment.deleteMany({
            where: { variantId: { in: variants.map(({ id }) => id) } },
          })
          await prisma.product.deleteMany({ where: { id: { in: productIds } } })
        }
        if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } })
        await prisma.sellerApplication.deleteMany({ where: { userId: { in: users } } })
        if (sellerId) await prisma.seller.deleteMany({ where: { id: sellerId } })
        await prisma.seller.deleteMany({ where: { userId: { in: users } } })
        await prisma.user.deleteMany({ where: { id: { in: users } } })
      }
    }
  })
})
