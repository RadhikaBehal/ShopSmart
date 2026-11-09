import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SellerWorkspace } from './SellerWorkspace'

let root: Root | undefined
let container: HTMLDivElement

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

const product = {
  id: 'product-1',
  slug: 'woven-basket',
  name: 'Woven basket',
  description: 'A handwoven storage basket.',
  basePriceMinor: 259900,
  currency: 'INR',
  status: 'PUBLISHED',
  moderationStatus: 'APPROVED',
  moderationNote: null,
  moderatedAt: null,
  category: { id: 'category-1', name: 'Home', slug: 'home' },
  images: [{ id: 'image-1', url: 'https://images.example.test/basket.jpg', altText: null, isPrimary: true }],
  specifications: [],
  variants: [{
    id: 'variant-1',
    sku: 'BASKET-01',
    name: 'Standard',
    priceMinor: null,
    stockOnHand: 2,
    lowStockThreshold: 5,
    status: 'ACTIVE',
  }],
  variantCount: 1,
  stockOnHand: 2,
}

function response(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 })
}

describe('seller workspace', () => {
  it('shows seller-scoped products and low-stock inventory', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname.endsWith('/categories')) {
        return response({ items: [{ id: 'category-1', name: 'Home', slug: 'home', parentId: null }] })
      }
      if (url.pathname.endsWith('/inventory/low-stock')) {
        return response({
          items: [{
            variantId: 'variant-1',
            productId: 'product-1',
            productName: 'Woven basket',
            sku: 'BASKET-01',
            stockOnHand: 2,
            lowStockThreshold: 5,
            difference: -3,
          }],
          pagination: { page: 1, pageSize: 50, total: 1, pages: 1 },
        })
      }
      return response({ items: [product], pagination: { page: 1, pageSize: 50, total: 1, pages: 1 } })
    }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(SellerWorkspace, {
        accessToken: 'seller-access-token',
        role: 'SELLER',
        onBack: vi.fn(),
        onStoreSettings: vi.fn(),
        onLogout: vi.fn(),
      }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('Woven basket')
    expect(container.textContent).toContain('Total products')
    const inventoryButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Inventory'))
    expect(inventoryButton).toBeDefined()

    await act(async () => {
      inventoryButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('BASKET-01')
    expect(container.textContent).toContain('Low-stock items')
    expect(container.textContent).toContain('2')
  })

  it('does not render seller data for a non-seller role', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(createElement(SellerWorkspace, {
        accessToken: 'customer-access-token',
        role: 'CUSTOMER',
        onBack: vi.fn(),
        onStoreSettings: vi.fn(),
        onLogout: vi.fn(),
      }))
    })

    expect(container.textContent).toContain('Seller access required')
    expect(container.textContent).not.toContain('Inventory')
  })
})
