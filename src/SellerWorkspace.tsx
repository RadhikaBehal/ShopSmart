import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Boxes, Check, ChevronLeft, ChevronRight,
  CircleAlert, ClipboardList, LayoutDashboard, LogOut, PackagePlus, Pencil, Plus, Search, Settings,
  Store, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AuthRole } from './authApi'
import {
  adjustSellerInventory,
  archiveSellerProduct,
  createSellerProduct,
  getSellerCategories,
  getSellerInventoryHistory,
  getSellerLowStock,
  getSellerProduct,
  getSellerProducts,
  setSellerLowStockThreshold,
  updateSellerProduct,
  type SellerCategory,
  type SellerInventoryAdjustment,
  type SellerListingStatus,
  type SellerLowStockVariant,
  type SellerModerationStatus,
  type SellerProduct,
  type SellerProductInput,
  type SellerProductVariant,
} from './sellerManagementApi'

type WorkspacePage = 'overview' | 'products' | 'create' | 'edit' | 'inventory' | 'history'

type SellerWorkspaceProps = {
  accessToken: string
  role: AuthRole
  onBack: () => void
  onStoreSettings: () => void
  onLogout: () => void
}

type ImageDraft = { url: string; altText: string; isPrimary: boolean }
type SpecificationDraft = { name: string; value: string }
type VariantDraft = {
  id?: string
  sku: string
  name: string
  priceMinor: string
  stockOnHand: string
  lowStockThreshold: string
}

type ProductDraft = {
  name: string
  description: string
  categoryId: string
  basePrice: string
  currency: string
  status: SellerListingStatus
  images: ImageDraft[]
  specifications: SpecificationDraft[]
  variants: VariantDraft[]
}

const blankDraft = (categoryId = ''): ProductDraft => ({
  name: '',
  description: '',
  categoryId,
  basePrice: '',
  currency: 'INR',
  status: 'DRAFT',
  images: [{ url: '', altText: '', isPrimary: true }],
  specifications: [],
  variants: [{ sku: '', name: '', priceMinor: '', stockOnHand: '0', lowStockThreshold: '5' }],
})

const listingStatuses: SellerListingStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']
const moderationStatuses: SellerModerationStatus[] = ['PENDING_REVIEW', 'APPROVED', 'DISABLED']
const adjustmentReasons = ['RESTOCK', 'CORRECTION', 'DAMAGE', 'RETURN', 'OTHER'] as const

