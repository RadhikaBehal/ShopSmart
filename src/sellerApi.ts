import { API_BASE_URL } from './catalogApi'

export type SellerApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_INFORMATION'
  | 'APPROVED'
  | 'REJECTED'

export type SellerBusinessType = 'INDIVIDUAL' | 'PARTNERSHIP' | 'PRIVATE_LIMITED' | 'OTHER'

export type SellerApplicationInput = {
  businessName: string
  storeName: string
  businessType: SellerBusinessType
  description: string
  contactEmail: string
  contactPhone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  slug: string
}

export type SellerApplication = SellerApplicationInput & {
  id: string
  userId: string
  status: SellerApplicationStatus
  reviewMessage: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
  user?: { id: string; email: string; displayName: string }
  history?: SellerHistoryEntry[]
}

export type SellerHistoryEntry = {
  id: string
  action: string
  fromStatus: SellerApplicationStatus | null
  toStatus: SellerApplicationStatus | null
  note: string | null
  createdAt: string
  actor: { displayName: string; email: string } | null
}

export type SellerProfile = {
  id: string
  slug: string
  displayName: string
  businessName?: string | null
  businessType?: SellerBusinessType
  description: string
  contactEmail: string | null
  contactPhone: string | null
  logoUrl: string | null
  bannerUrl: string | null
  shippingPolicy: string | null
  returnPolicy: string | null
  status: 'PENDING' | 'VERIFIED' | 'SUSPENDED'
  accountEmail?: string
}

export type SellerStore = Omit<SellerProfile, 'id' | 'accountEmail' | 'businessName'> & {
  verificationStatus: 'VERIFIED'
}

export type SellerDirectoryEntry = {
  id: string
  userId: string
  slug: string
  displayName: string
  status: 'PENDING' | 'VERIFIED' | 'SUSPENDED'
  applicationStatus: SellerApplicationStatus | null
  createdAt: string
  user: { email: string; displayName: string }
}

export class SellerApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SellerApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new SellerApiError('The seller service returned an invalid profile field.')
}

async function requestJson(path: string, accessToken: string, options: {
  method?: 'GET' | 'PUT' | 'POST' | 'PATCH'
  body?: unknown
} = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/seller${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new SellerApiError('Could not reach the seller service. Please try again.')
  }
  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The seller request could not be completed.'
    throw new SellerApiError(message, response.status)
  }
  return payload
}

function parseApplication(value: unknown): SellerApplication {
  const statusList: SellerApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED']
  const businessTypeList: SellerBusinessType[] = ['INDIVIDUAL', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'OTHER']
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.userId !== 'string'
    || !statusList.includes(value.status as SellerApplicationStatus)
    || typeof value.businessName !== 'string'
    || typeof value.storeName !== 'string'
    || !businessTypeList.includes(value.businessType as SellerBusinessType)
    || typeof value.description !== 'string'
    || typeof value.contactEmail !== 'string'
    || typeof value.contactPhone !== 'string'
    || typeof value.addressLine1 !== 'string'
    || (value.addressLine2 !== null && typeof value.addressLine2 !== 'string')
    || typeof value.city !== 'string'
    || typeof value.state !== 'string'
    || typeof value.postalCode !== 'string'
    || typeof value.country !== 'string'
    || typeof value.slug !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new SellerApiError('The seller service returned an invalid application.')
  }
  const user = isRecord(value.user)
    && typeof value.user.id === 'string'
    && typeof value.user.email === 'string'
    && typeof value.user.displayName === 'string'
    ? { id: value.user.id, email: value.user.email, displayName: value.user.displayName }
    : undefined
  return {
    id: value.id,
    userId: value.userId,
    businessName: value.businessName,
    storeName: value.storeName,
    businessType: value.businessType as SellerBusinessType,
    description: value.description,
    contactEmail: value.contactEmail,
    contactPhone: value.contactPhone,
    addressLine1: value.addressLine1,
    addressLine2: value.addressLine2 ?? '',
    city: value.city,
    state: value.state,
    postalCode: value.postalCode,
    country: value.country,
    slug: value.slug,
    status: value.status as SellerApplicationStatus,
    reviewMessage: nullableString(value.reviewMessage),
    submittedAt: nullableString(value.submittedAt),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(user ? { user } : {}),
    ...(Array.isArray(value.history) ? { history: value.history.map(parseHistory) } : {}),
  }
}

