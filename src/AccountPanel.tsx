import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Check, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  getCurrentUser,
  getAdminUsers,
  login,
  logout,
  refreshSession,
  register,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  verifyEmail,
  type AuthSession,
  type AuthUser,
} from './authApi'
import { SellerCenter } from './SellerCenter'
import { SellerWorkspace } from './SellerWorkspace'

export type AccountAction = 'verify' | 'reset'

type AccountPanelProps = {
  onClose: () => void
  initialAction?: AccountAction
  initialToken?: string
}

type AccountMode = 'login' | 'register' | 'profile' | 'admin' | 'seller' | 'seller-workspace' | 'forgot' | 'reset' | 'verify'

export function AccountPanel({ onClose, initialAction, initialToken = '' }: AccountPanelProps) {
  const [mode, setMode] = useState<AccountMode>(initialAction ?? 'login')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [directoryUsers, setDirectoryUsers] = useState<AuthUser[]>([])
  const [accessToken, setAccessToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(() => initialAction ? initialAction === 'verify' && Boolean(initialToken) : true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [token, setToken] = useState(initialToken)

  useEffect(() => {
    if (initialAction) {
      if (initialAction === 'verify' && initialToken) {
        verifyEmail(initialToken).then(() => {
          setMessage('Your email address is verified. You can now sign in.')
          setMode('login')
        }).catch((verificationError: unknown) => {
          setError(verificationError instanceof Error ? verificationError.message : 'Email verification could not be completed.')
        }).finally(() => setBusy(false))
      }
      return
    }

    let active = true
    async function restoreSession() {
      try {
        const renewedToken = await refreshSession()
        const restoredUser = await getCurrentUser(renewedToken)
        if (active) {
          setAccessToken(renewedToken)
          setUser(restoredUser)
          setDisplayName(restoredUser.displayName)
          setMode('profile')
        }
      } catch (restoreError: unknown) {
        if (active && !(restoreError instanceof Error && 'status' in restoreError && restoreError.status === 401)) {
          setError(restoreError instanceof Error ? restoreError.message : 'Your saved session could not be verified.')
        }
      } finally {
        if (active) setBusy(false)
      }
    }
    void restoreSession()
    return () => { active = false }
  }, [initialAction, initialToken])

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const session: AuthSession = mode === 'register'
        ? await register(email, password, displayName)
        : await login(email, password)
      setAccessToken(session.accessToken)
      setUser(session.user)
      setDisplayName(session.user.displayName)
      setPassword('')
      setMode('profile')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'The account request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await requestPasswordReset(email)
      setMessage('If an account exists for that address, password reset instructions have been sent.')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Password reset could not be requested.')
    } finally {
      setBusy(false)
    }
  }

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await resetPassword(token, password)
      setPassword('')
      setConfirmation('')
      setToken('')
      setMode('login')
      setMessage('Your password has been updated. Sign in with your new password.')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Password reset could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const updated = await updateProfile(accessToken, displayName)
      setUser(updated)
      setMessage('Your profile has been updated.')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Your profile could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function sendVerification() {
    if (!accessToken) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await requestEmailVerification(accessToken)
      setMessage('Verification instructions have been sent to your email.')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Verification email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function openAdminDirectory() {
    if (!accessToken) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setDirectoryUsers(await getAdminUsers(accessToken))
      setMode('admin')
    } catch (directoryError: unknown) {
      setError(directoryError instanceof Error ? directoryError.message : 'The account directory could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError('')
    try {
      await logout()
      setUser(null)
      setAccessToken('')
      setPassword('')
      setMode('login')
      setMessage('You have been signed out.')
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Sign out could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const heading = mode === 'profile'
    ? 'Good to see you.'
    : mode === 'register'
      ? 'Join ShopSmart.'
      : mode === 'forgot'
        ? 'A fresh start.'
        : mode === 'admin'
          ? 'Account directory.'
          : mode === 'seller'
            ? 'Seller center.'
          : mode === 'reset'
            ? 'Choose a new password.'
            : mode === 'verify'
              ? 'Confirm your email.'
              : 'Welcome back.'

  if (mode === 'seller-workspace' && user?.role === 'SELLER') {
    return <SellerWorkspace
      accessToken={accessToken}
      role={user.role}
      onBack={onClose}
      onStoreSettings={() => setMode('seller')}
      onLogout={() => void signOut()}
    />
  }

  return (
    <AnimatePresence>
      <motion.div
        className="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.aside
          className="cart-drawer account-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-heading"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.28 }}
        >
          <div className="drawer-heading">
            <div><div className="eyebrow">YOUR SHOPSMART ACCOUNT</div><h2 id="account-heading">{heading}</h2></div>
            <button className="icon-button" aria-label="Close account" onClick={onClose}><X size={20} /></button>
          </div>
          {busy && <p className="account-status" role="status">Connecting securely to the account service…</p>}
          {error && <p className="account-error" role="alert">{error}</p>}
          {message && <p className="account-success" role="status"><Check size={14} />{message}</p>}

          {mode === 'profile' && user && (
            <div className="account-profile">
              <span className="profile-avatar"><UserRound size={22} /></span>
              <h3>{user.displayName}</h3>
              <p>{user.email}</p>
              <span className="account-role"><ShieldCheck size={13} />{user.role.replaceAll('_', ' ').toLowerCase()}</span>
              <p className="account-security-note">Your refresh session is held in an httpOnly cookie. The short-lived access token stays in memory on this page.</p>
              <form className="account-form profile-edit-form" onSubmit={(event) => void saveProfile(event)}>
                <label htmlFor="account-display-name">Display name<input id="account-display-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} required /></label>
                <button className="button button-outline" type="submit" disabled={busy || displayName.trim() === user.displayName}>Save profile <ArrowRight size={15} /></button>
              </form>
              <div className="email-verification">
                <small>{user.emailVerified ? 'Email address verified' : 'Email address not yet verified'}</small>
                {!user.emailVerified && <button className="account-mode-toggle" disabled={busy} onClick={() => void sendVerification()}>Send verification email</button>}
              </div>
              {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && <button className="button button-outline" disabled={busy} onClick={() => void openAdminDirectory()}>Open account directory <ArrowRight size={15} /></button>}
              {(user.role === 'CUSTOMER' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && <button className="button button-outline" disabled={busy} onClick={() => setMode('seller')}>{user.role === 'CUSTOMER' ? 'Apply to sell or check application' : 'Manage seller applications'} <ArrowRight size={15} /></button>}
              {user.role === 'SELLER' && <>
                <button className="button button-outline" disabled={busy} onClick={() => setMode('seller-workspace')}>Open seller workspace <ArrowRight size={15} /></button>
                <button className="button button-outline" disabled={busy} onClick={() => setMode('seller')}>Store profile and settings <ArrowRight size={15} /></button>
              </>}
              <button className="button button-outline" disabled={busy} onClick={() => void signOut()}>Sign out <ArrowRight size={15} /></button>
            </div>
          )}

          {mode === 'seller' && user && <SellerCenter accessToken={accessToken} role={user.role} userEmail={user.email} onBack={() => setMode('profile')} />}

          {mode === 'admin' && (
            <section className="admin-directory" aria-label="Administrator account directory">
              <p>{directoryUsers.length} account{directoryUsers.length === 1 ? '' : 's'} shown</p>
              <ul>{directoryUsers.map((directoryUser) => <li key={directoryUser.id}>
                <span><b>{directoryUser.displayName}</b><small>{directoryUser.email}</small></span>
                <span className="admin-user-role">{directoryUser.role.replaceAll('_', ' ').toLowerCase()}{directoryUser.emailVerified ? ' · verified' : ''}</span>
              </li>)}</ul>
              <button className="button button-outline" onClick={() => setMode('profile')}>Back to account <ArrowRight size={15} /></button>
            </section>
          )}

          {(mode === 'login' || mode === 'register') && (
            <form className="account-form" onSubmit={(event) => void submitCredentials(event)}>
              {mode === 'register' && <label htmlFor="account-name">Your name<input id="account-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} required /></label>}
              <label htmlFor="account-email">Email address<input id="account-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
              <label htmlFor="account-password">Password<input id="account-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 12 : 1} maxLength={128} required /><small>{mode === 'register' ? 'Use at least 12 characters.' : 'Passwords are checked securely by the account API.'}</small></label>
              <button className="button button-dark checkout-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
              {mode === 'login' && <button className="account-mode-toggle" type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot your password?</button>}
              <p className="account-demo-note">Accounts require the API, PostgreSQL, and a configured server secret. Privileged roles are assigned by platform administrators.</p>
              <button className="account-mode-toggle" type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); setMessage('') }}>{mode === 'register' ? 'Already have an account? Sign in' : 'New to ShopSmart? Create an account'}</button>
            </form>
          )}

          {mode === 'forgot' && (
            <form className="account-form" onSubmit={(event) => void submitPasswordReset(event)}>
              <p className="account-demo-note">We’ll send a one-time reset link if an account matches this email.</p>
              <label htmlFor="reset-email">Email address<input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
              <button className="button button-dark checkout-button" type="submit" disabled={busy}>Send reset link <ArrowRight size={16} /></button>
              <button className="account-mode-toggle" type="button" onClick={() => { setMode('login'); setError(''); setMessage('') }}>Back to sign in</button>
            </form>
          )}

          {mode === 'reset' && (
            <form className="account-form" onSubmit={(event) => void submitNewPassword(event)}>
              {!token && <label htmlFor="reset-token">Reset token<input id="reset-token" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} minLength={32} maxLength={256} required /></label>}
              <label htmlFor="new-password">New password<input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required /></label>
              <label htmlFor="confirm-password">Confirm new password<input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} maxLength={128} required /></label>
              <button className="button button-dark checkout-button" type="submit" disabled={busy}>Update password <ArrowRight size={16} /></button>
            </form>
          )}

          {mode === 'verify' && (
            <div className="account-profile">
              <p className="account-security-note">Email verification links can only be used once and expire after 24 hours.</p>
              {!token && <label className="account-token-label" htmlFor="verification-token">Verification token<input id="verification-token" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} minLength={32} maxLength={256} /></label>}
              <button className="button button-dark" disabled={busy || !token} onClick={() => {
                setBusy(true)
                setError('')
                verifyEmail(token).then(() => setMessage('Your email address is verified.')).catch((verifyError: unknown) => setError(verifyError instanceof Error ? verifyError.message : 'Email verification could not be completed.')).finally(() => setBusy(false))
              }}>Verify email <ArrowRight size={15} /></button>
              <button className="account-mode-toggle" onClick={() => { setMode('login'); setError(''); setMessage('') }}>Back to sign in</button>
            </div>
          )}
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  )
}
