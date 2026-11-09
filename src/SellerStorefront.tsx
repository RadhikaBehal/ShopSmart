import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, ExternalLink, MapPin, Store } from 'lucide-react'
import { getProducts, type CatalogProduct } from './catalogApi'
import { ProductImage } from './ProductImage'
import { getPublicSellerStore, type SellerStore } from './sellerApi'

const formatPrice = (amountMinor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(amountMinor / 100)

export function SellerStorefront({ slug }: { slug: string }) {
  const [store, setStore] = useState<SellerStore | null>(null)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedSlug, setLoadedSlug] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([getPublicSellerStore(slug), getProducts({ seller: slug, pageSize: 50 })]).then(([publicStore, catalog]) => {
      if (active) {
        setStore(publicStore)
        setProducts(catalog.items)
        setError('')
        setLoadedSlug(slug)
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : 'This storefront could not be loaded.')
        setLoadedSlug(slug)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [slug, retry])
  const isLoading = loading || loadedSlug !== slug

  return (
    <main className="seller-storefront">
      <header className="seller-store-header">
        <a className="wordmark" href="#discover" aria-label="Back to ShopSmart">shopsmart</a>
        <a className="seller-back-link" href="#discover"><ArrowLeft size={15} /> Discover</a>
      </header>
      {isLoading && <p className="catalog-state" role="status">Loading this independent store…</p>}
      {!isLoading && error && <div className="catalog-state catalog-error" role="alert"><p>{error}</p><button className="button button-outline" onClick={() => { setError(''); setRetry((current) => current + 1) }}>Try again <ArrowRight size={14} /></button></div>}
      {!isLoading && !error && store && (
        <>
          <section className="public-store-hero">
            {store.bannerUrl ? <img src={store.bannerUrl} alt="" className="public-store-banner" /> : <div className="public-store-banner public-store-banner-placeholder"><Store size={32} /><span>Independent by nature</span></div>}
            <div className="public-store-intro">
              <span className="public-store-mark">{store.logoUrl ? <img src={store.logoUrl} alt="" /> : <Store size={25} />}</span>
              <div><p className="eyebrow"><span className="eyebrow-line" /> INDEPENDENT SELLER</p><h1>{store.displayName}</h1>
                <p className="public-store-description">{store.description}</p>
                <span className="seller-status seller-status-approved"><BadgeCheck size={14} /> Verified seller</span>
              </div>
            </div>
          </section>
          <section className="public-store-content">
            <div className="public-store-products-heading"><div><p className="eyebrow">THE STORE EDIT</p><h2>Products from {store.displayName}</h2></div><span>{products.length} published item{products.length === 1 ? '' : 's'}</span></div>
            {products.length === 0
              ? <div className="seller-empty-state"><Store size={21} /><b>This store is getting ready.</b><p>There are no published products available just yet.</p></div>
              : <div className="product-grid public-store-products">{products.map((product) => {
                const image = product.images.find((item) => item.isPrimary) ?? product.images[0]
                return <article className="public-store-product" key={product.id}>
                  <div className="public-store-product-image"><ProductImage className="public-store-product-media" src={image?.url ?? null} alt={image?.altText ?? product.name} /></div>
                  <p>{product.category.name} · {product.available ? `${product.stockOnHand} available` : 'Out of stock'}</p>
                  <h3>{product.name}</h3>
                  <b>{formatPrice(product.basePriceMinor, product.currency)}</b>
                </article>
              })}</div>}
            <aside className="public-store-contact">
              <div><p className="eyebrow">A NOTE FROM THE MAKER</p><h3>Good things, from good people.</h3></div>
              <div className="public-store-contact-details">
                {store.contactEmail && <a href={`mailto:${store.contactEmail}`}><ExternalLink size={14} /> {store.contactEmail}</a>}
                {store.contactPhone && <a href={`tel:${store.contactPhone}`}><ExternalLink size={14} /> {store.contactPhone}</a>}
                {!store.contactEmail && !store.contactPhone && <p>Contact details have not been published.</p>}
              </div>
            </aside>
            {(store.shippingPolicy || store.returnPolicy) && <section className="public-store-policies" aria-label="Store policies">
              {store.shippingPolicy && <div><h4>Shipping</h4><p>{store.shippingPolicy}</p></div>}
              {store.returnPolicy && <div><h4>Returns</h4><p>{store.returnPolicy}</p></div>}
            </section>}
          </section>
        </>
      )}
      <footer className="public-store-footer"><a href="#discover"><ArrowLeft size={14} /> Return to ShopSmart</a><span><MapPin size={13} /> Independent sellers, thoughtfully found</span></footer>
    </main>
  )
}
