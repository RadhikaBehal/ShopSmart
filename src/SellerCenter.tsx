import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, ExternalLink, Image, MapPin, ShieldCheck, Store } from 'lucide-react'
import {
  getAdminSellerApplication,
  getAdminSellerApplications,
  getAdminSellers,
  getMySellerApplication,
  getSellerDashboard,
  reviewSellerApplication,
  saveSellerApplication,
  setSellerStatus,
  submitSellerApplication,
  updateSellerProfile,
  type SellerApplication,
  type SellerApplicationInput,
  type SellerApplicationStatus,
  type SellerBusinessType,
  type SellerDirectoryEntry,
  type SellerProfile,
} from './sellerApi'
import type { AuthRole } from './authApi'

type SellerCenterProps = {
  accessToken: string
  role: AuthRole
  userEmail: string
  onBack: () => void
}

const blankApplication = (email: string): SellerApplicationInput => ({
  businessName: '',
  storeName: '',
  businessType: 'INDIVIDUAL',
  description: '',
  contactEmail: email,
  contactPhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
  slug: '',
})

const statusLabel = (status: SellerApplicationStatus | SellerProfile['status']) =>
  status.replaceAll('_', ' ').toLowerCase()

const applicationStatuses: SellerApplicationStatus[] = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED',
]

