import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownWideNarrow, ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, Heart, Leaf, Menu, Minus, Plus, Search,
  ShieldCheck, ShoppingBag, Sparkles, Star, Truck, UserRound, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { AccountPanel, type AccountAction } from './AccountPanel'
import { getCategories, getProduct, getProducts, type CatalogCategory, type CatalogProduct } from './catalogApi'
import { CatalogProductCard } from './CatalogProductCard'
import { interpretCatalogQuery } from './catalogSearch'
import { getDemoStorage, isDemoCart, isDemoWishlist, readDemoValue, writeDemoValue } from './demoPersistence'
import { ProductImage } from './ProductImage'
import { ProductGallery } from './ProductGallery'
import { SellerStorefront } from './SellerStorefront'
import './App.css'

type Product = CatalogProduct
function initialAccountLink(): { action: AccountAction; token: string } | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const action = url.searchParams.get('authAction')
  const token = url.searchParams.get('token')
  return (action === 'verify' || action === 'reset') && token ? { action, token } : null
}

function currentStoreSlug(): string {
  const match = window.location.hash.match(/^#store\/([^/?#]+)$/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(amountMinor / 100)

function App() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [availableOnly, setAvailableOnly] = useState(false)
  const [sort, setSort] = useState<'newest' | 'price-asc' | 'price-desc' | 'rating'>('newest')
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [knownProducts, setKnownProducts] = useState<Record<string, Product>>({})
  const [catalogPage, setCatalogPage] = useState({ page: 1, pageSize: 8, total: 0, pages: 0 })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [categoriesError, setCategoriesError] = useState('')
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [categoriesRetry, setCategoriesRetry] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const [favorites, setFavorites] = useState<string[]>(() => readDemoValue(getDemoStorage(), 'shopsmart-catalog-wishlist', [], isDemoWishlist).value)
  const [cart, setCart] = useState<Record<string, number>>(() => readDemoValue(getDemoStorage(), 'shopsmart-catalog-cart', {}, isDemoCart).value)
  const [cartOpen, setCartOpen] = useState(false)
  const [accountLink, setAccountLink] = useState(initialAccountLink)
  const [accountOpen, setAccountOpen] = useState(() => initialAccountLink() !== null)
  const [storeSlug, setStoreSlug] = useState(currentStoreSlug)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notice, setNotice] = useState(() => (
    readDemoValue(getDemoStorage(), 'shopsmart-catalog-wishlist', [], isDemoWishlist).notice
    ?? readDemoValue(getDemoStorage(), 'shopsmart-catalog-cart', {}, isDemoCart).notice
    ?? ''
  ))

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('authAction') && url.searchParams.has('token')) {
      url.searchParams.delete('authAction')
      url.searchParams.delete('token')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])

  useEffect(() => {
    const syncStoreRoute = () => {
      setStoreSlug(currentStoreSlug())
    }
    window.addEventListener('hashchange', syncStoreRoute)
    return () => window.removeEventListener('hashchange', syncStoreRoute)
  }, [])

  useEffect(() => {
    let active = true
    const intent = interpretCatalogQuery(search)
    getProducts({
      q: intent.terms.join(' ') || undefined,
      category,
      available: availableOnly ? true : undefined,
      maxPriceMinor: intent.maxPrice === undefined ? undefined : intent.maxPrice * 100,
      page: catalogPage.page,
      pageSize: catalogPage.pageSize,
      sort,
    }).then((result) => {
      if (!active) return
      setCatalogError('')
      setProducts(result.items)
      setCatalogPage(result.pagination)
      setKnownProducts((existing) => ({
        ...existing,
        ...Object.fromEntries(result.items.map((product) => [product.id, product])),
      }))
    }).catch((error: unknown) => {
      if (active) setCatalogError(error instanceof Error ? error.message : 'The catalog could not be loaded.')
    }).finally(() => {
      if (active) setCatalogLoading(false)
    })
    return () => { active = false }
  }, [category, availableOnly, search, sort, catalogPage.page, catalogPage.pageSize, catalogRetry])

  useEffect(() => {
    let active = true
    getCategories().then((items) => {
      if (active) {
        setCategories(items)
        setCategoriesError('')
      }
    }).catch((error: unknown) => {
      if (active) setCategoriesError(error instanceof Error ? error.message : 'Categories could not be loaded.')
    })
    return () => { active = false }
  }, [categoriesRetry])

  const selectedSlug = selectedProduct?.slug
  useEffect(() => {
    let active = true
    if (!selectedSlug) return () => { active = false }
    getProduct(selectedSlug).then((product) => {
      if (active) {
        setDetailProduct(product)
        setKnownProducts((existing) => ({ ...existing, [product.id]: product }))
      }
    }).catch((error: unknown) => {
      if (active) setDetailError(error instanceof Error ? error.message : 'Product details could not be loaded.')
    }).finally(() => {
      if (active) setDetailLoading(false)
    })
    return () => { active = false }
  }, [selectedSlug, detailRetry])

  const cartItems = Object.entries(cart)
    .map(([id, quantity]) => ({ product: knownProducts[id], quantity }))
    .filter((item): item is { product: Product; quantity: number } => item.product !== undefined)
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotals = cartItems.reduce<Record<string, number>>((totals, item) => {
    totals[item.product.currency] = (totals[item.product.currency] ?? 0) + item.product.basePriceMinor * item.quantity
    return totals
  }, {})
  function openProductDetails(product: Product) {
    setDetailProduct(null)
    setDetailLoading(true)
    setDetailError('')
    setSelectedProduct(product)
  }

  function closeProductDetails() {
    setSelectedProduct(null)
    setDetailProduct(null)
    setDetailLoading(false)
    setDetailError('')
  }

  function openAccount() {
    setAccountLink(null)
    setAccountOpen(true)
  }

  function findSomething(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = query.trim()
    setCatalogLoading(true)
    setCatalogError('')
    setCatalogRetry((retry) => retry + 1)
    setSearch(term)
    const inferredCategory = interpretCatalogQuery(term).category
    if (inferredCategory) {
      const selected = categories.find((item) => item.name.toLowerCase() === inferredCategory.toLowerCase())
      setCategory(selected?.slug ?? '')
    } else {
      setCategory('')
    }
    setCatalogPage((current) => ({ ...current, page: 1 }))
    document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' })
  }

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]
    setFavorites(next)
    const storageNotice = writeDemoValue(getDemoStorage(), 'shopsmart-catalog-wishlist', next)
    if (storageNotice) setNotice(storageNotice)
  }

  function addToCart(product: Product) {
    if (!product.available) {
      setNotice('This product is currently out of stock.')
      return
    }
    if ((cart[product.id] ?? 0) >= product.stockOnHand) {
      setNotice('The available quantity is already in your bag.')
      return
    }
    const next = { ...cart, [product.id]: (cart[product.id] ?? 0) + 1 }
    setCart(next)
    const storageNotice = writeDemoValue(getDemoStorage(), 'shopsmart-catalog-cart', next)
    setNotice(storageNotice ?? `${product.name} added to your bag`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function changeQuantity(id: string, delta: number) {
    const quantity = (cart[id] ?? 0) + delta
    const product = knownProducts[id]
    if (delta > 0 && product && quantity > product.stockOnHand) {
      setNotice('The available quantity is already in your bag.')
      return
    }
    const next = { ...cart }
    if (quantity <= 0) delete next[id]
    else next[id] = quantity
    setCart(next)
    const storageNotice = writeDemoValue(getDemoStorage(), 'shopsmart-catalog-cart', next)
    if (storageNotice) setNotice(storageNotice)
  }

  function removeFromCart(id: string) {
    const next = { ...cart }
    delete next[id]
    setCart(next)
    const storageNotice = writeDemoValue(getDemoStorage(), 'shopsmart-catalog-cart', next)
    if (storageNotice) setNotice(storageNotice)
  }

  if (storeSlug) return <SellerStorefront slug={storeSlug} />

  return (
    <div className="storefront">
      <div className="announcement"><span>LIVE DATABASE CATALOG · SYNTHETIC DEMO LISTINGS · CHECKOUT DISABLED</span></div>
      <header className="site-header">
        <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><Menu size={21} /></button>
        <a className="wordmark" href="#" aria-label="ShopSmart home">shopsmart</a>
        <nav className={`main-nav ${mobileMenuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <a href="#discover" onClick={() => setMobileMenuOpen(false)}>Discover</a>
          <a href="#discover" onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setCategory(''); setSearch(''); setQuery(''); setMobileMenuOpen(false); setCatalogPage((current) => ({ ...current, page: 1 })) }}>The edit</a>
          <a href="#principles" onClick={() => setMobileMenuOpen(false)}>Our point of view</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button search-trigger" aria-label="Search products" onClick={() => document.getElementById('smart-search')?.focus()}><Search size={20} /></button>
          <button className="icon-button account-trigger" aria-label="Account" onClick={openAccount}><UserRound size={19} /></button>
          <button className="icon-button bag-trigger" aria-label={`Open shopping bag, ${cartCount} items`} onClick={() => setCartOpen(true)}><ShoppingBag size={20} /><span className="bag-count">{cartCount}</span></button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> A MORE CONSIDERED WAY TO SHOP</div>
            <h1>Find what<br />feels <em>right.</em></h1>
            <p>Good things, from good people. Discover pieces made to be loved longer — chosen with a little more thought.</p>
            <a className="button button-dark hero-button" href="#discover">Explore the edit <ArrowRight size={16} /></a>
            <div className="hero-proof"><span className="demo-proof-mark"><Sparkles size={13} /></span><span><b>ShopSmart concept</b> — independent-seller marketplace</span></div>
          </div>
          <div className="hero-art" role="img" aria-label="Considered objects in a calm, sunlit living room">
            <div className="hero-image" />
            <div className="hero-stamp"><span>GOOD DESIGN<br />GOOD INTENT</span><span className="stamp-star">✳</span></div>
            <div className="hero-caption"><span>THE SLOW LIVING EDIT</span><span>01 — 04</span></div>
          </div>
          <div className="hero-side-note">A MARKETPLACE FOR KEEPERS <span>·</span> DEMO COLLECTION</div>
        </section>

        <section className="principles" id="principles" aria-label="Marketplace principles">
          <div><span className="principle-icon"><BadgeCheck size={18} /></span><span><b>Independent makers</b><small>People behind every product</small></span></div>
          <div><span className="principle-icon"><ShieldCheck size={18} /></span><span><b>Thoughtfully vetted</b><small>Quality over everything</small></span></div>
          <div><span className="principle-icon"><Leaf size={18} /></span><span><b>Made to last</b><small>Better things, less often</small></span></div>
          <div><span className="principle-icon"><Truck size={18} /></span><span><b>Delivery, when connected</b><small>Checkout is not live yet</small></span></div>
        </section>

        <section className="discovery" id="discover">
          <div className="section-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> THE SHOPSMART EDIT</div><h2>Objects with <em>a point of view.</em></h2></div>
            <a className="text-link desktop-link" href="#discover" onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setCategory(''); setSearch(''); setQuery(''); setCatalogPage((current) => ({ ...current, page: 1 })) }}>View the whole edit <ArrowUpRight size={16} /></a>
          </div>
          <form className="search-panel" onSubmit={findSomething}>
            <Sparkles size={19} className="search-sparkle" />
            <input id="smart-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, sellers, categories or set a budget…" aria-label="Search products, sellers, categories or by budget" />
            <span className="search-hint">SEARCH THE LIVE CATALOG</span>
            <button type="submit" className="search-submit" aria-label="Search"><ArrowRight size={18} /></button>
          </form>
          <div className="discovery-controls">
            <div className="category-list" role="tablist" aria-label="Filter by category">
              <button type="button" role="tab" aria-selected={!category} className={`category-tab ${!category ? 'active' : ''}`} onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setCategory(''); setSearch(''); setQuery(''); setCatalogPage((current) => ({ ...current, page: 1 })) }}>Everything</button>
              {categories.map((item) => <button type="button" key={item.slug} role="tab" aria-selected={category === item.slug} className={`category-tab ${category === item.slug ? 'active' : ''}`} onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setCategory(item.slug); setSearch(''); setQuery(''); setCatalogPage((current) => ({ ...current, page: 1 })) }}>{item.name}</button>)}
            </div>
            <label className="inventory-filter"><input type="checkbox" checked={availableOnly} onChange={(event) => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setAvailableOnly(event.target.checked); setCatalogPage((current) => ({ ...current, page: 1 })) }} /> In stock</label>
            <label className="sort-select"><ArrowDownWideNarrow size={15} /><span className="sr-only">Sort products</span><select value={sort} onChange={(event) => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setSort(event.target.value as typeof sort); setCatalogPage((current) => ({ ...current, page: 1 })) }}><option value="newest">Newest arrivals</option><option value="rating">Top rated</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select><ChevronDown size={14} /></label>
          </div>
          {categoriesError && <p className="catalog-inline-error" role="alert">{categoriesError} <button type="button" onClick={() => setCategoriesRetry((retry) => retry + 1)}>Retry categories</button></p>}
          <div className="result-line"><span>{search ? <>A few good matches for <b>“{search}”</b></> : 'A few things we think you’ll love'}</span><span>{catalogPage.total.toString().padStart(2, '0')} PIECES</span></div>
          {catalogError ? (
            <div className="catalog-error" role="alert"><h3>We couldn’t reach the catalog.</h3><p>{catalogError}</p><button className="button button-dark" onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1) }}>Retry catalog <ArrowRight size={15} /></button></div>
          ) : catalogLoading ? (
            <div className="product-grid" aria-label="Loading products" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => <div className="product-skeleton" key={index}><div className="skeleton-image" /><div className="skeleton-line" /><div className="skeleton-line short" /><div className="skeleton-line narrow" /></div>)}
            </div>
          ) : products.length ? (
            <div className="product-grid">
              <AnimatePresence mode="popLayout">
                {products.map((product) => <CatalogProductCard
                  key={product.id}
                  product={product}
                  favorite={favorites.includes(product.id)}
                  cartQuantity={cart[product.id] ?? 0}
                  onToggleFavorite={toggleFavorite}
                  onViewDetails={openProductDetails}
                  onAddToCart={addToCart}
                  formatPrice={money}
                />)}
              </AnimatePresence>
            </div>
          ) : (
            <div className="empty-state"><span className="empty-icon"><Search size={24} /></span><h3>No products match those filters.</h3><p>Try a different search or clear your filters to see all available products.</p><button className="button button-dark" onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry((retry) => retry + 1); setSearch(''); setQuery(''); setCategory(''); setCatalogPage((current) => ({ ...current, page: 1 })) }}>Clear filters <ArrowRight size={15} /></button></div>
          )}
          {!catalogLoading && !catalogError && catalogPage.pages > 1 && <nav className="catalog-pagination" aria-label="Product pages"><button className="button button-outline" disabled={catalogPage.page <= 1} onClick={() => { setCatalogLoading(true); setCatalogRetry((retry) => retry + 1); setCatalogPage((current) => ({ ...current, page: current.page - 1 })) }}><ChevronLeft size={15} /> Previous</button><span>Page {catalogPage.page} of {catalogPage.pages}</span><button className="button button-outline" disabled={catalogPage.page >= catalogPage.pages} onClick={() => { setCatalogLoading(true); setCatalogRetry((retry) => retry + 1); setCatalogPage((current) => ({ ...current, page: current.page + 1 })) }}>Next <ChevronRight size={15} /></button></nav>}
        </section>

        <section className="editorial">
          <div className="editorial-image" role="img" aria-label="Handmade ceramic objects arranged in warm natural light" />
          <div className="editorial-copy"><div className="eyebrow"><span className="eyebrow-line" /> OBJECTS WITH A SECOND LIFE</div><h2>Good things<br />deserve <em>another.</em></h2><p>A well-loved piece can find a whole new home. Our circular edit brings together pre-loved, repaired and ready-to-love-again finds.</p><button className="text-link" onClick={() => setNotice('The circular edit is coming soon. This collection is still being curated.')}>Meet the circular edit <ArrowRight size={16} /></button></div>
          <div className="editorial-index">A DIFFERENT KIND OF NEW <span>02 / 04</span></div>
        </section>

        <section className="newsletter">
          <span className="newsletter-star">✳</span><div><div className="eyebrow">A NOTE FROM SHOPSMART</div><h2>Less noise. <em>Better finds.</em></h2><p>Little discoveries and good things worth knowing about. Never the other stuff.</p></div><form onSubmit={(event) => { event.preventDefault(); setNotice('Newsletter sign-up is not connected in this demo. Your email was not saved.') }}><label className="sr-only" htmlFor="newsletter-email">Your email address</label><input id="newsletter-email" type="email" placeholder="Your email address" required /><button type="submit" aria-label="Join the newsletter"><ArrowRight size={18} /></button></form>
        </section>
      </main>

      <footer className="site-footer"><a className="wordmark" href="#">shopsmart</a><span>Good things, found together.</span><span>© 2026 SHOPSMART DEMO</span><button className="help-link" onClick={() => setNotice('Help and support will be available when ShopSmart launches.')}><CircleHelp size={15} /> A little help</button></footer>

      <AnimatePresence>
        {cartOpen && <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
          <motion.aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-heading" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.28 }}>
            <div className="drawer-heading"><div><div className="eyebrow">A FEW GOOD THINGS</div><h2 id="cart-heading">Your bag <span>({cartCount})</span></h2></div><button className="icon-button" aria-label="Close shopping bag" onClick={() => setCartOpen(false)}><X size={20} /></button></div>
            {cartItems.length ? <>
              <div className="drawer-items">{cartItems.map(({ product, quantity }) => { const image = product.images.find((item) => item.isPrimary) ?? product.images[0]; return <div className="cart-item" key={product.id}><ProductImage className="cart-item-image" src={image?.url ?? null} alt={image?.altText ?? product.name} /><div className="cart-item-info"><span>{product.category.name}</span><b>{product.name}</b><strong>{money(product.basePriceMinor, product.currency)}</strong><div className="quantity-control"><button aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product.id, -1)}><Minus size={13} /></button><span>{quantity}</span><button aria-label={`Add one ${product.name}`} onClick={() => changeQuantity(product.id, 1)} disabled={quantity >= product.stockOnHand}><Plus size={13} /></button></div></div><button className="remove-item" aria-label={`Remove ${product.name}`} onClick={() => removeFromCart(product.id)}><X size={15} /></button></div> })}</div>
              <div className="drawer-bottom"><div className="shipping-note"><Truck size={15} /> This demo does not arrange shipping.</div><div className="subtotal"><span>Demo subtotal</span><span>{Object.entries(cartTotals).map(([currency, total]) => <b key={currency}>{money(total, currency)}</b>)}</span></div><small>Catalog prices are live. No order or payment is created.</small><button className="button button-dark checkout-button" disabled title="Checkout is not connected in this demo">Checkout unavailable in demo <ArrowRight size={16} /></button><button className="continue-shopping" onClick={() => setCartOpen(false)}><ChevronLeft size={15} /> Keep looking around</button></div>
            </> : <div className="cart-empty"><ShoppingBag size={28} /><h3>Your bag is taking a breather.</h3><p>We think it has room for something good.</p><button className="button button-dark" onClick={() => setCartOpen(false)}>Find something lovely <ArrowRight size={15} /></button></div>}
          </motion.aside>
        </motion.div>}
      </AnimatePresence>
      <AnimatePresence>
        {selectedProduct && <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeProductDetails() }}>
          <motion.aside className="cart-drawer detail-drawer" role="dialog" aria-modal="true" aria-labelledby="product-detail-heading" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.28 }}>
            <div className="drawer-heading"><div><div className="eyebrow">PRODUCT DETAILS</div><h2 id="product-detail-heading">A closer look</h2></div><button className="icon-button" aria-label="Close product details" onClick={closeProductDetails}><X size={20} /></button></div>
            {detailLoading && <div className="detail-status" role="status">Loading current product details…</div>}
            {detailError && <div className="catalog-error detail-error" role="alert"><h3>Product details could not be loaded.</h3><p>{detailError}</p><button className="button button-dark" onClick={() => { setDetailLoading(true); setDetailError(''); setDetailRetry((retry) => retry + 1) }}>Retry details <ArrowRight size={15} /></button></div>}
            {detailProduct && <>
              <div className="detail-content">
                <ProductGallery key={detailProduct.id} productName={detailProduct.name} images={detailProduct.images} />
                <div className="product-meta"><span>{detailProduct.category.name} · <a className="seller-store-link" href={`#store/${detailProduct.seller.slug}`}>{detailProduct.seller.displayName}</a></span><span className="rating"><Star size={12} fill="currentColor" /> {detailProduct.rating === null ? 'New' : detailProduct.rating.toFixed(1)}</span></div>
                <h3>{detailProduct.name}</h3>
                <div className="price-line"><b>{money(detailProduct.basePriceMinor, detailProduct.currency)}</b></div>
                <p className="detail-description">{detailProduct.description}</p>
                <div className="detail-facts"><span><b>Category</b>{detailProduct.category.name}</span><span><b>Seller</b>{detailProduct.seller.displayName} · {detailProduct.seller.status.toLowerCase()}</span><span><b>Availability</b>{detailProduct.available ? `${detailProduct.stockOnHand} in stock` : 'Out of stock'}</span><span><b>Reviews</b>{detailProduct.reviewCount ? `${detailProduct.reviewCount} reviews` : 'No reviews yet'}</span></div>
                <h4 className="variant-heading">Available options</h4>
                {detailProduct.variants.length ? <ul className="variant-list">{detailProduct.variants.map((variant) => <li key={variant.id}><span>{variant.name}<small className="variant-sku">SKU {variant.sku}</small></span><span>{variant.priceMinor === null ? money(detailProduct.basePriceMinor, detailProduct.currency) : money(variant.priceMinor, detailProduct.currency)} · {variant.stockOnHand > 0 ? `${variant.stockOnHand} available` : 'Out of stock'}</span></li>)}</ul> : <p className="detail-description">No active variants are currently listed.</p>}
                <h4 className="variant-heading">Specifications</h4>
                {detailProduct.specifications.length ? <dl className="detail-facts specification-list">{detailProduct.specifications.map((specification) => <div key={specification.id}><dt>{specification.name}</dt><dd>{specification.value}</dd></div>)}</dl> : <p className="detail-description">No specifications have been provided.</p>}
              </div>
              <div className="drawer-bottom"><button className="button button-dark checkout-button" disabled={!detailProduct.available || (cart[detailProduct.id] ?? 0) >= detailProduct.stockOnHand} onClick={() => { addToCart(detailProduct); closeProductDetails() }}>{detailProduct.available ? 'Add to bag' : 'Out of stock'} <Plus size={16} /></button><button className="continue-shopping" onClick={closeProductDetails}>Back to the edit</button></div>
            </>}
          </motion.aside>
        </motion.div>}
      </AnimatePresence>
      <AnimatePresence>
        {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} initialAction={accountLink?.action} initialToken={accountLink?.token} />}
      </AnimatePresence>
      <AnimatePresence>{notice && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}><Check size={16} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></motion.div>}</AnimatePresence>
      <div className="mobile-bottom-nav"><a href="#discover"><Search size={18} /><span>Discover</span></a><button onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>Bag {cartCount ? `(${cartCount})` : ''}</span></button><button onClick={() => setNotice(favorites.length ? `${favorites.length} saved pieces` : 'Save a few pieces you love to find them here.')}><Heart size={18} /><span>Saved</span></button></div>
      <div className="page-arrows" aria-hidden="true"><button><ChevronLeft size={14} /></button><button><ChevronRight size={14} /></button></div>
    </div>
  )
}

export default App
