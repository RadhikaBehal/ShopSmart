import '../src/config/env.js'
import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const salt = randomBytes(16).toString('hex')
const passwordHash = `${salt}:${scryptSync(randomBytes(32), salt, 64).toString('hex')}`

const categories = [
  { slug: 'audio', name: 'Audio' },
  { slug: 'home', name: 'Home' },
  { slug: 'photography', name: 'Photography' },
  { slug: 'accessories', name: 'Accessories' },
]

const sellers = [
  { slug: 'good-sound-co', displayName: 'Good Sound Co.', email: 'seed-audio@shopsmart.local' },
  { slug: 'form-and-field', displayName: 'Form & Field', email: 'seed-home@shopsmart.local' },
]

const products = [
  {
    slug: 'ember-bluetooth-speaker', name: 'Ember Bluetooth Speaker', categorySlug: 'audio',
    sellerSlug: 'good-sound-co', sku: 'DEMO-EMBER-001', price: 849900, stock: 12,
    images: [
      { url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=85', altText: 'Compact portable Bluetooth speaker', sortOrder: 0, isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=1200&q=85', altText: 'Close view of the speaker grille', sortOrder: 1, isPrimary: false },
    ],
    specifications: [{ name: 'Connectivity', value: 'Bluetooth', sortOrder: 0 }, { name: 'Listing type', value: 'Synthetic demonstration data', sortOrder: 1 }],
  },
  {
    slug: 'orbit-record-player', name: 'Orbit Record Player', categorySlug: 'audio',
    sellerSlug: 'good-sound-co', sku: 'DEMO-ORBIT-001', price: 2790000, stock: 4,
    images: [
      { url: 'https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=900&q=85', altText: 'Record player with a vinyl record', sortOrder: 0, isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=1200&q=85', altText: 'Detail of the record player and vinyl', sortOrder: 1, isPrimary: false },
    ],
    specifications: [{ name: 'Format', value: 'Vinyl record player', sortOrder: 0 }, { name: 'Listing type', value: 'Synthetic demonstration data', sortOrder: 1 }],
  },
  {
    slug: 'arc-table-light', name: 'Arc Table Light', categorySlug: 'home',
    sellerSlug: 'form-and-field', sku: 'DEMO-ARC-001', price: 1240000, stock: 8,
    images: [
      { url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85', altText: 'Sculptural table lamp in a warm interior', sortOrder: 0, isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=85', altText: 'Detail of the sculptural table lamp', sortOrder: 1, isPrimary: false },
    ],
    specifications: [{ name: 'Room', value: 'Home', sortOrder: 0 }, { name: 'Listing type', value: 'Synthetic demonstration data', sortOrder: 1 }],
  },
]

async function seed() {
  for (const category of categories) {
    await prisma.category.upsert({ where: { slug: category.slug }, update: { name: category.name }, create: category })
  }

  for (const seller of sellers) {
    const user = await prisma.user.upsert({
      where: { email: seller.email },
      update: {},
      create: { email: seller.email, passwordHash, displayName: `${seller.displayName} demo account`, role: 'SELLER' },
    })
    await prisma.seller.upsert({
      where: { slug: seller.slug },
      update: { displayName: seller.displayName },
      create: { userId: user.id, slug: seller.slug, displayName: seller.displayName, status: 'VERIFIED' },
    })
  }

  for (const product of products) {
    const [category, seller] = await Promise.all([
      prisma.category.findUniqueOrThrow({ where: { slug: product.categorySlug } }),
      prisma.seller.findUniqueOrThrow({ where: { slug: product.sellerSlug } }),
    ])
    const savedProduct = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        name: product.name,
        basePriceMinor: product.price,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      create: {
        slug: product.slug,
        name: product.name,
        description: `${product.name}, included as clearly labelled synthetic demonstration catalog data.`,
        basePriceMinor: product.price,
        status: 'PUBLISHED',
        moderationStatus: 'APPROVED',
        publishedAt: new Date(),
        categoryId: category.id,
        sellerId: seller.id,
        variants: { create: { sku: product.sku, name: 'One size', stockOnHand: product.stock } },
      },
    })

    for (const image of product.images) {
      await prisma.productImage.upsert({
        where: { productId_sortOrder: { productId: savedProduct.id, sortOrder: image.sortOrder } },
        update: image,
        create: { ...image, productId: savedProduct.id },
      })
    }

    for (const specification of product.specifications) {
      await prisma.productSpecification.upsert({
        where: { productId_name: { productId: savedProduct.id, name: specification.name } },
        update: { value: specification.value, sortOrder: specification.sortOrder },
        create: { ...specification, productId: savedProduct.id },
      })
    }
  }
}

seed()
  .catch((error: unknown) => {
    console.error('Demo seed failed', error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
