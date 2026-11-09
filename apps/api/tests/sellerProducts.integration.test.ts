import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { createAccessToken } from '../src/auth/tokens.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed seller product management', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('creates, lists, reads, updates and archives seller-owned products safely', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const userIds: string[] = []
    const sellerIds: string[] = []
    const applicationUserIds: string[] = []
    const categorySlugs = [`seller-products-${suffix}`, `seller-empty-${suffix}`]
    const productSlugs: string[] = []
    let rollbackTrigger: string | undefined
    let rollbackFunction: string | undefined
    let databaseAvailable = false

    async function makeAccount(emailLabel: string) {
      const email = `${emailLabel}-${suffix}@example.test`
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: 'integration-fixture-not-used-for-login',
          displayName: `Seller product ${emailLabel}`,
        },
      })
      userIds.push(user.id)
      const session = await prisma.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      return {
        userId: user.id,
        token: await createAccessToken({ sub: user.id, sid: session.id, role: user.role, email }),
      }
    }

    async function makeSeller(
      account: { userId: string; token: string },
      label: string,
      sellerStatus: 'VERIFIED' | 'SUSPENDED' = 'VERIFIED',
      applicationStatus: 'APPROVED' | 'DRAFT' = 'APPROVED',
    ) {
      const slug = `seller-${label}-${suffix}`
      const seller = await prisma.$transaction(async (transaction) => {
        await transaction.user.update({ where: { id: account.userId }, data: { role: 'SELLER' } })
        const createdSeller = await transaction.seller.create({
          data: {
            userId: account.userId,
            slug,
            displayName: `Seller ${label}`,
            status: sellerStatus,
          },
        })
        await transaction.sellerApplication.create({
          data: {
            userId: account.userId,
            businessName: `Seller ${label} business`,
            storeName: `Seller ${label} shop ${suffix}`,
            storeNameNormalized: `seller ${label} shop ${suffix}`,
            businessType: 'INDIVIDUAL',
            description: 'A small business used only for product API integration tests.',
            contactEmail: `${label}-${suffix}@example.test`,
            contactPhone: '+91 98765 43210',
            addressLine1: '12 Integration Road',
            city: 'Pune',
            state: 'Maharashtra',
            postalCode: '411001',
            country: 'India',
            slug,
            status: applicationStatus,
          },
        })
        return createdSeller
      })
      sellerIds.push(seller.id)
      applicationUserIds.push(account.userId)
      return { ...account, sellerId: seller.id, sellerSlug: slug }
    }

    const productInput = (name: string, categoryId: string, skuPrefix: string) => ({
      name,
      description: `${name} is a carefully tested seller product listing.`,
      categoryId,
      basePriceMinor: 12500,
      currency: 'INR',
      images: [{ url: 'https://images.example.test/product.jpg', altText: `${name} image` }],
      specifications: [{ name: 'Material', value: 'Recycled aluminium' }],
      variants: [
        { sku: `${skuPrefix}-STOCKED`, name: 'Standard', priceMinor: null, stockOnHand: 7 },
        { sku: `${skuPrefix}-EMPTY`, name: 'Small', priceMinor: 9900, stockOnHand: 0 },
      ],
    })

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      const sellerAAccount = await makeAccount('seller-a')
      const sellerBAccount = await makeAccount('seller-b')
      const customer = await makeAccount('customer')
      const unapprovedAccount = await makeAccount('unapproved')
      const suspendedAccount = await makeAccount('suspended')
      const admin = await makeAccount('moderator')

      const sellerA = await makeSeller(sellerAAccount, 'a')
      const sellerB = await makeSeller(sellerBAccount, 'b')
      const unapprovedSeller = await makeSeller(unapprovedAccount, 'unapproved', 'VERIFIED', 'DRAFT')
      const suspendedSeller = await makeSeller(suspendedAccount, 'suspended', 'SUSPENDED', 'APPROVED')
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } })

      const [category, emptyCategory] = await Promise.all(categorySlugs.map((slug, index) =>
        prisma.category.create({ data: { slug, name: index === 0 ? 'Seller test products' : 'Seller empty category' } })))

      assert.equal((await request(app).get('/api/v1/seller/products')).status, 401)
      assert.equal((await request(app).get('/api/v1/seller/products/categories')
        .set('Authorization', `Bearer ${customer.token}`)).status, 403)
      assert.equal((await request(app).get('/api/v1/seller/products')
        .set('Authorization', `Bearer ${unapprovedSeller.token}`)).status, 403)
      assert.equal((await request(app).get('/api/v1/seller/products')
        .set('Authorization', `Bearer ${suspendedSeller.token}`)).status, 403)

      const categories = await request(app).get('/api/v1/seller/products/categories')
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(categories.status, 200)
      assert.ok(categories.body.items.some((item: { id: string }) => item.id === emptyCategory.id))

      const invalid = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ ...productInput('Invalid product', category.id, `INVALID-${suffix}`), basePriceMinor: 0 })
      assert.equal(invalid.status, 400)
      const missingFields = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ name: 'Incomplete listing' })
      assert.equal(missingFields.status, 400)
      const invalidCategory = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ ...productInput('Invalid category product', `missing-${suffix}`, `MISSING-${suffix}`) })
      assert.equal(invalidCategory.status, 400)
      const customerWrite = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${customer.token}`)
        .send(productInput('Customer product', category.id, `CUSTOMER-${suffix}`))
      assert.equal(customerWrite.status, 403)
      const unapprovedWrite = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${unapprovedSeller.token}`)
        .send(productInput('Unapproved product', category.id, `UNAPPROVED-${suffix}`))
      assert.equal(unapprovedWrite.status, 403)

      const created = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send(productInput('Integration Desk Lamp', category.id, `PRODUCT-${suffix}`))
      assert.equal(created.status, 201)
      const product = created.body.item
      productSlugs.push(product.slug)
      assert.equal(product.status, 'DRAFT')
      assert.equal(product.moderationStatus, 'PENDING_REVIEW')
      assert.equal(product.basePriceMinor, 12500)
      assert.equal(product.currency, 'INR')
      assert.equal(product.images[0].isPrimary, true)
      assert.equal(product.specifications[0].name, 'Material')
      assert.equal(product.variants.length, 2)
      assert.equal(product.variantCount, 2)
      assert.equal(product.stockOnHand, 7)
      const createdVariants = await prisma.productVariant.findMany({
        where: { productId: product.id },
        orderBy: { sku: 'asc' },
      })
      assert.equal(await prisma.productInventoryAdjustment.count({
        where: { variantId: createdVariants.find((variant) => variant.stockOnHand === 7)!.id, reason: 'INITIAL_STOCK' },
      }), 1)
      assert.equal(await prisma.productInventoryAdjustment.count({
        where: { variantId: createdVariants.find((variant) => variant.stockOnHand === 0)!.id, reason: 'INITIAL_STOCK' },
      }), 0)
      const relatedUpdate = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({
          images: [{ url: 'https://images.example.test/product-updated.jpg', altText: 'Updated image' }],
          specifications: [{ name: 'Finish', value: 'Matte' }],
          variants: [
            { id: createdVariants.find((variant) => variant.stockOnHand === 7)!.id, name: 'Standard revised' },
            { sku: `PRODUCT-${suffix}-NEW`, name: 'Large', stockOnHand: 2 },
          ],
        })
      assert.equal(relatedUpdate.status, 200)
      assert.equal(relatedUpdate.body.item.images.length, 1)
      assert.equal(relatedUpdate.body.item.images[0].altText, 'Updated image')
      assert.deepEqual(relatedUpdate.body.item.specifications.map((item: { name: string }) => item.name), ['Finish'])
      assert.equal(relatedUpdate.body.item.variantCount, 3)
      assert.equal(relatedUpdate.body.item.stockOnHand, 9)
      const addedVariant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: product.id, sku: `PRODUCT-${suffix}-NEW` },
      })
      assert.equal(addedVariant.lowStockThreshold, 5)
      assert.equal(await prisma.productInventoryAdjustment.count({
        where: { variantId: addedVariant.id, reason: 'INITIAL_STOCK' },
      }), 1)
      assert.equal((await request(app).get(`/api/v1/products/${product.slug}`)).status, 404)

      const sellerBProduct = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerB.token}`)
        .send(productInput('Seller B Product', category.id, `SELLER-B-${suffix}`))
      assert.equal(sellerBProduct.status, 201)
      productSlugs.push(sellerBProduct.body.item.slug as string)

      const sellerBVariant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: sellerBProduct.body.item.id, stockOnHand: 7 },
      })
      const stockedVariant = createdVariants.find((variant) => variant.stockOnHand === 7)!
      const emptyVariant = createdVariants.find((variant) => variant.stockOnHand === 0)!
      const openingEntry = await prisma.productInventoryAdjustment.findFirstOrThrow({
        where: { variantId: stockedVariant.id, reason: 'INITIAL_STOCK' },
      })
      assert.equal(openingEntry.quantityBefore, 0)
      assert.equal(openingEntry.quantityChange, 7)
      assert.equal(openingEntry.quantityAfter, 7)

      const adjustmentPath = (variantId: string) => `/api/v1/seller/products/variants/${variantId}/adjustments`
      const thresholdPath = (variantId: string) => `/api/v1/seller/products/variants/${variantId}/low-stock-threshold`
      const adjust = (variantId: string, token: string, body: Record<string, unknown>) =>
        request(app).post(adjustmentPath(variantId))
          .set('Origin', origin)
          .set('Authorization', `Bearer ${token}`)
          .send(body)

      assert.equal((await adjust(stockedVariant.id, sellerA.token, { quantityChange: 1, reason: 'NOT_A_REASON' })).status, 400)
      assert.equal((await adjust(stockedVariant.id, sellerA.token, { quantityChange: 0, reason: 'RESTOCK' })).status, 400)
      assert.equal((await adjust(stockedVariant.id, sellerA.token, { quantityChange: -8, reason: 'RESTOCK' })).status, 400)
      assert.equal((await adjust(stockedVariant.id, sellerA.token, { quantityChange: -1, reason: 'CORRECTION' })).status, 400)
      assert.equal((await request(app).post(adjustmentPath(stockedVariant.id))
        .set('Origin', origin).send({ quantityChange: 1, reason: 'RESTOCK' })).status, 401)
      assert.equal((await adjust(stockedVariant.id, customer.token, { quantityChange: 1, reason: 'RESTOCK' })).status, 403)
      assert.equal((await adjust(stockedVariant.id, unapprovedSeller.token, { quantityChange: 1, reason: 'RESTOCK' })).status, 403)
      assert.equal((await adjust(stockedVariant.id, suspendedSeller.token, { quantityChange: 1, reason: 'RESTOCK' })).status, 403)
      assert.equal((await adjust(sellerBVariant.id, sellerA.token, { quantityChange: 1, reason: 'RESTOCK' })).status, 404)

      const restock = await adjust(stockedVariant.id, sellerA.token, {
        quantityChange: 3,
        reason: 'RESTOCK',
        note: 'Supplier delivery',
      })
      assert.equal(restock.status, 201)
      assert.equal(restock.body.item.quantityBefore, 7)
      assert.equal(restock.body.item.quantityChange, 3)
      assert.equal(restock.body.item.quantityAfter, 10)
      assert.equal(restock.body.item.actor.id, sellerA.userId)
      const damage = await adjust(stockedVariant.id, sellerA.token, {
        quantityChange: -2,
        reason: 'DAMAGE',
        note: 'Two units damaged in storage',
      })
      assert.equal(damage.status, 201)
      assert.equal(damage.body.item.quantityBefore, 10)
      assert.equal(damage.body.item.quantityChange, -2)
      assert.equal(damage.body.item.quantityAfter, 8)

      const thresholdUpdate = await request(app).patch(thresholdPath(stockedVariant.id))
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ lowStockThreshold: 20 })
      assert.equal(thresholdUpdate.status, 200)
      assert.equal(thresholdUpdate.body.item.stockOnHand, 8)
      assert.equal(thresholdUpdate.body.item.lowStockThreshold, 20)
      assert.equal((await request(app).patch(thresholdPath(stockedVariant.id))
        .set('Origin', origin).set('Authorization', `Bearer ${sellerA.token}`)
        .send({ lowStockThreshold: -1 })).status, 400)
      assert.equal((await request(app).patch(thresholdPath(stockedVariant.id))
        .set('Origin', origin).set('Authorization', `Bearer ${sellerA.token}`)
        .send({ lowStockThreshold: 1.5 })).status, 400)
      assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: stockedVariant.id } })).stockOnHand, 8)
      assert.equal((await request(app).patch(thresholdPath(sellerBVariant.id))
        .set('Origin', origin).set('Authorization', `Bearer ${sellerA.token}`)
        .send({ lowStockThreshold: 50 })).status, 404)

      const foreignHistory = await request(app).get('/api/v1/seller/products/inventory-adjustments')
        .query({ variantId: sellerBVariant.id })
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(foreignHistory.status, 404)
      const history = await request(app).get('/api/v1/seller/products/inventory-adjustments')
        .query({ variantId: stockedVariant.id, page: 1, pageSize: 2 })
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(history.status, 200)
      assert.equal(history.body.pagination.total, 3)
      assert.equal(history.body.items.length, 2)
      assert.equal(history.body.items[0].reason, 'DAMAGE')
      assert.equal(history.body.items[0].variant.sku, stockedVariant.sku)
      assert.equal(history.body.items[0].variant.product.id, product.id)
      const productHistory = await request(app).get('/api/v1/seller/products/inventory-adjustments')
        .query({ productId: product.id })
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(productHistory.status, 200)
      assert.equal(productHistory.body.pagination.total, 4)
      const historySecondPage = await request(app).get('/api/v1/seller/products/inventory-adjustments')
        .query({ variantId: stockedVariant.id, page: 2, pageSize: 2 })
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(historySecondPage.body.items.length, 1)

      const lowStock = await request(app).get('/api/v1/seller/products/inventory/low-stock')
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(lowStock.status, 200)
      const lowStockTarget = lowStock.body.items.find((item: { variantId: string }) => item.variantId === stockedVariant.id)
      assert.ok(lowStockTarget)
      assert.equal(lowStockTarget.productName, product.name)
      assert.equal(lowStockTarget.sku, stockedVariant.sku)
      assert.equal(lowStockTarget.stockOnHand, 8)
      assert.equal(lowStockTarget.lowStockThreshold, 20)
      assert.equal(lowStockTarget.difference, -12)
      assert.ok(lowStock.body.items.every((item: { productId: string }) => item.productId !== sellerBProduct.body.item.id))

      rollbackTrigger = `inventory_rollback_trigger_${suffix.replaceAll('-', '')}`
      rollbackFunction = `inventory_rollback_function_${suffix.replaceAll('-', '')}`
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${rollbackFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."variantId" = '${emptyVariant.id}' THEN RAISE EXCEPTION 'forced integration ledger failure'; END IF; RETURN NEW; END $$`,
      )
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${rollbackTrigger}" BEFORE INSERT ON "ProductInventoryAdjustment" FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"()`,
      )
      const rollbackResponse = await adjust(emptyVariant.id, sellerA.token, { quantityChange: 4, reason: 'RESTOCK' })
      assert.equal(rollbackResponse.status, 500)
      assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: emptyVariant.id } })).stockOnHand, 0)
      assert.equal(await prisma.productInventoryAdjustment.count({ where: { variantId: emptyVariant.id } }), 0)
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${rollbackTrigger}" ON "ProductInventoryAdjustment"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${rollbackFunction}"()`)
      rollbackTrigger = undefined
      rollbackFunction = undefined

      const concurrentChanges = [
        ...Array.from({ length: 10 }, () => ({ quantityChange: 1, reason: 'RESTOCK' })),
        ...Array.from({ length: 4 }, () => ({ quantityChange: -1, reason: 'CORRECTION', note: 'Concurrent count correction' })),
      ]
      const concurrentResponses = await Promise.all(concurrentChanges.map((change) =>
        adjust(stockedVariant.id, sellerA.token, change)))
      assert.ok(concurrentResponses.every((response) => response.status === 201))
      const finalVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: stockedVariant.id } })
      const completeLedger = await prisma.productInventoryAdjustment.findMany({
        where: { variantId: stockedVariant.id },
      })
      assert.equal(finalVariant.stockOnHand, 14)
      assert.equal(completeLedger.length, 17)
      assert.equal(completeLedger.reduce((total, entry) => total + entry.quantityChange, 0), finalVariant.stockOnHand)
      assert.ok(completeLedger.every((entry) => entry.quantityBefore + entry.quantityChange === entry.quantityAfter))
      assert.equal(completeLedger.find((entry) => entry.id === openingEntry.id)?.quantityAfter, openingEntry.quantityAfter)

      const duplicateSku = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerB.token}`)
        .send(productInput('Duplicate SKU Product', category.id, `PRODUCT-${suffix}`))
      assert.equal(duplicateSku.status, 409)

      const secondProduct = await request(app).post('/api/v1/seller/products')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send(productInput('Integration Side Table', category.id, `SECOND-${suffix}`))
      assert.equal(secondProduct.status, 201)
      productSlugs.push(secondProduct.body.item.slug as string)

      const list = await request(app).get('/api/v1/seller/products')
        .query({ q: 'Integration', categoryId: category.id, status: 'DRAFT', moderationStatus: 'PENDING_REVIEW', page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(list.status, 200)
      assert.equal(list.body.items.length, 1)
      assert.equal(list.body.pagination.total, 2)
      assert.equal(list.body.pagination.pages, 2)
      assert.ok(list.body.items.every((item: { id: string }) => item.id !== sellerBProduct.body.item.id))

      const ownDetails = await request(app).get(`/api/v1/seller/products/${product.id}`)
        .set('Authorization', `Bearer ${sellerA.token}`)
      assert.equal(ownDetails.status, 200)
      assert.equal(ownDetails.body.item.id, product.id)
      assert.equal(ownDetails.body.item.moderationStatus, 'PENDING_REVIEW')

      for (const [method, path, body] of [
        ['get', `/api/v1/seller/products/${sellerBProduct.body.item.id}`, undefined],
        ['patch', `/api/v1/seller/products/${sellerBProduct.body.item.id}`, { name: 'Unauthorized edit' }],
        ['delete', `/api/v1/seller/products/${sellerBProduct.body.item.id}`, undefined],
      ] as const) {
        const response = request(app)[method](path)
          .set('Authorization', `Bearer ${sellerA.token}`)
        if (method !== 'get') response.set('Origin', origin)
        if (body) response.send(body)
        assert.equal((await response).status, 404)
      }

      const publish = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ status: 'PUBLISHED' })
      assert.equal(publish.status, 200)
      assert.equal(publish.body.item.moderationStatus, 'PENDING_REVIEW')
      const moderatedAt = new Date()
      await prisma.product.update({
        where: { id: product.id },
        data: {
          moderationStatus: 'APPROVED',
          moderationNote: 'Approved during integration test.',
          moderatedAt,
          moderatedById: admin.userId,
        },
      })
      assert.equal((await request(app).get(`/api/v1/products/${product.slug}`)).status, 200)

      const sellerModerationAttempt = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ moderationStatus: 'APPROVED' })
      assert.equal(sellerModerationAttempt.status, 400)
      const sellerOwnershipAttempt = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ name: 'Cannot transfer ownership', sellerId: sellerB.sellerId })
      assert.equal(sellerOwnershipAttempt.status, 400)

      const reReview = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ name: 'Integration Desk Lamp Revised' })
      assert.equal(reReview.status, 200)
      assert.equal(reReview.body.item.moderationStatus, 'PENDING_REVIEW')
      assert.equal(reReview.body.item.moderationNote, 'Approved during integration test.')
      assert.equal(new Date(reReview.body.item.moderatedAt).getTime(), moderatedAt.getTime())
      assert.equal((await request(app).get(`/api/v1/products/${product.slug}`)).status, 404)

      const disabledAt = new Date()
      await prisma.product.update({
        where: { id: product.id },
        data: {
          moderationStatus: 'DISABLED',
          moderationNote: 'Disabled for an integration test.',
          moderatedAt: disabledAt,
          moderatedById: admin.userId,
        },
      })
      const disabledEdit = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ description: 'Updated text must not override a disable decision.' })
      assert.equal(disabledEdit.status, 200)
      assert.equal(disabledEdit.body.item.moderationStatus, 'DISABLED')
      assert.equal(disabledEdit.body.item.moderationNote, 'Disabled for an integration test.')
      assert.equal(new Date(disabledEdit.body.item.moderatedAt).getTime(), disabledAt.getTime())

      const inventoryWrite = await request(app).patch(`/api/v1/seller/products/${product.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerA.token}`)
        .send({ variants: [{ id: createdVariants.find((variant) => variant.stockOnHand === 7)!.id, stockOnHand: 99 }] })
      assert.equal(inventoryWrite.status, 400)
      assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: stockedVariant.id } })).stockOnHand, 14)

      const archived = await request(app).delete(`/api/v1/seller/products/${sellerBProduct.body.item.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerB.token}`)
      assert.equal(archived.status, 200)
      assert.equal(archived.body.status, 'ARCHIVED')
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: sellerBProduct.body.item.id } })).status, 'ARCHIVED')
      const sellerBStockedVariant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: sellerBProduct.body.item.id, stockOnHand: 7 },
      })
      assert.equal(await prisma.productInventoryAdjustment.count({
        where: { variantId: sellerBStockedVariant.id, reason: 'INITIAL_STOCK' },
      }), 1)
      assert.equal((await request(app).delete(`/api/v1/seller/products/${sellerBProduct.body.item.id}`)
        .set('Origin', origin)
        .set('Authorization', `Bearer ${sellerB.token}`)).status, 409)
    } finally {
      if (databaseAvailable) {
        if (rollbackTrigger) {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "ProductInventoryAdjustment"`)
        }
        if (rollbackFunction) {
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`)
        }
        const products = await prisma.product.findMany({ where: { slug: { in: productSlugs } }, select: { id: true } })
        const productIds = products.map(({ id }) => id)
        const variants = productIds.length
          ? await prisma.productVariant.findMany({ where: { productId: { in: productIds } }, select: { id: true } })
          : []
        const variantIds = variants.map(({ id }) => id)
        if (variantIds.length) {
          await prisma.productInventoryAdjustment.deleteMany({ where: { variantId: { in: variantIds } } })
        }
        if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } })
        await prisma.category.deleteMany({ where: { slug: { in: categorySlugs } } })
        await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } })
        await prisma.sellerApplication.deleteMany({ where: { userId: { in: applicationUserIds } } })
        await prisma.seller.deleteMany({ where: { id: { in: sellerIds } } })
        await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      }
    }
  })
})
