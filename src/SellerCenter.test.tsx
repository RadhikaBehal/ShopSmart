import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SellerCenter } from './SellerCenter'
import { SellerStorefront } from './SellerStorefront'

let root: Root | undefined
let container: HTMLDivElement

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('seller experiences', () => {
  it('renders an application form and never claims verification documents are collected', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ application: null }), { status: 200 })))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(SellerCenter, {
        accessToken: 'customer-access',
        role: 'CUSTOMER',
        userEmail: 'customer@example.test',
        onBack: vi.fn(),
      }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('Build your independent store.')
    expect(container.textContent).toContain('No identity documents are collected.')
    expect(container.querySelector('input[aria-label="Store URL slug"]')).not.toBeNull()
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Save draft'))).toBe(true)
    expect([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Submit for review'))?.disabled).toBe(true)
  })

  it('renders a public storefront from the seller and catalog APIs', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === '/api/v1/stores/northwind-goods') {
        return new Response(JSON.stringify({
          store: {
            slug: 'northwind-goods',
            displayName: 'Northwind Goods',
            description: 'Independent makers creating useful things that last.',
            businessType: 'INDIVIDUAL',
            contactEmail: 'hello@example.test',
            contactPhone: null,
            logoUrl: null,
            bannerUrl: null,
            shippingPolicy: 'Ships within three days.',
            returnPolicy: null,
            status: 'VERIFIED',
            verificationStatus: 'VERIFIED',
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [{
          id: 'product-1',
          slug: 'woven-basket',
          name: 'Woven basket',
          description: 'A database product.',
          images: [],
          basePriceMinor: 259900,
          currency: 'INR',
          category: { name: 'Home', slug: 'home' },
          seller: { displayName: 'Northwind Goods', slug: 'northwind-goods', status: 'VERIFIED' },
          specifications: [],
          variants: [],
          rating: null,
          reviewCount: 0,
          stockOnHand: 0,
          available: false,
        }],
        pagination: { page: 1, pageSize: 50, total: 1, pages: 1 },
      }), { status: 200 })
    }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(SellerStorefront, { slug: 'northwind-goods' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('Northwind Goods')
    expect(container.textContent).toContain('Verified seller')
    expect(container.textContent).toContain('Woven basket')
    expect(container.textContent).toContain('₹2,599')
    expect(container.textContent).toContain('Ships within three days.')
  })
})