export function SellerCenter({ accessToken, role, userEmail, onBack }: SellerCenterProps) {
  const [application, setApplication] = useState<SellerApplication | null>(null)
  const [draft, setDraft] = useState<SellerApplicationInput>(() => blankApplication(userEmail))
  const [seller, setSeller] = useState<SellerProfile | null>(null)
  const [productCount, setProductCount] = useState(0)
  const [applications, setApplications] = useState<SellerApplication[]>([])
  const [sellers, setSellers] = useState<SellerDirectoryEntry[]>([])
  const [selectedApplication, setSelectedApplication] = useState<SellerApplication | null>(null)
  const [filter, setFilter] = useState<SellerApplicationStatus | ''>('')
  const [reviewNote, setReviewNote] = useState('')
  const [view, setView] = useState<'home' | 'application-detail'>('home')
  const [loading, setLoading] = useState(true)
  const [loadRetry, setLoadRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadAdminData = useCallback(async (status?: SellerApplicationStatus | '') => {
    const [applicationRows, sellerRows] = await Promise.all([
      getAdminSellerApplications(accessToken, status || undefined),
      getAdminSellers(accessToken),
    ])
    setApplications(applicationRows)
    setSellers(sellerRows)
  }, [accessToken])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        if (role === 'CUSTOMER') {
          const current = await getMySellerApplication(accessToken)
          if (active && current) {
            setApplication(current)
            setDraft({
              businessName: current.businessName,
              storeName: current.storeName,
              businessType: current.businessType,
              description: current.description,
              contactEmail: current.contactEmail,
              contactPhone: current.contactPhone,
              addressLine1: current.addressLine1,
              addressLine2: current.addressLine2 ?? '',
              city: current.city,
              state: current.state,
              postalCode: current.postalCode,
              country: current.country,
              slug: current.slug,
            })
          }
        } else if (role === 'SELLER') {
          const dashboard = await getSellerDashboard(accessToken)
          if (active) {
            setSeller(dashboard.seller)
            setApplication(dashboard.application)
            setProductCount(dashboard.publishedProductCount)
          }
        } else if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
          await loadAdminData()
        }
      } catch (loadError: unknown) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Seller information could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [accessToken, loadAdminData, loadRetry, role])

  function setField<K extends keyof SellerApplicationInput>(field: K, value: SellerApplicationInput[K]) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await saveSellerApplication(accessToken, draft)
      setApplication(saved)
      setDraft((current) => ({ ...current, addressLine2: saved.addressLine2 ?? '' }))
      setMessage('Your application draft is saved.')
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The application draft could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function submitApplication() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await submitSellerApplication(accessToken)
      setApplication(saved)
      setMessage('Your application has been submitted for review.')
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'The application could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  async function saveStoreProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!seller) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const updated = await updateSellerProfile(accessToken, {
        displayName: seller.displayName,
        slug: seller.slug,
        description: seller.description,
        contactEmail: seller.contactEmail || null,
        contactPhone: seller.contactPhone || null,
        shippingPolicy: seller.shippingPolicy || null,
        returnPolicy: seller.returnPolicy || null,
        logoUrl: seller.logoUrl,
        bannerUrl: seller.bannerUrl,
      })
      setSeller(updated)
      setMessage('Your public store profile has been updated.')
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The store profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function openApplication(applicationId: string) {
    setLoading(true)
    setError('')
    try {
      setSelectedApplication(await getAdminSellerApplication(accessToken, applicationId))
      setView('application-detail')
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'The application could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  async function reviewApplication(action: 'under-review' | 'needs-information' | 'approve' | 'reject') {
    if (!selectedApplication) return
    if ((action === 'approve' || action === 'reject') && !window.confirm(`Confirm ${action === 'approve' ? 'approval' : 'rejection'} of ${selectedApplication.storeName}?`)) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const updated = await reviewSellerApplication(accessToken, selectedApplication.id, action, reviewNote.trim() || undefined)
      setSelectedApplication(await getAdminSellerApplication(accessToken, updated.id))
      await loadAdminData(filter)
      setMessage(action === 'approve'
        ? 'Seller approved. Seller permissions are now active.'
        : action === 'reject'
          ? 'Application rejected and the reason recorded.'
          : action === 'needs-information'
            ? 'The applicant has been asked for more information.'
            : 'Application moved into review.')
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : 'The application decision could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changeSellerStatus(entry: SellerDirectoryEntry, action: 'suspend' | 'reactivate') {
    if (!window.confirm(`${action === 'suspend' ? 'Suspend' : 'Reactivate'} ${entry.displayName}?`)) return
    setSaving(true)
    setError('')
    try {
      await setSellerStatus(accessToken, entry.id, action)
      await loadAdminData(filter)
      setMessage(action === 'suspend' ? 'Seller suspended; seller access has been removed.' : 'Seller reactivated.')
    } catch (statusError: unknown) {
      setError(statusError instanceof Error ? statusError.message : 'Seller status could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  async function changeFilter(status: SellerApplicationStatus | '') {
    setFilter(status)
    setLoading(true)
    setError('')
    try {
      await loadAdminData(status)
    } catch (filterError: unknown) {
      setError(filterError instanceof Error ? filterError.message : 'Applications could not be filtered.')
    } finally {
      setLoading(false)
    }
  }

  const canEditApplication = !application || ['DRAFT', 'NEEDS_INFORMATION', 'REJECTED'].includes(application.status)
  const canSubmitApplication = application !== null && ['DRAFT', 'NEEDS_INFORMATION'].includes(application.status)

  return (
    <section className="seller-center" aria-label="Seller center">
      <button className="seller-back-link" type="button" onClick={view === 'application-detail' ? () => setView('home') : onBack}>
        <ArrowLeft size={15} /> {view === 'application-detail' ? 'Back to seller management' : 'Back to account'}
      </button>
      {loading && <p className="account-status" role="status">Loading seller information…</p>}
      {error && <p className="account-error" role="alert">{error} <button className="seller-inline-retry" type="button" onClick={() => { setError(''); setLoading(true); setLoadRetry((current) => current + 1) }}>Try again</button></p>}
      {message && <p className="account-success" role="status"><BadgeCheck size={14} />{message}</p>}

      {role === 'CUSTOMER' && (
        <div className="seller-application">
          <div className="seller-section-intro">
            <span className="seller-icon"><Store size={20} /></span>
            <div><h3>Build your independent store.</h3><p>Share your business details for a manual platform review. No identity documents are collected.</p></div>
          </div>
          {application && <div className={`seller-status seller-status-${application.status.toLowerCase()}`}><ShieldCheck size={15} /><span>Application status: <b>{statusLabel(application.status)}</b></span></div>}
          {application?.reviewMessage && <p className="seller-review-message"><b>Reviewer note</b>{application.reviewMessage}</p>}
          <form className="account-form seller-form" onSubmit={(event) => void saveDraft(event)}>
            <label>Business name<input value={draft.businessName} onChange={(event) => setField('businessName', event.target.value)} minLength={2} maxLength={120} required disabled={!canEditApplication || saving} /></label>
            <label>Store name<input value={draft.storeName} onChange={(event) => setField('storeName', event.target.value)} minLength={2} maxLength={100} required disabled={!canEditApplication || saving} /></label>
            <label>Store URL slug<div className="seller-slug-input"><span>shopsmart.example/store/</span><input aria-label="Store URL slug" value={draft.slug} onChange={(event) => setField('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-'))} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} required disabled={!canEditApplication || saving} /></div></label>
            <label>Business type<select value={draft.businessType} onChange={(event) => setField('businessType', event.target.value as SellerBusinessType)} disabled={!canEditApplication || saving}><option value="INDIVIDUAL">Individual</option><option value="PARTNERSHIP">Partnership</option><option value="PRIVATE_LIMITED">Private limited</option><option value="OTHER">Other</option></select></label>
            <label className="seller-form-wide">Business description<textarea value={draft.description} onChange={(event) => setField('description', event.target.value)} minLength={20} maxLength={2000} rows={4} required disabled={!canEditApplication || saving} /></label>
            <label>Contact email<input type="email" autoComplete="email" value={draft.contactEmail} onChange={(event) => setField('contactEmail', event.target.value)} maxLength={254} required disabled={!canEditApplication || saving} /></label>
            <label>Contact phone<input type="tel" autoComplete="tel" value={draft.contactPhone} onChange={(event) => setField('contactPhone', event.target.value)} minLength={7} maxLength={30} required disabled={!canEditApplication || saving} /></label>
            <label className="seller-form-wide">Business address<input autoComplete="address-line1" value={draft.addressLine1} onChange={(event) => setField('addressLine1', event.target.value)} minLength={3} maxLength={160} required disabled={!canEditApplication || saving} /></label>
            <label className="seller-form-wide">Address line 2 <span className="seller-optional">(optional)</span><input autoComplete="address-line2" value={draft.addressLine2} onChange={(event) => setField('addressLine2', event.target.value)} maxLength={160} disabled={!canEditApplication || saving} /></label>
            <label>City<input autoComplete="address-level2" value={draft.city} onChange={(event) => setField('city', event.target.value)} minLength={2} maxLength={100} required disabled={!canEditApplication || saving} /></label>
            <label>State / region<input autoComplete="address-level1" value={draft.state} onChange={(event) => setField('state', event.target.value)} minLength={2} maxLength={100} required disabled={!canEditApplication || saving} /></label>
            <label>Postal code<input autoComplete="postal-code" value={draft.postalCode} onChange={(event) => setField('postalCode', event.target.value)} minLength={2} maxLength={24} required disabled={!canEditApplication || saving} /></label>
            <label>Country<input autoComplete="country-name" value={draft.country} onChange={(event) => setField('country', event.target.value)} minLength={2} maxLength={80} required disabled={!canEditApplication || saving} /></label>
            {canEditApplication && <div className="seller-form-actions seller-form-wide">
              <button className="button button-outline" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save draft'} <ArrowRight size={14} /></button>
              <button className="button button-dark" type="button" disabled={saving || !canSubmitApplication} onClick={() => void submitApplication()}>Submit for review <ArrowRight size={14} /></button>
            </div>}
          </form>
          <p className="seller-privacy-note">Your address and business application details are private to you and authorized reviewers. Public store pages show only the contact details and policies you choose to publish.</p>
        </div>
      )}

      {role === 'SELLER' && seller && (
        <div className="seller-dashboard">
          <div className="seller-dashboard-banner">
            <div className="seller-banner-placeholder"><Image size={24} /><span>Store banner placeholder</span></div>
            <div className="seller-dashboard-title">
              <span className="seller-logo-placeholder"><Store size={21} /></span>
              <span><small>SELLER OVERVIEW</small><h3>{seller.displayName}</h3></span>
              <span className="seller-status seller-status-approved"><BadgeCheck size={14} /> Verified seller</span>
            </div>
          </div>
          <div className="seller-stats">
            <div><span>Store status</span><b>Active</b></div>
            <div><span>Published products</span><b>{productCount}</b></div>
            <div><span>Application</span><b>{application ? statusLabel(application.status) : 'Approved'}</b></div>
          </div>
          {application && <section className="seller-info-card">
            <h4><Building2 size={16} /> Business information</h4>
            <dl>
              <div><dt>Business</dt><dd>{application.businessName} · {application.businessType.replaceAll('_', ' ').toLowerCase()}</dd></div>
              <div><dt>Contact</dt><dd>{application.contactEmail} · {application.contactPhone}</dd></div>
              <div><dt>Address</dt><dd><MapPin size={13} /> {application.addressLine1}{application.addressLine2 ? `, ${application.addressLine2}` : ''}, {application.city}, {application.state} {application.postalCode}, {application.country}</dd></div>
            </dl>
          </section>}
          <form className="account-form seller-profile-form" onSubmit={(event) => void saveStoreProfile(event)}>
            <h4>Public store profile</h4>
            <label>Store name<input value={seller.displayName} onChange={(event) => setSeller({ ...seller, displayName: event.target.value })} minLength={2} maxLength={100} required /></label>
            <label>Store URL slug<input value={seller.slug} onChange={(event) => setSeller({ ...seller, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-') })} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} required /></label>
            <label className="seller-form-wide">Public description<textarea value={seller.description} onChange={(event) => setSeller({ ...seller, description: event.target.value })} minLength={20} maxLength={2000} rows={3} required /></label>
            <label>Public contact email<input type="email" value={seller.contactEmail ?? ''} onChange={(event) => setSeller({ ...seller, contactEmail: event.target.value })} maxLength={254} /></label>
            <label>Public contact phone<input type="tel" value={seller.contactPhone ?? ''} onChange={(event) => setSeller({ ...seller, contactPhone: event.target.value })} minLength={7} maxLength={30} /></label>
            <label className="seller-form-wide">Shipping policy<textarea value={seller.shippingPolicy ?? ''} onChange={(event) => setSeller({ ...seller, shippingPolicy: event.target.value })} maxLength={2000} rows={2} /></label>
            <label className="seller-form-wide">Returns policy<textarea value={seller.returnPolicy ?? ''} onChange={(event) => setSeller({ ...seller, returnPolicy: event.target.value })} maxLength={2000} rows={2} /></label>
            <button className="button button-dark seller-form-wide" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save store profile'} <ArrowRight size={14} /></button>
          </form>
          <a className="seller-public-link" href={`#store/${seller.slug}`}><ExternalLink size={14} /> View public storefront</a>
          {productCount === 0 && <div className="seller-empty-state"><Store size={21} /><b>Your store is ready for its first products.</b><p>Product listings and inventory management arrive in the next development milestone.</p></div>}
        </div>
      )}

      {(role === 'ADMIN' || role === 'SUPER_ADMIN') && view === 'home' && (
        <div className="seller-admin">
          <div className="seller-section-intro">
            <span className="seller-icon"><ShieldCheck size={20} /></span>
            <div><h3>Seller management.</h3><p>Review submitted business information and manage approved seller access.</p></div>
          </div>
          <label className="seller-filter">Filter applications<select value={filter} onChange={(event) => void changeFilter(event.target.value as SellerApplicationStatus | '')}><option value="">All statuses</option>{applicationStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
          <section className="seller-admin-list" aria-label="Seller applications">
            <h4>Applications <span>{applications.length}</span></h4>
            {applications.length === 0 ? <p className="seller-empty-inline">No applications match this status.</p> : applications.map((item) => <button type="button" key={item.id} className="seller-admin-row" onClick={() => void openApplication(item.id)}>
              <span><b>{item.storeName}</b><small>{item.user?.email ?? item.contactEmail}</small></span><span className={`seller-status seller-status-${item.status.toLowerCase()}`}>{statusLabel(item.status)} <ArrowRight size={13} /></span>
            </button>)}
          </section>
          <section className="seller-admin-list" aria-label="Approved sellers">
            <h4>Seller accounts <span>{sellers.length}</span></h4>
            {sellers.map((entry) => <div className="seller-admin-row seller-account-row" key={entry.id}>
              <span><b>{entry.displayName}</b><small>{entry.user.email} · {statusLabel(entry.status)}</small></span>
              {entry.status === 'VERIFIED'
                ? <button className="seller-action-link" type="button" disabled={saving} onClick={() => void changeSellerStatus(entry, 'suspend')}>Suspend</button>
                : entry.status === 'SUSPENDED' && entry.applicationStatus === 'APPROVED'
                  ? <button className="seller-action-link" type="button" disabled={saving} onClick={() => void changeSellerStatus(entry, 'reactivate')}>Reactivate</button>
                  : <span className="seller-action-muted">{entry.status === 'SUSPENDED' ? 'No approved application' : 'Not approved'}</span>}
            </div>)}
          </section>
        </div>
      )}

      {(role === 'ADMIN' || role === 'SUPER_ADMIN') && view === 'application-detail' && selectedApplication && (
        <div className="seller-admin-detail">
          <div className="seller-detail-heading"><span className="seller-status">{statusLabel(selectedApplication.status)}</span><h3>{selectedApplication.storeName}</h3><p>{selectedApplication.user?.displayName} · {selectedApplication.user?.email}</p></div>
          <section className="seller-info-card"><h4>Business information</h4><dl>
            <div><dt>Business name / type</dt><dd>{selectedApplication.businessName} · {selectedApplication.businessType.replaceAll('_', ' ').toLowerCase()}</dd></div>
            <div><dt>Store URL</dt><dd>{selectedApplication.slug}</dd></div>
            <div><dt>Description</dt><dd>{selectedApplication.description}</dd></div>
            <div><dt>Contact</dt><dd>{selectedApplication.contactEmail} · {selectedApplication.contactPhone}</dd></div>
            <div><dt>Business address</dt><dd>{selectedApplication.addressLine1}{selectedApplication.addressLine2 ? `, ${selectedApplication.addressLine2}` : ''}, {selectedApplication.city}, {selectedApplication.state} {selectedApplication.postalCode}, {selectedApplication.country}</dd></div>
          </dl></section>
          {selectedApplication.reviewMessage && <p className="seller-review-message"><b>Latest reviewer note</b>{selectedApplication.reviewMessage}</p>}
          {!['APPROVED', 'REJECTED'].includes(selectedApplication.status) && <div className="seller-review-actions">
            <label>Review note <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} rows={3} placeholder="Required for requests and rejections; optional for approval." /></label>
            {selectedApplication.status === 'SUBMITTED' && <button className="button button-outline" type="button" disabled={saving} onClick={() => void reviewApplication('under-review')}>Start review</button>}
            <button className="button button-outline" type="button" disabled={saving || !reviewNote.trim()} onClick={() => void reviewApplication('needs-information')}>Request information</button>
            <button className="button button-outline" type="button" disabled={saving || !reviewNote.trim()} onClick={() => void reviewApplication('reject')}>Reject application</button>
            <button className="button button-dark" type="button" disabled={saving} onClick={() => void reviewApplication('approve')}>Approve seller <ArrowRight size={14} /></button>
          </div>}
          <section className="seller-history" aria-label="Verification history">
            <h4>Verification history</h4>
            {(selectedApplication.history ?? []).length === 0
              ? <p>No review actions recorded yet.</p>
              : selectedApplication.history!.map((item) => <div className="seller-history-row" key={item.id}>
                <b>{item.action.replaceAll('_', ' ').toLowerCase()}</b>
                <span>{item.fromStatus ? `${statusLabel(item.fromStatus)} → ` : ''}{item.toStatus ? statusLabel(item.toStatus) : ''}</span>
                <small>{item.actor?.displayName ?? 'System'} · {new Date(item.createdAt).toLocaleString()}</small>
                {item.note && <p>{item.note}</p>}
              </div>)}
          </section>
        </div>
      )}

      {role !== 'CUSTOMER' && role !== 'SELLER' && role !== 'ADMIN' && role !== 'SUPER_ADMIN' && (
        <p className="seller-empty-state">Seller tools are available to customer applicants, approved sellers, and platform administrators.</p>
      )}
    </section>
  )
}