function titleCase(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatPrice(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amountMinor / 100)
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`
  }
}

function formatDate(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
}

async function getAllProducts(accessToken: string): Promise<SellerProduct[]> {
  const first = await getSellerProducts(accessToken, { page: 1, pageSize: 50 })
  const items = [...first.items]
  for (let page = 2; page <= first.pagination.pages; page += 1) {
    const result = await getSellerProducts(accessToken, { page, pageSize: 50 })
    items.push(...result.items)
  }
  return items
}

async function getAllLowStock(accessToken: string): Promise<SellerLowStockVariant[]> {
  const first = await getSellerLowStock(accessToken)
  const items = [...first.items]
  for (let page = 2; page <= first.pagination.pages; page += 1) {
    const result = await getSellerLowStock(accessToken, page)
    items.push(...result.items)
  }
  return items
}

function productToDraft(product: SellerProduct): ProductDraft {
  return {
    name: product.name,
    description: product.description,
    categoryId: product.category.id,
    basePrice: String(product.basePriceMinor),
    currency: product.currency,
    status: product.status,
    images: product.images.map((image) => ({
      url: image.url,
      altText: image.altText ?? '',
      isPrimary: image.isPrimary,
    })),
    specifications: product.specifications.map(({ name, value }) => ({ name, value })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceMinor: variant.priceMinor === null ? '' : String(variant.priceMinor),
      stockOnHand: String(variant.stockOnHand),
      lowStockThreshold: String(variant.lowStockThreshold),
    })),
  }
}

function productCreatePayload(draft: ProductDraft): SellerProductInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    categoryId: draft.categoryId,
    basePriceMinor: Number(draft.basePrice),
    currency: draft.currency.trim().toUpperCase(),
    images: draft.images.filter((image) => image.url.trim()).map((image) => ({
      url: image.url.trim(),
      altText: image.altText.trim() || null,
      isPrimary: image.isPrimary,
    })),
    specifications: draft.specifications
      .filter((specification) => specification.name.trim() || specification.value.trim())
      .map((specification) => ({ name: specification.name.trim(), value: specification.value.trim() })),
    variants: draft.variants.map((variant) => ({
      sku: variant.sku.trim(),
      name: variant.name.trim(),
      priceMinor: variant.priceMinor.trim() ? Number(variant.priceMinor) : null,
      stockOnHand: Number(variant.stockOnHand),
      lowStockThreshold: Number(variant.lowStockThreshold),
    })),
  }
}

function productUpdatePayload(draft: ProductDraft, original: SellerProduct): Partial<SellerProductInput> {
  const changes: Partial<SellerProductInput> = {}
  if (draft.name.trim() !== original.name) changes.name = draft.name.trim()
  if (draft.description.trim() !== original.description) changes.description = draft.description.trim()
  if (draft.categoryId !== original.category.id) changes.categoryId = draft.categoryId
  if (Number(draft.basePrice) !== original.basePriceMinor) changes.basePriceMinor = Number(draft.basePrice)
  if (draft.currency.trim().toUpperCase() !== original.currency) changes.currency = draft.currency.trim().toUpperCase()
  if (draft.status !== original.status && draft.status !== 'ARCHIVED') changes.status = draft.status

  const originalImages = original.images.map(({ url, altText, isPrimary }) => ({ url, altText: altText ?? '', isPrimary }))
  const currentImages = draft.images.filter((image) => image.url.trim()).map(({ url, altText, isPrimary }) => ({ url: url.trim(), altText: altText.trim() || '', isPrimary }))
  if (JSON.stringify(originalImages) !== JSON.stringify(currentImages)) {
    changes.images = currentImages.map((image) => ({ ...image, altText: image.altText || null }))
  }

  const originalSpecs = original.specifications.map(({ name, value }) => ({ name, value }))
  const currentSpecs = draft.specifications
    .filter((specification) => specification.name.trim() || specification.value.trim())
    .map((specification) => ({ name: specification.name.trim(), value: specification.value.trim() }))
  if (JSON.stringify(originalSpecs) !== JSON.stringify(currentSpecs)) changes.specifications = currentSpecs

  const variantChanges: NonNullable<SellerProductInput['variants']> = []
  for (const variant of draft.variants) {
    if (!variant.id) {
      variantChanges.push({
        sku: variant.sku.trim(),
        name: variant.name.trim(),
        priceMinor: variant.priceMinor.trim() ? Number(variant.priceMinor) : null,
        stockOnHand: Number(variant.stockOnHand),
        lowStockThreshold: Number(variant.lowStockThreshold),
      })
      continue
    }
    const existing = original.variants.find((item) => item.id === variant.id)
    if (!existing) continue
    const change: NonNullable<SellerProductInput['variants']>[number] = { id: variant.id, name: existing.name }
    let hasChange = false
    if (variant.sku.trim() !== existing.sku) {
      change.sku = variant.sku.trim()
      hasChange = true
    }
    if (variant.name.trim() !== existing.name) {
      change.name = variant.name.trim()
      hasChange = true
    }
    const nextPrice = variant.priceMinor.trim() ? Number(variant.priceMinor) : null
    if (nextPrice !== existing.priceMinor) {
      change.priceMinor = nextPrice
      hasChange = true
    }
    if (hasChange) variantChanges.push(change)
  }
  if (variantChanges.length) changes.variants = variantChanges
  return changes
}

function StatusBadge({ value, kind }: { value: string; kind: 'listing' | 'moderation' }) {
  return <span className={`workspace-badge workspace-badge-${kind} workspace-badge-${value.toLowerCase().replaceAll('_', '-')}`}>{titleCase(value)}</span>
}

function Alert({ children, type = 'error' }: { children: ReactNode; type?: 'error' | 'success' | 'warning' }) {
  return <div className={`workspace-alert workspace-alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function SellerWorkspace({ accessToken, role, onBack, onStoreSettings, onLogout }: SellerWorkspaceProps) {
  const [page, setPage] = useState<WorkspacePage>('overview')
  const [products, setProducts] = useState<SellerProduct[]>([])
  const [allProducts, setAllProducts] = useState<SellerProduct[]>([])
  const [categories, setCategories] = useState<SellerCategory[]>([])
  const [lowStock, setLowStock] = useState<SellerLowStockVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [listingFilter, setListingFilter] = useState<SellerListingStatus | ''>('')
  const [moderationFilter, setModerationFilter] = useState<SellerModerationStatus | ''>('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [productPage, setProductPage] = useState({ page: 1, pageSize: 10, total: 0, pages: 0 })
  const [formDraft, setFormDraft] = useState<ProductDraft>(blankDraft())
  const [editingProduct, setEditingProduct] = useState<SellerProduct | null>(null)
  const [detailProduct, setDetailProduct] = useState<SellerProduct | null>(null)
  const [formError, setFormError] = useState('')
  const [formDirty, setFormDirty] = useState(false)
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({})
  const [adjustingVariant, setAdjustingVariant] = useState<SellerProductVariant | null>(null)
  const [adjustment, setAdjustment] = useState({ quantityChange: '', reason: 'RESTOCK' as typeof adjustmentReasons[number], note: '' })
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<SellerInventoryAdjustment[]>([])
  const [historyProductId, setHistoryProductId] = useState('')
  const [historyVariantId, setHistoryVariantId] = useState('')
  const [historyPage, setHistoryPage] = useState({ page: 1, pageSize: 20, total: 0, pages: 0 })

  const inventoryVariants = useMemo(() => allProducts.flatMap((product) =>
    product.variants.map((variant) => ({ ...variant, productId: product.id, productName: product.name }))), [allProducts])
  const lowStockIds = useMemo(() => new Set(lowStock.map((variant) => variant.variantId)), [lowStock])

  const loadOverviewData = useCallback(async () => {
    const [allProducts, allLowStock] = await Promise.all([
      getAllProducts(accessToken),
      getAllLowStock(accessToken),
    ])
    setAllProducts(allProducts)
    setLowStock(allLowStock)
  }, [accessToken])

  useEffect(() => {
    if (role !== 'SELLER') {
      return
    }
    let active = true
    Promise.all([getSellerCategories(accessToken), getAllProducts(accessToken), getAllLowStock(accessToken)])
      .then(([categoryRows, productRows, lowStockRows]) => {
        if (!active) return
        setCategories(categoryRows)
        setAllProducts(productRows)
        setProducts(productRows)
        setLowStock(lowStockRows)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Seller workspace could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, retry, role])

  useEffect(() => {
    if (page !== 'products' || role !== 'SELLER') return
    let active = true
    getSellerProducts(accessToken, {
      page: productPage.page,
      pageSize: productPage.pageSize,
      q: search.trim() || undefined,
      status: listingFilter || undefined,
      moderationStatus: moderationFilter || undefined,
      categoryId: categoryFilter || undefined,
    }).then((result) => {
      if (!active) return
      setProducts(result.items)
      setProductPage(result.pagination)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Products could not be loaded.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, categoryFilter, listingFilter, moderationFilter, page, productPage.page, productPage.pageSize, retry, role, search])

  useEffect(() => {
    if (page !== 'history' || role !== 'SELLER' || !historyProductId) {
      return
    }
    let active = true
    getSellerInventoryHistory(accessToken, {
      productId: historyProductId,
      variantId: historyVariantId || undefined,
      page: historyPage.page,
      pageSize: historyPage.pageSize,
    }).then((result) => {
      if (!active) return
      setHistory(result.items)
      setHistoryPage(result.pagination)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Inventory history could not be loaded.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, historyPage.page, historyPage.pageSize, historyProductId, historyVariantId, page, role, retry])

  const refreshInventory = useCallback(async () => {
    const [allProducts, allLowStock] = await Promise.all([getAllProducts(accessToken), getAllLowStock(accessToken)])
    setAllProducts(allProducts)
    setLowStock(allLowStock)
  }, [accessToken])

  function navigate(nextPage: WorkspacePage) {
    if ((page === 'create' || page === 'edit') && formDirty && !window.confirm('Discard your unsaved product changes?')) return
    if (nextPage === 'products' || (nextPage === 'history' && Boolean(historyProductId))) setLoading(true)
    setError('')
    setNotice('')
    setDetailProduct(null)
    setFormError('')
    setPage(nextPage)
    setFormDirty(false)
    if (nextPage === 'create') {
      setEditingProduct(null)
      setFormDraft(blankDraft(categories[0]?.id ?? ''))
    }
  }

  function leaveWorkspace(callback: () => void) {
    if ((page === 'create' || page === 'edit') && formDirty && !window.confirm('Discard your unsaved product changes?')) return
    callback()
  }

  async function openCreate() {
    let categoryId = categories[0]?.id ?? ''
    if (!categories.length) {
      try {
        const categoryRows = await getSellerCategories(accessToken)
        setCategories(categoryRows)
        categoryId = categoryRows[0]?.id ?? ''
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : 'Categories could not be loaded.')
      }
    }
    setEditingProduct(null)
    setFormDraft(blankDraft(categoryId))
    setFormDirty(false)
    setFormError('')
    setPage('create')
  }

  async function openEdit(productId: string) {
    setLoading(true)
    setError('')
    try {
      const product = await getSellerProduct(accessToken, productId)
      if (!categories.length) setCategories(await getSellerCategories(accessToken))
      setEditingProduct(product)
      setFormDraft(productToDraft(product))
      setFormDirty(false)
      setFormError('')
      setPage('edit')
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Product details could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  async function openDetails(productId: string) {
    setLoading(true)
    setError('')
    try {
      setDetailProduct(await getSellerProduct(accessToken, productId))
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Product details could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  function updateDraft<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setFormDirty(true)
    setFormDraft((current) => ({ ...current, [field]: value }))
  }

  function updateRow<K extends 'images' | 'specifications' | 'variants'>(
    field: K,
    index: number,
    update: (row: ProductDraft[K][number]) => ProductDraft[K][number],
  ) {
    setFormDirty(true)
    setFormDraft((current) => ({
      ...current,
      [field]: current[field].map((row, rowIndex) => rowIndex === index ? update(row) : row),
    }))
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    const duplicateSkus = formDraft.variants.map((variant) => variant.sku.trim().toLowerCase())
    if (new Set(duplicateSkus).size !== duplicateSkus.length) {
      setFormError('Each variant must have a unique SKU.')
      return
    }
    const imageUrls = formDraft.images.map((image) => image.url.trim()).filter(Boolean)
    if (!imageUrls.length || imageUrls.some((url) => !/^https:\/\//i.test(url))) {
      setFormError('Product image URLs must use HTTPS.')
      return
    }
    if (!formDraft.categoryId) {
      setFormError('Choose a product category.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      let saved: SellerProduct
      if (editingProduct) {
        const changes = productUpdatePayload(formDraft, editingProduct)
        if (Object.keys(changes).length === 0) {
          setFormError('Make a product change before saving.')
          return
        }
        saved = await updateSellerProduct(accessToken, editingProduct.id, changes)
      } else {
        saved = await createSellerProduct(accessToken, productCreatePayload(formDraft))
      }
      setNotice(editingProduct ? 'Product changes saved.' : 'Product created and submitted for administrator review.')
      setFormDirty(false)
      setFormDraft(productToDraft(saved))
      setEditingProduct(saved)
      setLoading(true)
      setPage('products')
      setProductPage((current) => ({ ...current, page: 1 }))
      await loadOverviewData()
    } catch (saveError: unknown) {
      setFormError(saveError instanceof Error ? saveError.message : 'Product changes could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function archiveProduct(product: SellerProduct) {
    if (!window.confirm(`Archive “${product.name}”? This keeps the product record and inventory history.`)) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await archiveSellerProduct(accessToken, product.id)
      setNotice(`${product.name} was archived.`)
      await loadOverviewData()
      if (page === 'products') {
        setLoading(true)
        setRetry((value) => value + 1)
      }
    } catch (archiveError: unknown) {
      setError(archiveError instanceof Error ? archiveError.message : 'Product could not be archived.')
    } finally {
      setSaving(false)
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adjustingVariant) return
    const quantityChange = Number(adjustment.quantityChange)
    if (!Number.isInteger(quantityChange) || quantityChange === 0) {
      setFormError('Enter a non-zero whole-number stock change.')
      return
    }
    if (['CORRECTION', 'DAMAGE', 'OTHER'].includes(adjustment.reason) && !adjustment.note.trim()) {
      setFormError('A note is required for this adjustment reason.')
      return
    }
    const resultingStock = adjustingVariant.stockOnHand + quantityChange
    if (resultingStock < 0) {
      setFormError('This adjustment would make stock negative. Reduce the decrease and try again.')
      return
    }
    if (resultingStock > 2_147_483_647) {
      setFormError('This adjustment exceeds the maximum supported stock quantity.')
      return
    }
    setSaving(true)
    setFormError('')
    setError('')
    setNotice('')
    try {
      await adjustSellerInventory(accessToken, adjustingVariant.id, {
        quantityChange,
        reason: adjustment.reason,
        note: adjustment.note.trim() || undefined,
      })
      setAdjustingVariant(null)
      setAdjustment({ quantityChange: '', reason: 'RESTOCK', note: '' })
      setNotice('Inventory adjustment recorded.')
      await refreshInventory()
    } catch (adjustError: unknown) {
      setFormError(adjustError instanceof Error ? adjustError.message : 'Inventory adjustment could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  async function saveThreshold(variantId: string, value: string) {
    const threshold = Number(value)
    if (!value.trim() || !Number.isInteger(threshold) || threshold < 0) {
      setError('Low-stock threshold must be a nonnegative whole number.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await setSellerLowStockThreshold(accessToken, variantId, threshold)
      await refreshInventory()
      setNotice('Low-stock threshold updated.')
    } catch (thresholdError: unknown) {
      setError(thresholdError instanceof Error ? thresholdError.message : 'Threshold could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  async function changeHistoryProduct(productId: string) {
    setError('')
    setLoading(Boolean(productId))
    setHistoryProductId(productId)
    setHistoryVariantId('')
    setHistoryPage((current) => ({ ...current, page: 1 }))
    if (!productId) {
      setHistory([])
      setHistoryPage((current) => ({ ...current, total: 0, pages: 0 }))
    }
  }

  if (role !== 'SELLER') {
    return <main className="seller-workspace-denied"><CircleAlert /><h1>Seller access required</h1><p>Sign in with an approved, active seller account to open this workspace.</p><button className="workspace-button workspace-button-dark" onClick={onBack}>Back to account</button></main>
  }

  const navigation: Array<{ id: WorkspacePage | 'settings'; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'products', label: 'Products', icon: Boxes },
    { id: 'create', label: 'Add product', icon: PackagePlus },
    { id: 'inventory', label: 'Inventory', icon: ClipboardList },
    { id: 'history', label: 'Inventory history', icon: ArrowDown },
    { id: 'settings', label: 'Store settings', icon: Settings },
  ]

  const matchingProducts = products
  const publishedCount = allProducts.filter((product) => product.status === 'PUBLISHED' && product.moderationStatus === 'APPROVED').length
  const pendingCount = allProducts.filter((product) => product.moderationStatus === 'PENDING_REVIEW').length
  const disabledCount = allProducts.filter((product) => product.moderationStatus === 'DISABLED').length
  const archivedCount = allProducts.filter((product) => product.status === 'ARCHIVED').length
  const totalStock = allProducts.reduce((sum, product) => sum + product.stockOnHand, 0)
  const selectedHistoryProduct = allProducts.find((product) => product.id === historyProductId)
  const historyVariants = selectedHistoryProduct?.variants ?? []

  return (
    <main className="seller-workspace" aria-label="Seller workspace">
      <aside className="workspace-sidebar">
        <button className="workspace-brand" onClick={() => leaveWorkspace(onBack)} aria-label="Back to storefront"><span className="workspace-brand-mark"><Store size={19} /></span><span>shopsmart<small>SELLER WORKSPACE</small></span></button>
        <nav className="workspace-nav" aria-label="Seller workspace navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`workspace-nav-item ${(id === page || (id === 'create' && page === 'edit')) ? 'active' : ''}`}
                onClick={() => id === 'settings' ? leaveWorkspace(onStoreSettings) : id === 'create' ? void openCreate() : navigate(id)}>
              <Icon size={17} />{label}{id === 'inventory' && lowStock.length > 0 && <span className="workspace-nav-count">{lowStock.length}</span>}
            </button>
          ))}
        </nav>
        <div className="workspace-sidebar-bottom">
          <button type="button" className="workspace-nav-item" onClick={() => leaveWorkspace(onBack)}><ArrowLeft size={17} />Back to storefront</button>
          <button type="button" className="workspace-nav-item workspace-logout" onClick={onLogout}><LogOut size={17} />Sign out</button>
          <div className="workspace-sidebar-note"><ShieldCheckIcon />Seller access is verified for each request.</div>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-mobile-brand"><Store size={18} /><span>Seller workspace</span></div>
          <div className="workspace-topbar-right"><span className="workspace-live-dot" />Connected to ShopSmart</div>
        </header>
        <div className="workspace-content">
          {error && <Alert>{error} <button type="button" onClick={() => { setError(''); setLoading(true); setRetry((value) => value + 1) }}>Retry</button></Alert>}
          {notice && <Alert type="success"><Check size={15} />{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></Alert>}

          {page === 'overview' && (
            <section>
              <div className="workspace-page-heading"><div><p className="workspace-eyebrow">YOUR BUSINESS AT A GLANCE</p><h1>Good morning. <em>Let’s grow.</em></h1><p>Keep your listings current and your inventory ready.</p></div><button className="workspace-button workspace-button-dark" onClick={() => void openCreate()}><Plus size={16} />Add a product</button></div>
              {loading ? <LoadingCards /> : (
                <>
                  <div className="workspace-metrics">
                    <Metric label="Total products" value={allProducts.length} detail="Across all listing states" icon={<Boxes size={18} />} />
                    <Metric label="Published" value={publishedCount} detail="Currently listed" icon={<Store size={18} />} />
                    <Metric label="Awaiting review" value={pendingCount} detail="Administrator review" icon={<CircleAlert size={18} />} />
                    <Metric label="Disabled" value={disabledCount} detail="Requires administrator review" icon={<Archive size={18} />} />
                  </div>
                  <div className="workspace-overview-grid">
                    <section className="workspace-card">
                      <div className="workspace-card-heading"><div><p className="workspace-eyebrow">INVENTORY HEALTH</p><h2>Stock snapshot</h2></div><button className="workspace-text-button" onClick={() => navigate('inventory')}>Manage inventory <ArrowRight size={14} /></button></div>
                      <div className="workspace-stock-summary"><strong>{totalStock.toLocaleString('en-IN')}</strong><span>units across {inventoryVariants.length} variants</span></div>
                      <div className="workspace-summary-footer"><span>{lowStock.length} low-stock variants</span><span>{archivedCount} archived listings</span></div>
                    </section>
                    <section className="workspace-card">
                      <div className="workspace-card-heading"><div><p className="workspace-eyebrow">QUICK ACTIONS</p><h2>What would you like to do?</h2></div></div>
                      <div className="workspace-shortcuts">
                        <button onClick={() => void openCreate()}><PackagePlus size={17} /><span><b>Add a product</b><small>Build a listing for review</small></span><ArrowRight size={15} /></button>
                        <button onClick={() => { setModerationFilter('PENDING_REVIEW'); setProductPage((current) => ({ ...current, page: 1 })); navigate('products') }}><CircleAlert size={17} /><span><b>Awaiting approval</b><small>{pendingCount} products pending</small></span><ArrowRight size={15} /></button>
                        <button onClick={() => navigate('inventory')}><ClipboardList size={17} /><span><b>Review low stock</b><small>{lowStock.length} variants at or below threshold</small></span><ArrowRight size={15} /></button>
                      </div>
                    </section>
                  </div>
                  <section className="workspace-card workspace-recent-card">
                    <div className="workspace-card-heading"><div><p className="workspace-eyebrow">RECENT LISTINGS</p><h2>Your products</h2></div><button className="workspace-text-button" onClick={() => navigate('products')}>View all <ArrowRight size={14} /></button></div>
                    {allProducts.length ? <ProductTable products={allProducts.slice(0, 5)} onDetails={(item) => void openDetails(item.id)} onEdit={(item) => void openEdit(item.id)} onArchive={(item) => void archiveProduct(item)} saving={saving} /> : <EmptyState title="Your first product starts here" detail="Create a product listing to begin building your store." action="Add a product" onAction={() => void openCreate()} />}
                  </section>
                </>
              )}
            </section>
          )}

          {page === 'products' && (
            <section>
              <div className="workspace-page-heading"><div><p className="workspace-eyebrow">PRODUCT CATALOG</p><h1>Products</h1><p>Manage your listings and keep moderation status in view.</p></div><button className="workspace-button workspace-button-dark" onClick={() => void openCreate()}><Plus size={16} />Add a product</button></div>
              <div className="workspace-filter-bar">
                <label className="workspace-search"><Search size={16} /><span className="sr-only">Search products</span><input value={search} onChange={(event) => { setError(''); setLoading(true); setSearch(event.target.value); setProductPage((current) => ({ ...current, page: 1 })) }} placeholder="Search product names…" /></label>
                <label><span className="sr-only">Filter by listing status</span><select value={listingFilter} onChange={(event) => { setError(''); setLoading(true); setListingFilter(event.target.value as SellerListingStatus | ''); setProductPage((current) => ({ ...current, page: 1 })) }}><option value="">All listing statuses</option>{listingStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                <label><span className="sr-only">Filter by moderation status</span><select value={moderationFilter} onChange={(event) => { setError(''); setLoading(true); setModerationFilter(event.target.value as SellerModerationStatus | ''); setProductPage((current) => ({ ...current, page: 1 })) }}><option value="">All review statuses</option>{moderationStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                <label><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={(event) => { setError(''); setLoading(true); setCategoryFilter(event.target.value); setProductPage((current) => ({ ...current, page: 1 })) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              </div>
              <section className="workspace-card workspace-table-card">
                {loading ? <LoadingTable /> : matchingProducts.length ? <ProductTable products={matchingProducts} onDetails={(item) => void openDetails(item.id)} onEdit={(item) => void openEdit(item.id)} onArchive={(item) => void archiveProduct(item)} saving={saving} /> : <EmptyState title="No products found" detail="Try changing your filters or add a new product." action="Add a product" onAction={() => void openCreate()} />}
                <Pagination page={productPage.page} pages={productPage.pages} total={productPage.total} onChange={(next) => { setError(''); setLoading(true); setProductPage((current) => ({ ...current, page: next })) }} />
              </section>
            </section>
          )}

          {(page === 'create' || page === 'edit') && (
            <section>
              <div className="workspace-page-heading"><div><p className="workspace-eyebrow">{editingProduct ? 'PRODUCT EDITOR' : 'NEW LISTING'}</p><h1>{editingProduct ? 'Edit product' : 'Add a product'}</h1><p>Complete the listing details before submitting it for review.</p></div></div>
              {editingProduct?.moderationStatus === 'APPROVED' && <Alert type="warning">Editing customer-visible listing content will return this product to administrator review.</Alert>}
              {editingProduct?.moderationStatus === 'DISABLED' && <Alert type="warning"><CircleAlert size={16} /><span><b>This listing was disabled by an administrator.</b><br />{editingProduct.moderationNote || 'Administrator review is required.'} Seller edits cannot re-enable it; contact the administrator for review.</span></Alert>}
              {formError && <Alert>{formError}</Alert>}
              <form className="workspace-product-form" onSubmit={(event) => void saveProduct(event)}>
                <section className="workspace-card workspace-form-card">
                  <FormHeading number="01" title="Product information" detail="Tell customers what makes this product worth choosing." />
                  <div className="workspace-form-grid">
                    <label className="workspace-field workspace-field-wide">Product name<input value={formDraft.name} onChange={(event) => updateDraft('name', event.target.value)} minLength={2} maxLength={160} required /></label>
                    <label className="workspace-field workspace-field-wide">Description<textarea value={formDraft.description} onChange={(event) => updateDraft('description', event.target.value)} minLength={10} maxLength={10000} rows={5} required /></label>
                    <label className="workspace-field">Category<select value={formDraft.categoryId} onChange={(event) => updateDraft('categoryId', event.target.value)} required><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                    <label className="workspace-field">Base price (minor currency units)<input type="number" value={formDraft.basePrice} onChange={(event) => updateDraft('basePrice', event.target.value)} min="1" max="2000000000" step="1" required /><small>INR prices are entered in paise (e.g. ₹499 = 49900).</small></label>
                    <label className="workspace-field">Currency<input value={formDraft.currency} onChange={(event) => updateDraft('currency', event.target.value.toUpperCase())} pattern="[A-Z]{3}" maxLength={3} required /></label>
                    {editingProduct && <label className="workspace-field">Listing status<select value={formDraft.status} onChange={(event) => updateDraft('status', event.target.value as SellerListingStatus)}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED" disabled>Archived</option></select></label>}
                  </div>
                </section>

                <section className="workspace-card workspace-form-card">
                  <FormHeading number="02" title="Product images" detail="Use secure image URLs. Uploads are not enabled." action={<button className="workspace-small-button" type="button" onClick={() => updateDraft('images', [...formDraft.images, { url: '', altText: '', isPrimary: false }])}><Plus size={14} />Add image</button>} />
                  <div className="workspace-image-list">
                    {formDraft.images.map((image, index) => <div className="workspace-image-row" key={`image-${index}`}>
                      <div className="workspace-image-preview">{image.url && !brokenImages[image.url] ? <img src={image.url} alt={image.altText || `Product image ${index + 1}`} onError={() => setBrokenImages((current) => ({ ...current, [image.url]: true }))} /> : <ImageIcon />}</div>
                      <div className="workspace-form-grid">
                        <label className="workspace-field workspace-field-wide">HTTPS image URL<input type="url" value={image.url} onChange={(event) => updateRow('images', index, (row) => ({ ...row, url: event.target.value }))} placeholder="https://…" required={index === 0} /></label>
                        <label className="workspace-field">Alt text<input value={image.altText} onChange={(event) => updateRow('images', index, (row) => ({ ...row, altText: event.target.value }))} maxLength={300} /></label>
                        <label className="workspace-check-field"><input type="radio" name="primary-image" checked={image.isPrimary} onChange={() => updateDraft('images', formDraft.images.map((row, rowIndex) => ({ ...row, isPrimary: rowIndex === index })))} />Primary image</label>
                      </div>
                      <div className="workspace-row-actions">
                        <button type="button" aria-label={`Move image ${index + 1} up`} disabled={index === 0} onClick={() => updateDraft('images', moveItem(formDraft.images, index, index - 1))}><ArrowUp size={15} /></button>
                        <button type="button" aria-label={`Move image ${index + 1} down`} disabled={index === formDraft.images.length - 1} onClick={() => updateDraft('images', moveItem(formDraft.images, index, index + 1))}><ArrowDown size={15} /></button>
                        <button type="button" aria-label={`Remove image ${index + 1}`} disabled={formDraft.images.length === 1} onClick={() => updateDraft('images', formDraft.images.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button>
                      </div>
                    </div>)}
                  </div>
                </section>

                <section className="workspace-card workspace-form-card">
                  <FormHeading number="03" title="Specifications" detail="Add helpful product details; optional." action={<button className="workspace-small-button" type="button" onClick={() => updateDraft('specifications', [...formDraft.specifications, { name: '', value: '' }])}><Plus size={14} />Add specification</button>} />
                  {formDraft.specifications.length === 0 ? <p className="workspace-muted">No specifications added.</p> : formDraft.specifications.map((specification, index) => <div className="workspace-spec-row" key={`spec-${index}`}>
                    <label className="workspace-field">Name<input value={specification.name} onChange={(event) => updateRow('specifications', index, (row) => ({ ...row, name: event.target.value }))} maxLength={100} /></label>
                    <label className="workspace-field">Value<input value={specification.value} onChange={(event) => updateRow('specifications', index, (row) => ({ ...row, value: event.target.value }))} maxLength={1000} /></label>
                    <button className="workspace-icon-button" type="button" aria-label={`Remove specification ${index + 1}`} onClick={() => updateDraft('specifications', formDraft.specifications.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>
                  </div>)}
                </section>

                <section className="workspace-card workspace-form-card">
                  <FormHeading number="04" title="Variants & initial stock" detail={editingProduct ? 'Update listing fields or append variants. Existing stock is managed in Inventory.' : 'At least one variant is required. Initial stock is ledgered by the API.'} action={<button className="workspace-small-button" type="button" onClick={() => updateDraft('variants', [...formDraft.variants, { sku: '', name: '', priceMinor: '', stockOnHand: '0', lowStockThreshold: '5' }])}><Plus size={14} />Add variant</button>} />
                  <div className="workspace-variant-list">
                    {formDraft.variants.map((variant, index) => <div className="workspace-variant-card" key={variant.id ?? `variant-${index}`}>
                      <div className="workspace-variant-heading"><b>{variant.name || `Variant ${index + 1}`}</b>{variant.id && <span>Existing · stock managed separately</span>}{!variant.id && formDraft.variants.length > 1 && <button type="button" onClick={() => updateDraft('variants', formDraft.variants.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}</div>
                      <div className="workspace-form-grid">
                        <label className="workspace-field">SKU<input value={variant.sku} onChange={(event) => updateRow('variants', index, (row) => ({ ...row, sku: event.target.value }))} pattern="[A-Za-z0-9._-]+" maxLength={100} required /></label>
                        <label className="workspace-field">Variant name<input value={variant.name} onChange={(event) => updateRow('variants', index, (row) => ({ ...row, name: event.target.value }))} minLength={1} maxLength={120} required /></label>
                        <label className="workspace-field">Price override (minor units)<input type="number" value={variant.priceMinor} onChange={(event) => updateRow('variants', index, (row) => ({ ...row, priceMinor: event.target.value }))} min="1" max="2000000000" step="1" placeholder="Use base price" /></label>
                        {!variant.id && <>
                          <label className="workspace-field">Initial stock<input type="number" value={variant.stockOnHand} onChange={(event) => updateRow('variants', index, (row) => ({ ...row, stockOnHand: event.target.value }))} min="0" max="2147483647" step="1" required /></label>
                          <label className="workspace-field">Low-stock threshold<input type="number" value={variant.lowStockThreshold} onChange={(event) => updateRow('variants', index, (row) => ({ ...row, lowStockThreshold: event.target.value }))} min="0" max="2147483647" step="1" required /></label>
                        </>}
                        {variant.id && <div className="workspace-variant-stock">Current stock: <b>{variant.stockOnHand}</b> · Low-stock threshold: <b>{variant.lowStockThreshold}</b></div>}
                      </div>
                    </div>)}
                  </div>
                </section>
                <div className="workspace-form-footer">
                  <button type="button" className="workspace-button workspace-button-light" onClick={() => navigate('products')} disabled={saving}>Cancel</button>
                  <button type="submit" className="workspace-button workspace-button-dark" disabled={saving}>{saving ? 'Saving…' : editingProduct ? 'Save changes' : 'Create product'}<ArrowRight size={16} /></button>
                </div>
              </form>
            </section>
          )}

          {page === 'inventory' && (
            <section>
              <div className="workspace-page-heading"><div><p className="workspace-eyebrow">STOCK CONTROL</p><h1>Inventory</h1><p>Review stock levels and record changes with a reason.</p></div></div>
              <section className="workspace-card workspace-table-card">
                {loading ? <LoadingTable /> : inventoryVariants.length ? <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Current stock</th><th>Threshold</th><th>Status</th><th>Actions</th></tr></thead><tbody>
                  {inventoryVariants.map((variant) => {
                    const isLow = lowStockIds.has(variant.id)
                    return <tr key={variant.id} className={isLow ? 'workspace-low-row' : ''}>
                      <td><b>{variant.productName}</b><small>{variant.name}</small></td>
                      <td className="workspace-mono">{variant.sku}</td>
                      <td><b>{variant.stockOnHand}</b></td>
                      <td><label className="workspace-threshold"><span className="sr-only">Low-stock threshold for {variant.sku}</span><input type="number" min="0" step="1" value={thresholdDrafts[variant.id] ?? variant.lowStockThreshold} onChange={(event) => setThresholdDrafts((current) => ({ ...current, [variant.id]: event.target.value }))} /><button type="button" disabled={saving || Number(thresholdDrafts[variant.id] ?? variant.lowStockThreshold) === variant.lowStockThreshold} onClick={() => void saveThreshold(variant.id, thresholdDrafts[variant.id] ?? String(variant.lowStockThreshold))}>Save</button></label></td>
                      <td>{isLow ? <span className="workspace-stock-status low">Low · {lowStock.find((item) => item.variantId === variant.id)?.difference}</span> : variant.stockOnHand === 0 ? <span className="workspace-stock-status out">Out of stock</span> : <span className="workspace-stock-status good">In stock</span>}</td>
                      <td><button className="workspace-table-action" type="button" onClick={() => { setAdjustingVariant(variant); setFormError('') }}>Adjust stock</button></td>
                    </tr>
                  })}
                </tbody></table></div> : <EmptyState title="No variants to manage" detail="Create a product with at least one variant to see inventory here." action="Add a product" onAction={() => void openCreate()} />}
              </section>
              <section className="workspace-card workspace-low-stock-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">REQUIRES ATTENTION</p><h2>Low-stock items</h2></div><span className="workspace-pill">{lowStock.length}</span></div>
                {lowStock.length ? <div className="workspace-low-stock-list">{lowStock.map((item) => <div key={item.variantId}><span className="workspace-low-mark"><CircleAlert size={16} /></span><span><b>{item.productName}</b><small>{item.sku}</small></span><strong>{item.stockOnHand}<small> / {item.lowStockThreshold} threshold</small></strong><em>{item.difference}</em></div>)}</div> : <p className="workspace-muted">No variants are at or below their low-stock threshold.</p>}
              </section>
            </section>
          )}

          {page === 'history' && (
            <section>
              <div className="workspace-page-heading"><div><p className="workspace-eyebrow">IMMUTABLE STOCK RECORD</p><h1>Inventory history</h1><p>Read-only adjustment history, newest first.</p></div></div>
              <div className="workspace-filter-bar workspace-history-filters">
                <label><span>Product</span><select aria-label="Filter history by product" value={historyProductId} onChange={(event) => void changeHistoryProduct(event.target.value)}><option value="">Choose a product</option>{allProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                <label><span>Variant</span><select aria-label="Filter history by variant" value={historyVariantId} onChange={(event) => { setError(''); setLoading(true); setHistoryVariantId(event.target.value); setHistoryPage((current) => ({ ...current, page: 1 })) }} disabled={!selectedHistoryProduct}><option value="">All variants</option>{historyVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.sku}</option>)}</select></label>
              </div>
              <section className="workspace-card workspace-history-card">
                {!historyProductId ? <EmptyState title="Choose a product" detail="Select a product to review its inventory ledger." /> : loading ? <LoadingTable /> : history.length ? <>
                  <div className="workspace-table-scroll"><table className="workspace-table workspace-history-table"><thead><tr><th>Date</th><th>Product / SKU</th><th>Before</th><th>Change</th><th>After</th><th>Reason</th><th>Note / actor</th></tr></thead><tbody>
                    {history.map((entry) => <tr key={entry.id}><td>{formatDate(entry.createdAt)}<small>{new Date(entry.createdAt).toLocaleTimeString()}</small></td><td><b>{entry.variant.product.name}</b><small>{entry.variant.sku}</small></td><td>{entry.quantityBefore}</td><td className={entry.quantityChange > 0 ? 'workspace-change-positive' : entry.quantityChange < 0 ? 'workspace-change-negative' : ''}>{entry.quantityChange > 0 ? '+' : ''}{entry.quantityChange}</td><td>{entry.quantityAfter}</td><td><span className="workspace-history-reason">{titleCase(entry.reason)}</span></td><td>{entry.note || '—'}{entry.actor && <small>By {entry.actor.displayName}</small>}</td></tr>)}
                  </tbody></table></div>
                  <Pagination page={historyPage.page} pages={historyPage.pages} total={historyPage.total} itemLabel="entry" onChange={(next) => { setError(''); setLoading(true); setHistoryPage((current) => ({ ...current, page: next })) }} />
                </> : <EmptyState title="No adjustment history" detail="No inventory ledger entries were found for this selection." />}
              </section>
            </section>
          )}
        </div>
      </section>

      <AnimatePresence>
        {detailProduct && <motion.div className="workspace-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailProduct(null) }}>
          <motion.section className="workspace-detail-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-detail-title" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}>
            <div className="workspace-modal-heading"><div><p className="workspace-eyebrow">PRODUCT DETAILS</p><h2 id="workspace-detail-title">{detailProduct.name}</h2></div><button className="workspace-icon-button" aria-label="Close product details" onClick={() => setDetailProduct(null)}><X size={19} /></button></div>
            <ModerationNotice product={detailProduct} />
            <div className="workspace-detail-badges"><StatusBadge value={detailProduct.status} kind="listing" /><StatusBadge value={detailProduct.moderationStatus} kind="moderation" /></div>
            <p>{detailProduct.description}</p>
            <div className="workspace-detail-meta"><span>Category <b>{detailProduct.category.name}</b></span><span>Price <b>{formatPrice(detailProduct.basePriceMinor, detailProduct.currency)}</b></span><span>Stock <b>{detailProduct.stockOnHand}</b></span></div>
            <h3>Variants</h3><div className="workspace-variant-detail-list">{detailProduct.variants.map((variant) => <div key={variant.id}><span><b>{variant.name}</b><small>{variant.sku}</small></span><span>{variant.stockOnHand} units</span></div>)}</div>
            {detailProduct.specifications.length > 0 && <><h3>Specifications</h3><div className="workspace-detail-specs">{detailProduct.specifications.map((specification) => <div key={specification.id ?? specification.name}><span>{specification.name}</span><b>{specification.value}</b></div>)}</div></>}
            {detailProduct.images.length > 0 && <div className="workspace-detail-gallery">{detailProduct.images.map((image, index) => <img key={image.id ?? image.url} src={image.url} alt={image.altText || `${detailProduct.name} image ${index + 1}`} />)}</div>}
            <button className="workspace-button workspace-button-dark" onClick={() => { setDetailProduct(null); void openEdit(detailProduct.id) }}><Pencil size={15} />Edit product</button>
          </motion.section>
        </motion.div>}
        {adjustingVariant && <motion.div className="workspace-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setAdjustingVariant(null) }}>
          <motion.section className="workspace-detail-modal workspace-adjust-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-adjust-title" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}>
            <div className="workspace-modal-heading"><div><p className="workspace-eyebrow">INVENTORY ADJUSTMENT</p><h2 id="workspace-adjust-title">Adjust stock</h2></div><button className="workspace-icon-button" aria-label="Close adjustment dialog" onClick={() => setAdjustingVariant(null)}><X size={19} /></button></div>
            <p>{adjustingVariant.name} · <span className="workspace-mono">{adjustingVariant.sku}</span></p>
            <div className="workspace-adjust-preview"><span>Current stock <b>{adjustingVariant.stockOnHand}</b></span><span>New stock <b>{adjustingVariant.stockOnHand + (Number(adjustment.quantityChange) || 0)}</b></span></div>
            {formError && <Alert>{formError}</Alert>}
            <form className="workspace-form-grid" onSubmit={(event) => void submitAdjustment(event)}>
              <label className="workspace-field">Signed quantity change<input type="number" min={-adjustingVariant.stockOnHand} max={2_147_483_647 - adjustingVariant.stockOnHand} step="1" value={adjustment.quantityChange} onChange={(event) => setAdjustment((current) => ({ ...current, quantityChange: event.target.value }))} placeholder="+10 or -2" required /></label>
              <label className="workspace-field">Reason<select value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value as typeof adjustmentReasons[number] }))}>{adjustmentReasons.map((reason) => <option key={reason} value={reason}>{titleCase(reason)}</option>)}</select></label>
              <label className="workspace-field workspace-field-wide">Note {['CORRECTION', 'DAMAGE', 'OTHER'].includes(adjustment.reason) ? '(required)' : '(optional)'}<textarea value={adjustment.note} onChange={(event) => setAdjustment((current) => ({ ...current, note: event.target.value }))} maxLength={500} rows={3} required={['CORRECTION', 'DAMAGE', 'OTHER'].includes(adjustment.reason)} /></label>
              <div className="workspace-form-footer workspace-field-wide"><button type="button" className="workspace-button workspace-button-light" onClick={() => setAdjustingVariant(null)}>Cancel</button><button type="submit" className="workspace-button workspace-button-dark" disabled={saving}>{saving ? 'Recording…' : 'Confirm adjustment'}<Check size={15} /></button></div>
            </form>
          </motion.section>
        </motion.div>}
      </AnimatePresence>
    </main>
  )
}

function ProductTable({ products, onDetails, onEdit, onArchive, saving }: {
  products: SellerProduct[]
  onDetails: (product: SellerProduct) => void
  onEdit: (product: SellerProduct) => void
  onArchive: (product: SellerProduct) => void
  saving: boolean
}) {
  return <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Listing</th><th>Review</th><th>Variants / stock</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {products.map((product) => <tr key={product.id}>
      <td><button className="workspace-product-cell" type="button" onClick={() => onDetails(product)}>{product.images[0] ? <img src={product.images[0].url} alt="" /> : <span className="workspace-product-placeholder"><Boxes size={16} /></span>}<span><b>{product.name}</b><small>{product.slug}</small></span></button></td>
      <td>{product.category.name}</td><td>{formatPrice(product.basePriceMinor, product.currency)}</td>
      <td><StatusBadge value={product.status} kind="listing" /></td><td><StatusBadge value={product.moderationStatus} kind="moderation" /></td>
      <td>{product.variantCount} variants<small>{product.stockOnHand} units</small></td>
      <td><div className="workspace-row-actions"><button type="button" aria-label={`View ${product.name}`} onClick={() => onDetails(product)}><Search size={15} /></button><button type="button" aria-label={`Edit ${product.name}`} onClick={() => onEdit(product)}><Pencil size={15} /></button><button type="button" aria-label={`Archive ${product.name}`} disabled={saving || product.status === 'ARCHIVED'} onClick={() => onArchive(product)}><Archive size={15} /></button></div></td>
    </tr>)}
  </tbody></table></div>
}

function ModerationNotice({ product }: { product: SellerProduct }) {
  if (product.moderationStatus === 'PENDING_REVIEW') return <Alert type="warning">This listing is awaiting administrator review and is not publicly visible yet.</Alert>
  if (product.moderationStatus === 'DISABLED') return <Alert type="warning"><span><b>Disabled by an administrator.</b> Seller edits cannot re-enable this listing. {product.moderationNote || 'Administrator review is required.'}</span></Alert>
  return <Alert type="success">Approved for public visibility when the listing status is Published.</Alert>
}

function Metric({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: ReactNode }) {
  return <article className="workspace-metric"><span className="workspace-metric-icon">{icon}</span><span className="workspace-metric-label">{label}</span><strong>{value.toLocaleString('en-IN')}</strong><small>{detail}</small></article>
}

function FormHeading({ number, title, detail, action }: { number: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="workspace-form-heading"><span>{number}</span><div><h2>{title}</h2><p>{detail}</p></div>{action}</div>
}

function Pagination({ page, pages, total, itemLabel = 'products', onChange }: { page: number; pages: number; total: number; itemLabel?: string; onChange: (page: number) => void }) {
  if (total === 0) return null
  const label = itemLabel === 'entry' ? (total === 1 ? 'entry' : 'entries') : `${itemLabel}${total === 1 ? '' : 's'}`
  return <div className="workspace-pagination"><span>{total} {label} · Page {page} of {Math.max(pages, 1)}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button></div></div>
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="workspace-empty"><span><Boxes size={21} /></span><b>{title}</b><p>{detail}</p>{action && onAction && <button className="workspace-button workspace-button-light" onClick={onAction}>{action}<ArrowRight size={14} /></button>}</div>
}

function LoadingCards() {
  return <div className="workspace-metrics" aria-label="Loading seller summary" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div className="workspace-skeleton-card" key={index} />)}</div>
}

function LoadingTable() {
  return <div className="workspace-loading-table" aria-label="Loading products" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
}

function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function ImageIcon() {
  return <span className="workspace-image-empty"><Boxes size={18} />Preview unavailable</span>
}

function ShieldCheckIcon() {
  return <span aria-hidden="true">✓</span>
}
