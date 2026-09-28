import { useRef, type ChangeEvent } from 'react'
import { Activity, Check, FileArchive, FileUp, LoaderCircle } from 'lucide-react'
import type { GarminActivity } from '../data/garminImport'

 type ImportSummary = {
  imported: number
  newlyMatched: number
  skipped: number
}

type Props = {
  activities: GarminActivity[]
  busy: boolean
  message: string
  summary: ImportSummary | null
  onImport: (files: File[]) => Promise<void>
}

function formatDistance(meters: number) {
  if (!meters) return ''
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number) {
  if (!seconds) return ''
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours}h ${remainder}m` : `${minutes} min`
}

export function GarminImportPanel({ activities, busy, message, summary, onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const recentActivities = [...activities].sort((first, second) => second.start_date_local.localeCompare(first.start_date_local)).slice(0, 3)

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length) await onImport(files)
  }

  return (
    <section className="garmin-card" aria-label="Garmin Connect activity import">
      <div className="garmin-card-heading">
        <span className="garmin-icon"><Activity size={16} /></span>
        <div className="garmin-title"><span className="section-kicker">GARMIN CONNECT</span><h3>Import activities</h3></div>
        {activities.length > 0 && <span className="garmin-count">{activities.length} saved</span>}
      </div>
      <p className="garmin-description">Import FIT, TCX, GPX, or a Garmin bulk-export ZIP. No Strava subscription or Garmin API approval needed.</p>
      <input ref={inputRef} className="garmin-file-input" type="file" accept=".fit,.tcx,.gpx,.zip" multiple onChange={handleFiles} aria-label="Choose Garmin activity files" />
      <button className="garmin-import-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <LoaderCircle size={15} className="garmin-loader" /> : <FileUp size={15} />}
        {busy ? 'Reading activity files…' : 'Choose Garmin export files'}
        {!busy && <FileArchive size={14} className="garmin-archive-icon" />}
      </button>
      {summary && <div className="garmin-result" role="status"><Check size={14} /><span>Imported {summary.imported}; matched {summary.newlyMatched} new sessions{summary.skipped ? `; skipped ${summary.skipped} unsupported or unreadable` : ''}.</span></div>}
      {message && <p className="garmin-error" role="alert">{message}</p>}
      {recentActivities.length > 0 && <div className="garmin-recent-list"><span className="section-kicker">RECENT IMPORTS</span>{recentActivities.map((activity) => <div className="garmin-recent-item" key={activity.id}><span><strong>{activity.name}</strong><small>{new Date(activity.start_date_local).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {activity.sport_type}</small></span><span className="garmin-recent-metrics">{formatDuration(activity.moving_time)}{activity.distance ? ` · ${formatDistance(activity.distance)}` : ''}</span></div>)}</div>}
      <div className="garmin-help"><strong>Export from Garmin Connect</strong><span>Open an activity → menu (⋯) → <b>Export Original</b>. For a bulk export, request your data in Account Settings and select the ZIP. Then choose the exported files here.</span></div>
      <p className="garmin-privacy-note">Files are parsed on this device only. Activity details stay in this browser and are never uploaded.</p>
    </section>
  )
}
