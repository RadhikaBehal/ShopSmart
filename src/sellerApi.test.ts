import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminSellerApplication,
  getAdminSellerApplications,
  getMySellerApplication,
  getPublicSellerStore,
  getSellerDashboard,
  reviewSellerApplication,
  saveSellerApplication,
  setSellerStatus,
  submitSellerApplication,
  SellerApiError,
  updateSellerProfile,
} from './sellerApi'

const application = {
  id: 'application-1',
  userId: 'user-1',
  businessName: 'Northwind Workshop',
  storeName: 'Northwind Goods',
  storeNameNormalized: 'northwind goods',
  businessType: 'INDIVIDUAL',
  description: 'An independent business creating useful, long-lasting goods.',
  contactEmail: 'seller@example.test',
  contactPhone: '+91 98765 43210',
  addressLine1: '12 Market Road',
  addressLine2: null,
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  country: 'India',
  slug: 'northwind-goods',
  status: 'SUBMITTED',
  reviewMessage: null,
  submittedAt: '2026-11-02T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  user: { id: 'user-1', email: 'seller@example.test', displayName: 'Seller' },
  history: [{
    id: 'history-1',
    action: 'APPLICATION_SUBMITTED',
    fromStatus: 'DRAFT',
    toStatus: 'SUBMITTED',
    note: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    actor: { displayName: 'Seller', email: 'seller@example.test' },
  }],
}

afterEach(() => vi.unstubAllGlobals())

describe('seller API client', () => {
  it('loads and saves a single application draft using credentialed, authenticated requests', async () => {
    const calls: Array<{ url: URL; options: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
      const url = new URL(String(input), window.location.origin)
      calls.push({ url, options })
      if (options.method === 'PUT') return new Response(JSON.stringify({ application }), { status: 200 })
      return new Response(JSON.stringify({ application: null }), { status: 200 })
    }))

    expect(await getMySellerApplication('access-1')).toBeNull()
    const draft = await saveSellerApplication('access-1', {
      businessName: application.businessName,
      storeName: application.storeName,
      businessType: 'INDIVIDUAL',
      description: application.description,
      contactEmail: application.contactEmail,
      contactPhone: application.contactPhone,
      addressLine1: application.addressLine1,
      addressLine2: '',
      city: application.city,
      state: application.state,
      postalCode: application.postalCode,
      country: application.country,
      slug: application.slug,
    })

    expect(draft.id).toBe('application-1')
    expect(draft.addressLine2).toBe('')
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      '/api/v1/seller/applications/me',
      '/api/v1/seller/applications/me',
    ])
    expect(calls[0].options.credentials).toBe('include')
    expect(new Headers(calls[0].options.headers).get('Authorization')).toMatch(/^Bearer /)
    expect(calls[1].options.method).toBe('PUT')
  })

  it('sends review, submission, and admin list filters through the typed client', async () => {
    const calls: Array<{ url: URL; options: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
      const url = new URL(String(input), window.location.origin)
      calls.push({ url, options })
      return new Response(JSON.stringify(
        url.pathname.endsWith('/admin/applications') ? { items: [application] } : { application },
      ), { status: 200 })
    }))

    expect((await submitSellerApplication('admin-access')).status).toBe('SUBMITTED')
    expect((await getAdminSellerApplications('admin-access', 'SUBMITTED'))[0].id).toBe('application-1')
    expect((await getAdminSellerApplication('admin-access', 'application-1')).history?.[0].action).toBe('APPLICATION_SUBMITTED')
    expect((await reviewSellerApplication('admin-access', 'application-1', 'approve', 'Reviewed.')).status).toBe('SUBMITTED')
    expect(calls[1].url.searchParams.get('status')).toBe('SUBMITTED')
    expect(calls[3].options.method).toBe('POST')
    expect(JSON.parse(String(calls[3].options.body))).toEqual({ action: 'approve', note: 'Reviewed.' })
  })

  it('loads and updates a seller dashboard, then restricts public store fields to its API response', async () => {
    const seller = {
      id: 'seller-1',
      slug: 'northwind-goods',
      displayName: 'Northwind Goods',
      businessName: 'Northwind Workshop',
      businessType: 'INDIVIDUAL',
      description: application.description,
      contactEmail: application.contactEmail,
      contactPhone: application.contactPhone,
      logoUrl: null,
      bannerUrl: null,
      shippingPolicy: null,
      returnPolicy: null,
      status: 'VERIFIED',
      accountEmail: application.contactEmail,
    }
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      calls.push(url.pathname)
      if (url.pathname === '/api/v1/stores/northwind-goods') {
        return new Response(JSON.stringify({
          store: {
            slug: seller.slug,
            displayName: seller.displayName,
            description: seller.description,
            businessType: seller.businessType,
            contactEmail: seller.contactEmail,
            contactPhone: seller.contactPhone,
            logoUrl: null,
            bannerUrl: null,
            shippingPolicy: null,
            returnPolicy: null,
            status: 'VERIFIED',
            verificationStatus: 'VERIFIED',
          },
        }), { status: 200 })
      }
      if (url.pathname === '/api/v1/seller/me') {
        return new Response(JSON.stringify({ seller, application, publishedProductCount: 0 }), { status: 200 })
      }
      return new Response(JSON.stringify({ seller }), { status: 200 })
    }))

    const dashboard = await getSellerDashboard('seller-access')
    expect(dashboard.seller.status).toBe('VERIFIED')
    expect(dashboard.application?.id).toBe('application-1')
    expect((await updateSellerProfile('seller-access', { displayName: 'Northwind Home' })).displayName).toBe('Northwind Goods')
    const store = await getPublicSellerStore('northwind-goods')
    expect(store.verificationStatus).toBe('VERIFIED')
    expect('businessName' in store).toBe(false)
    expect(calls).toContain('/api/v1/stores/northwind-goods')
  })

  it('loads seller directories, sends suspension actions, and surfaces access failures', async () => {
    const calls: RequestInit[] = []
    const entry = {
      id: 'seller-1',
      userId: 'seller-user-1',
      slug: 'northwind-goods',
      displayName: 'Northwind Goods',
      status: 'SUSPENDED',
      createdAt: '2026-11-01T00:00:00.000Z',
      user: { email: 'seller@example.test', displayName: 'Seller', sellerApplication: { status: 'APPROVED' } },
    }
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options: RequestInit = {}) => {
      calls.push(options)
      return new Response(JSON.stringify({ items: [entry], seller: entry }), { status: 200 })
    }))
    const { getAdminSellers } = await import('./sellerApi')
    expect((await getAdminSellers('admin-access'))[0].status).toBe('SUSPENDED')
    expect((await setSellerStatus('admin-access', entry.id, 'reactivate')).user.email).toBe('seller@example.test')
    expect(calls[1].method).toBe('PATCH')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'An approved seller account is required' }), { status: 403 })))
    await expect(getSellerDashboard('customer-access')).rejects.toMatchObject({
      name: 'SellerApiError',
      status: 403,
      message: 'An approved seller account is required',
    } satisfies Partial<SellerApiError>)
  })
})
