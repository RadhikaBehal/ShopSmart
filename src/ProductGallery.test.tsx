import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductGallery } from './ProductGallery'

let root: Root | undefined
let container: HTMLDivElement

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('database product image gallery', () => {
  it('uses the primary image and switches to other stored images', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ProductGallery, {
      productName: 'Database product',
      images: [
        { id: 'secondary', url: 'https://images.example.test/secondary.jpg', altText: 'Side view', sortOrder: 1, isPrimary: false },
        { id: 'primary', url: 'https://images.example.test/primary.jpg', altText: 'Front view', sortOrder: 0, isPrimary: true },
      ],
    })))

    expect(container.querySelector<HTMLImageElement>('.detail-image')?.src).toBe('https://images.example.test/primary.jpg')
    const sideImage = container.querySelector<HTMLButtonElement>('[aria-label="Show product image 1"]')
    await act(async () => sideImage?.click())
    expect(container.querySelector<HTMLImageElement>('.detail-image')?.src).toBe('https://images.example.test/secondary.jpg')
    expect(sideImage?.getAttribute('aria-pressed')).toBe('true')
  })
})
