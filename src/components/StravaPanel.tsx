import { useState, type FormEvent } from 'react'
import { Activity, Check, Link2, RefreshCw, Unplug } from 'lucide-react'

export type StravaUiStatus = 'not-configured' | 'disconnected' | 'connected' | 'syncing' | 'error'

type Props = {
  configured: boolean
  status: StravaUiStatus
  athleteName: string
  lastSync: string
  message: string
  onConnect: (password: string) => Promise<void>
  onSync: () => void
  onDisconnect: () => void
}

function syncLabel(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function StravaPanel({ configured, status, athleteName, lastSync, message, onConnect, onSync, onDisconnect }: Props) {
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [password, setPassword] = useState('')
  const busy = status === 'syncing'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onConnect(password)
    setPassword('')
    setShowPasswordForm(false)
  }

  return (
    <section className="strava-card" aria-label="Strava activity sync">
      <div className="strava-card-heading">
        <span className="strava-icon"><Activity size={16} /></span>
        <span className="section-kicker">STRAVA SYNC</span>
        <span className={`strava-status-pill strava-status-${status}`}>
          {status === 'connected' ? 'Connected' : status === 'syncing' ? 'Syncing' : status === 'not-configured' ? 'Setup needed' : status === 'error' ? 'Check setup' : 'Not linked'}
        </span>
      </div>
      <p className="strava-description">Match recorded swims, rides, runs, and strength sessions to your plan.</p>
      {status === 'connected' ? (
        <div className="strava-connected-row">
          <span className="strava-athlete"><Check size={14} /> {athleteName || 'Strava athlete'}</span>
          <span className="strava-sync-time">{lastSync ? `Synced ${syncLabel(lastSync)}` : 'Ready to sync'}</span>
        </div>
      ) : status === 'not-configured' ? (
        <p className="strava-message">The secure Strava service still needs to be deployed.</p>
      ) : null}
      {message && status !== 'connected' && <p className="strava-message strava-message-error" role="status">{message}</p>}
      {showPasswordForm && configured && status !== 'connected' ? (
        <form className="strava-password-form" onSubmit={submit}>
          <label htmlFor="strava-app-password">Private app access password</label>
          <input id="strava-app-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <p>Your access password is only sent to the secure sync service.</p>
          <div className="strava-actions"><button type="submit" className="strava-primary-button" disabled={busy || !password}>Continue to Strava <Link2 size={14} /></button><button type="button" className="strava-cancel-button" onClick={() => setShowPasswordForm(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="strava-actions">
          {status === 'connected' ? (
            <>
              <button type="button" className="strava-primary-button" onClick={onSync} disabled={busy}><RefreshCw size={14} className={busy ? 'strava-spinning' : ''} /> {busy ? 'Syncing activities…' : 'Sync now'}</button>
              <button type="button" className="strava-disconnect-button" onClick={onDisconnect} disabled={busy} aria-label="Disconnect Strava" title="Disconnect Strava"><Unplug size={15} /></button>
            </>
          ) : (
            <button type="button" className="strava-primary-button" disabled={!configured || busy} onClick={() => setShowPasswordForm(true)}><Link2 size={14} /> Connect Strava</button>
          )}
        </div>
      )}
      <p className="strava-privacy-note">Read-only activity access. Matching uses sport and local date; no route data is stored.</p>
    </section>
  )
}
