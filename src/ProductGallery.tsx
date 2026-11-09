import { useState } from 'react'
import type { CatalogProductImage } from './catalogApi'
import { ProductImage } from './ProductImage'

type ProductGalleryProps = {
  productName: string
  images: CatalogProductImage[]
}

export function ProductGallery({ productName, images }: ProductGalleryProps) {
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const selectedImage = images.find((image) => image.id === selectedImageId)
    ?? images.find((image) => image.isPrimary)
    ?? images[0]

  return (
    <div className="product-gallery">
      <ProductImage
        className="detail-image"
        src={selectedImage?.url ?? null}
        alt={selectedImage?.altText ?? productName}
      />
      {images.length > 1 && <div className="gallery-thumbnails" aria-label={`${productName} product images`}>
        {images.map((image, index) => (
          <button
            type="button"
            key={image.id}
            className={`gallery-thumbnail ${image.id === selectedImage?.id ? 'active' : ''}`}
            aria-label={`Show product image ${index + 1}${image.isPrimary ? ', primary image' : ''}`}
            aria-pressed={image.id === selectedImage?.id}
            onClick={() => setSelectedImageId(image.id)}
          >
            <ProductImage className="gallery-thumbnail-image" src={image.url} alt="" />
          </button>
        ))}
      </div>}
    </div>
  )
}