function parseHistory(value: unknown): SellerHistoryEntry {
  const statuses: Array<SellerApplicationStatus | null> = [
    null, 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED',
  ]
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.action !== 'string'
    || !statuses.includes(value.fromStatus as SellerApplicationStatus | null)
    || !statuses.includes(value.toStatus as SellerApplicationStatus | null)
    || (value.note !== null && typeof value.note !== 'string')
    || typeof value.createdAt !== 'string') {
    throw new SellerApiError('The seller service returned invalid verification history.')
  }
  const actor = value.actor === null
    ? null
    : isRecord(value.actor) && typeof value.actor.displayName === 'string' && typeof value.actor.email === 'string'
      ? { displayName: value.actor.displayName, email: value.actor.email }
      : null
  return {
    id: value.id,
    action: value.action,
    fromStatus: value.fromStatus as SellerApplicationStatus | null,
    toStatus: value.toStatus as SellerApplicationStatus | null,
    note: value.note,
    createdAt: value.createdAt,
    actor,
  }
}

function parseSeller(value: unknown): SellerProfile {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.slug !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.description !== 'string'
    || !['PENDING', 'VERIFIED', 'SUSPENDED'].includes(String(value.status))) {
    throw new SellerApiError('The seller service returned an invalid store profile.')
  }
  const businessType = value.businessType
  if (businessType !== undefined && !['INDIVIDUAL', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'OTHER'].includes(String(businessType))) {
    throw new SellerApiError('The seller service returned an invalid business type.')
  }
  return {
    id: value.id,
    slug: value.slug,
    displayName: value.displayName,
    businessName: nullableString(value.businessName ?? null),
    ...(businessType === undefined ? {} : { businessType: businessType as SellerBusinessType }),
    description: value.description,
    contactEmail: nullableString(value.contactEmail ?? null),
    contactPhone: nullableString(value.contactPhone ?? null),
    logoUrl: nullableString(value.logoUrl ?? null),
    bannerUrl: nullableString(value.bannerUrl ?? null),
    shippingPolicy: nullableString(value.shippingPolicy ?? null),
    returnPolicy: nullableString(value.returnPolicy ?? null),
    status: value.status as SellerProfile['status'],
    ...(typeof value.accountEmail === 'string' ? { accountEmail: value.accountEmail } : {}),
  }
}

function parseDirectoryEntry(value: unknown): SellerDirectoryEntry {
  const user = isRecord(value) && isRecord(value.user) ? value.user : undefined
  const application = user?.sellerApplication
  const applicationStatus = application === null
    ? null
    : isRecord(application) && ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED'].includes(String(application.status))
      ? application.status as SellerApplicationStatus
      : undefined
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.userId !== 'string'
    || typeof value.slug !== 'string'
    || typeof value.displayName !== 'string'
    || !['PENDING', 'VERIFIED', 'SUSPENDED'].includes(String(value.status))
    || typeof value.createdAt !== 'string'
    || !user
    || typeof user.email !== 'string'
    || typeof user.displayName !== 'string'
    || applicationStatus === undefined) {
    throw new SellerApiError('The seller service returned an invalid seller listing.')
  }
  return {
    id: value.id,
    userId: value.userId,
    slug: value.slug,
    displayName: value.displayName,
    status: value.status as SellerDirectoryEntry['status'],
    applicationStatus,
    createdAt: value.createdAt,
    user: { email: user.email, displayName: user.displayName },
  }
}

export async function getMySellerApplication(accessToken: string): Promise<SellerApplication | null> {
  const payload = await requestJson('/applications/me', accessToken)
  if (!isRecord(payload) || !('application' in payload)) {
    throw new SellerApiError('The seller service returned an invalid application response.')
  }
  return payload.application === null ? null : parseApplication(payload.application)
}

