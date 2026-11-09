import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CatalogProductCard } from './CatalogProductCard'
import type { CatalogProduct } from './catalogApi'

const product: CatalogProduct = {
  id: 'product-1',
  slug: 'ember-speaker',
  name: 'Ember Bluetooth Speaker',
  description: 'Compact speaker from the database.',
  images: [],
  basePriceMinor: 849900,
  currency: 'INR',
  category: { name: 'Audio', slug: 'audio' },
  seller: { displayName: 'Good Sound Co.', slug: 'good-sound-co', status: 'VERIFIED' },
  specifications: [{ id: 'spec-1', name: 'Connectivity', value: 'Bluetooth', sortOrder: 0 }],
  variants: [{ id: 'variant-1', sku: 'SKU-1', name: 'Graphite', priceMinor: null, stockOnHand: 4 }],
  rating: 4.5,
  reviewCount: 2,
  stockOnHand: 4,
  available: true,
}

let root: Root | undefined
let container: HTMLDivElement

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('catalog product rendering', () => {
  it('renders database fields, correct currency units, inventory and image fallback', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CatalogProductCard, {
      product,
      favorite: false,
      cartQuantity: 0,
      onToggleFavorite: vi.fn(),
      onViewDetails: vi.fn(),
      onAddToCart: vi.fn(),
      formatPrice: (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString('en-IN')}`,
    })))

    expect(container.textContent).toContain('Ember Bluetooth Speaker')
    expect(container.textContent).toContain('Good Sound Co.')
    expect(container.textContent).toContain('INR 8,499')
    expect(container.textContent).toContain('4 available')
    expect(container.textContent).toContain('2 reviews')
    expect(container.querySelector('.image-fallback')?.textContent).toContain('Image unavailable')
    expect(container.querySelector('.rating')?.getAttribute('aria-label')).toBe('Rated 4.5 out of 5')
  })

  it('prevents adding unavailable stock and exposes the current state to assistive technology', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const unavailableProduct = { ...product, available: false, stockOnHand: 0, rating: null, reviewCount: 0 }

    await act(async () => root?.render(createElement(CatalogProductCard, {
      product: unavailableProduct,
      favorite: false,
      cartQuantity: 0,
      onToggleFavorite: vi.fn(),
      onViewDetails: vi.fn(),
      onAddToCart: vi.fn(),
      formatPrice: (minor: number, currency: string) => `${currency} ${minor / 100}`,
    })))

    const addButton = container.querySelector<HTMLButtonElement>('.quick-add')
    expect(addButton?.disabled).toBe(true)
    expect(addButton?.textContent).toContain('Out of stock')
    expect(container.textContent).toContain('No reviews yet')
  })
})
