import { motion } from 'framer-motion'
import { ArrowUpRight, Heart, Plus, Star } from 'lucide-react'
import type { CatalogProduct } from './catalogApi'
import { ProductImage } from './ProductImage'

type CatalogProductCardProps = {
  product: CatalogProduct
  favorite: boolean
  cartQuantity: number
  onToggleFavorite: (id: string) => void
  onViewDetails: (product: CatalogProduct) => void
  onAddToCart: (product: CatalogProduct) => void
  formatPrice: (amountMinor: number, currency: string) => string
}

export function CatalogProductCard({
  product,
  favorite,
  cartQuantity,
  onToggleFavorite,
  onViewDetails,
  onAddToCart,
  formatPrice,
}: CatalogProductCardProps) {
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0]

  return (
    <motion.article
      className="product-card"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.24 }}
    >
      <div className="product-visual">
        <ProductImage className="catalog-product-image" src={image?.url ?? null} alt={image?.altText ?? product.name} />
        <button
          type="button"
          className={`favorite-button ${favorite ? 'is-favorite' : ''}`}
          aria-label={`${favorite ? 'Remove' : 'Add'} ${product.name} ${favorite ? 'from' : 'to'} wishlist`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(product.id)}
        >
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="view-details" onClick={() => onViewDetails(product)}>
          View details <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          className="quick-add"
          disabled={!product.available || cartQuantity >= product.stockOnHand}
          onClick={() => onAddToCart(product)}
        >
          {product.available ? (cartQuantity >= product.stockOnHand ? 'Maximum in bag' : 'Add to bag') : 'Out of stock'}
          <Plus size={14} />
        </button>
      </div>
      <div className="product-meta">
        <span>{product.category.name} <span className="meta-dot">·</span> <a className="seller-store-link" href={`#store/${product.seller.slug}`}>{product.seller.displayName}</a></span>
        <span
          className="rating"
          aria-label={product.rating === null ? 'No product rating yet' : `Rated ${product.rating.toFixed(1)} out of 5`}
        >
          <Star size={12} fill="currentColor" /> {product.rating === null ? 'New' : product.rating.toFixed(1)}
        </span>
      </div>
      <h3>{product.name}</h3>
      <div className="price-line"><b>{formatPrice(product.basePriceMinor, product.currency)}</b></div>
      <div className="review-line">
        <span>{product.reviewCount ? `${product.reviewCount} reviews` : 'No reviews yet'}</span>
        <span>{product.available ? `${product.stockOnHand} available` : 'Out of stock'}</span>
      </div>
    </motion.article>
  )
}