export async function saveSellerApplication(accessToken: string, application: SellerApplicationInput): Promise<SellerApplication> {
  const payload = await requestJson('/applications/me', accessToken, { method: 'PUT', body: application })
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid application response.')
  return parseApplication(payload.application)
}

export async function submitSellerApplication(accessToken: string): Promise<SellerApplication> {
  const payload = await requestJson('/applications/me/submit', accessToken, { method: 'POST', body: {} })
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid application response.')
  return parseApplication(payload.application)
}

export async function getAdminSellerApplications(accessToken: string, status?: SellerApplicationStatus): Promise<SellerApplication[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const payload = await requestJson(`/admin/applications${query}`, accessToken)
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw new SellerApiError('The seller service returned an invalid application list.')
  return payload.items.map(parseApplication)
}

export async function getAdminSellerApplication(accessToken: string, applicationId: string): Promise<SellerApplication> {
  const payload = await requestJson(`/admin/applications/${encodeURIComponent(applicationId)}`, accessToken)
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid application.')
  return parseApplication(payload.application)
}

export async function reviewSellerApplication(accessToken: string, applicationId: string, action: 'under-review' | 'needs-information' | 'approve' | 'reject', note?: string): Promise<SellerApplication> {
  const payload = await requestJson(`/admin/applications/${encodeURIComponent(applicationId)}/review`, accessToken, {
    method: 'POST',
    body: { action, note },
  })
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid review response.')
  return parseApplication(payload.application)
}

export async function getAdminSellers(accessToken: string): Promise<SellerDirectoryEntry[]> {
  const payload = await requestJson('/admin/sellers', accessToken)
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw new SellerApiError('The seller service returned an invalid seller list.')
  return payload.items.map(parseDirectoryEntry)
}

export async function setSellerStatus(accessToken: string, sellerId: string, action: 'suspend' | 'reactivate', note?: string): Promise<SellerDirectoryEntry> {
  const payload = await requestJson(`/admin/sellers/${encodeURIComponent(sellerId)}/status`, accessToken, {
    method: 'PATCH',
    body: { action, note },
  })
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid seller status response.')
  return parseDirectoryEntry(payload.seller)
}

export async function getSellerDashboard(accessToken: string): Promise<{
  seller: SellerProfile
  application: SellerApplication | null
  publishedProductCount: number
}> {
  const payload = await requestJson('/me', accessToken)
  if (!isRecord(payload) || !isRecord(payload.seller) || typeof payload.publishedProductCount !== 'number') {
    throw new SellerApiError('The seller service returned an invalid dashboard.')
  }
  return {
    seller: parseSeller(payload.seller),
    application: payload.application === null ? null : parseApplication(payload.application),
    publishedProductCount: payload.publishedProductCount,
  }
}

export async function updateSellerProfile(accessToken: string, profile: Partial<SellerProfile>): Promise<SellerProfile> {
  const payload = await requestJson('/me', accessToken, { method: 'PATCH', body: profile })
  if (!isRecord(payload)) throw new SellerApiError('The seller service returned an invalid profile response.')
  return parseSeller(payload.seller)
}

export async function getPublicSellerStore(slug: string): Promise<SellerStore> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/stores/${encodeURIComponent(slug)}`)
  } catch {
    throw new SellerApiError('Could not reach the storefront service. Please try again.')
  }
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'The storefront could not be loaded.'
    throw new SellerApiError(message, response.status)
  }
  if (!isRecord(payload) || !isRecord(payload.store)
    || typeof payload.store.slug !== 'string'
    || typeof payload.store.displayName !== 'string'
    || typeof payload.store.description !== 'string'
    || payload.store.verificationStatus !== 'VERIFIED') {
    throw new SellerApiError('The storefront service returned an invalid public store.')
  }
  const publicProfile = parseSeller({
    id: '',
    ...payload.store,
  })
  const { id: _id, businessName: _businessName, accountEmail: _accountEmail, ...store } = publicProfile
  return { ...store, verificationStatus: 'VERIFIED' }
}
