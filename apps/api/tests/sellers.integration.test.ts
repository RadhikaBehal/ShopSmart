import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed seller marketplace flows', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('covers applications, administrative decisions, seller access, public stores, and suspension', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const applicantEmail = `seller-applicant-${suffix}@example.test`
    const otherEmail = `seller-other-${suffix}@example.test`
    const adminEmail = `seller-admin-${suffix}@example.test`
    const rejectedEmail = `seller-rejected-${suffix}@example.test`
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const slug = `seller-${suffix}`
    const updatedSlug = `seller-updated-${suffix}`
    const categorySlug = `seller-category-${suffix}`
    const productSlug = `seller-product-${suffix}`
    const users: string[] = []
    let databaseAvailable = false

    async function register(email: string, name: string) {
      const response = await request.agent(app)
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({ email, password: 'seller integration password', displayName: name })
      assert.equal(response.status, 201)
      users.push(response.body.user.id as string)
      return { agent: request.agent(app), token: response.body.accessToken as string, userId: response.body.user.id as string }
    }

    const applicationInput = (storeName: string, storeSlug: string, email: string) => ({
      businessName: `${storeName} Workshop`,
      storeName,
      businessType: 'INDIVIDUAL',
      description: 'A small independent business creating useful, long-lasting goods.',
      contactEmail: email,
      contactPhone: '+91 98765 43210',
      addressLine1: '12 Market Road',
      addressLine2: '',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      country: 'India',
      slug: storeSlug,
    })

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      const applicant = await register(applicantEmail, 'Seller Applicant')
      const other = await register(otherEmail, 'Another Applicant')
      const admin = await register(adminEmail, 'Seller Administrator')
      const rejected = await register(rejectedEmail, 'Rejected Applicant')
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } })

      const unauthenticated = await request(app).get('/api/v1/seller/applications/me')
      assert.equal(unauthenticated.status, 401)

      const customerSellerAccess = await request(app)
        .get('/api/v1/seller/me')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(customerSellerAccess.status, 403)

      const initialDraft = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send(applicationInput('Northwind Goods', slug, applicantEmail))
      assert.equal(initialDraft.status, 200)
      assert.equal(initialDraft.body.application.status, 'DRAFT')
      const applicationId = initialDraft.body.application.id as string

      const readDraft = await request(app)
        .get('/api/v1/seller/applications/me')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(readDraft.body.application.id, applicationId)

      const editedDraft = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ ...applicationInput('Northwind Goods', slug, applicantEmail), city: 'Mumbai' })
      assert.equal(editedDraft.status, 200)
      assert.equal(editedDraft.body.application.city, 'Mumbai')
      assert.equal(await prisma.sellerApplication.count({ where: { userId: applicant.userId } }), 1)

      const duplicateStore = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${other.token}`)
        .send(applicationInput('Northwind Goods', slug, otherEmail))
      assert.equal(duplicateStore.status, 409)

      const badApplication = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ ...applicationInput('Other Workshop', `other-${suffix}`, otherEmail), addressLine1: 'x' })
      assert.equal(badApplication.status, 400)

      const submit = await request(app)
        .post('/api/v1/seller/applications/me/submit')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({})
      assert.equal(submit.status, 200)
      assert.equal(submit.body.application.status, 'SUBMITTED')
      const duplicateSubmit = await request(app)
        .post('/api/v1/seller/applications/me/submit')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({})
      assert.equal(duplicateSubmit.status, 409)

      const customerListDenied = await request(app)
        .get('/api/v1/seller/admin/applications')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(customerListDenied.status, 403)
      const applicationList = await request(app)
        .get('/api/v1/seller/admin/applications?status=SUBMITTED')
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(applicationList.status, 200)
      assert.ok(applicationList.body.items.some((item: { id: string }) => item.id === applicationId))

      const underReview = await request(app)
        .post(`/api/v1/seller/admin/applications/${applicationId}/review`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'under-review' })
      assert.equal(underReview.body.application.status, 'UNDER_REVIEW')
      const needsInformation = await request(app)
        .post(`/api/v1/seller/admin/applications/${applicationId}/review`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'needs-information', note: 'Please clarify the business description.' })
      assert.equal(needsInformation.body.application.status, 'NEEDS_INFORMATION')
      const applicantStatus = await request(app)
        .get('/api/v1/seller/applications/me')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(applicantStatus.body.application.reviewMessage, 'Please clarify the business description.')

      const revisedApplication = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ ...applicationInput('Northwind Goods', slug, applicantEmail), description: 'Updated: a small independent business creating useful goods.' })
      assert.equal(revisedApplication.status, 200)
      assert.equal(revisedApplication.body.application.status, 'NEEDS_INFORMATION')
      const resubmitted = await request(app)
        .post('/api/v1/seller/applications/me/submit')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({})
      assert.equal(resubmitted.body.application.status, 'SUBMITTED')

      const approved = await request(app)
        .post(`/api/v1/seller/admin/applications/${applicationId}/review`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'approve', note: 'Business information reviewed.' })
      assert.equal(approved.status, 200)
      assert.equal(approved.body.application.status, 'APPROVED')
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.userId } })).role, 'SELLER')
      const seller = await prisma.seller.findUniqueOrThrow({ where: { userId: applicant.userId } })
      assert.equal(seller.status, 'VERIFIED')
      assert.equal(seller.slug, slug)
      const managedSellers = await request(app)
        .get('/api/v1/seller/admin/sellers')
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(managedSellers.status, 200)
      assert.ok(managedSellers.body.items.some((item: { id: string; user: { sellerApplication: { status: string } } }) => item.id === seller.id && item.user.sellerApplication.status === 'APPROVED'))

      const ownedDashboard = await request(app)
        .get('/api/v1/seller/me')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(ownedDashboard.status, 200)
      const otherSellerDashboard = await request(app)
        .get('/api/v1/seller/me')
        .set('Authorization', `Bearer ${other.token}`)
      assert.equal(otherSellerDashboard.status, 403)
      const otherSellerProfileUpdate = await request(app)
        .patch('/api/v1/seller/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ description: 'This account does not own the seller store.' })
      assert.equal(otherSellerProfileUpdate.status, 403)
      const sellerCannotReapply = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send(applicationInput('Northwind Goods', slug, applicantEmail))
      assert.equal(sellerCannotReapply.status, 403)

      const category = await prisma.category.create({ data: { name: 'Seller integration', slug: categorySlug } })
      await prisma.product.create({
        data: {
          slug: productSlug,
          name: 'Northwind sample listing',
          description: 'A published seller storefront test product.',
          basePriceMinor: 2300,
          status: 'PUBLISHED',
          moderationStatus: 'APPROVED',
          publishedAt: new Date(),
          sellerId: seller.id,
          categoryId: category.id,
        },
      })

      const profileUpdate = await request(app)
        .patch('/api/v1/seller/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ displayName: 'Northwind Home', slug: updatedSlug, shippingPolicy: 'Ships within three business days.' })
      assert.equal(profileUpdate.status, 200)
      assert.equal(profileUpdate.body.seller.slug, updatedSlug)
      const publicStore = await request(app).get(`/api/v1/stores/${updatedSlug}`)
      assert.equal(publicStore.status, 200)
      assert.equal(publicStore.body.store.verificationStatus, 'VERIFIED')
      assert.equal(publicStore.body.store.displayName, 'Northwind Home')
      assert.equal('addressLine1' in publicStore.body.store, false)
      assert.equal('businessName' in publicStore.body.store, false)
      const publicProducts = await request(app).get('/api/v1/products').query({ seller: updatedSlug })
      assert.equal(publicProducts.body.pagination.total, 1)

      const applicationDetail = await request(app)
        .get(`/api/v1/seller/admin/applications/${applicationId}`)
        .set('Authorization', `Bearer ${admin.token}`)
      assert.equal(applicationDetail.status, 200)
      assert.ok(applicationDetail.body.application.history.some((entry: { action: string }) => entry.action === 'APPLICATION_APPROVE'))
      const adminAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'SellerApplication', entityId: applicationId, action: 'SELLER_APPLICATION_APPROVE' },
      })
      assert.ok(adminAudit)

      const rejectedDraft = await request(app)
        .put('/api/v1/seller/applications/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${rejected.token}`)
        .send(applicationInput('Cedar Workshop', `cedar-${suffix}`, rejectedEmail))
      assert.equal(rejectedDraft.status, 200)
      const rejectedSubmit = await request(app)
        .post('/api/v1/seller/applications/me/submit')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${rejected.token}`)
        .send({})
      assert.equal(rejectedSubmit.status, 200)
      const rejection = await request(app)
        .post(`/api/v1/seller/admin/applications/${rejectedDraft.body.application.id}/review`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'reject', note: 'The application needs a clearer business description.' })
      assert.equal(rejection.body.application.status, 'REJECTED')
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: rejected.userId } })).role, 'CUSTOMER')
      assert.equal(await prisma.seller.count({ where: { userId: rejected.userId } }), 0)

      const suspended = await request(app)
        .patch(`/api/v1/seller/admin/sellers/${seller.id}/status`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'suspend', note: 'Integration suspension check.' })
      assert.equal(suspended.body.seller.status, 'SUSPENDED')
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.userId } })).role, 'CUSTOMER')
      const suspendedDashboard = await request(app)
        .get('/api/v1/seller/me')
        .set('Authorization', `Bearer ${applicant.token}`)
      assert.equal(suspendedDashboard.status, 403)
      assert.equal((await request(app).get(`/api/v1/stores/${updatedSlug}`)).status, 404)
      assert.equal((await request(app).get('/api/v1/products').query({ seller: updatedSlug })).body.pagination.total, 0)

      const reactivated = await request(app)
        .patch(`/api/v1/seller/admin/sellers/${seller.id}/status`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ action: 'reactivate', note: 'Integration reactivation check.' })
      assert.equal(reactivated.body.seller.status, 'VERIFIED')
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.userId } })).role, 'SELLER')
      assert.equal((await request(app).get(`/api/v1/stores/${updatedSlug}`)).status, 200)
      const statusHistory = await prisma.sellerHistory.findMany({ where: { sellerId: seller.id } })
      assert.ok(statusHistory.some((entry) => entry.action === 'SELLER_SUSPENDED'))
      assert.ok(statusHistory.some((entry) => entry.action === 'SELLER_REACTIVATED'))
    } finally {
      if (databaseAvailable) {
        await prisma.product.deleteMany({ where: { slug: productSlug } })
        await prisma.category.deleteMany({ where: { slug: categorySlug } })
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { actorId: { in: users } },
              { entityId: { in: users } },
              { entityType: 'SellerApplication', entityId: { contains: suffix } },
              { entityType: 'Seller', entityId: { contains: suffix } },
            ],
          },
        })
        await prisma.sellerApplication.deleteMany({ where: { userId: { in: users } } })
        await prisma.seller.deleteMany({ where: { userId: { in: users } } })
        await prisma.user.deleteMany({ where: { id: { in: users } } })
      }
    }
  })
})
