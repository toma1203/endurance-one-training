import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, Bike, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, Dumbbell, Footprints, Moon, Sun, Waves,
} from 'lucide-react'
import {
  addDays, calendarDaysBetween, dateFromISO, getPlanWorkouts, getTrainingDay, PLAN_START, TOTAL_PLAN_WEEKS,
  RACE_DAY, toISODate, trainingPhase, weekNumber, type Workout, type WorkoutType,
} from './data/trainingPlan'
import {
  createStravaSession, disconnectStrava, getStravaConnectionUrl, isStravaConfigured,
  stravaSessionStorageKey, syncStrava,
} from './data/stravaClient'
import { StravaPanel, type StravaUiStatus } from './components/StravaPanel'

type CompletionMap = Record<string, boolean>
type AdviceKey = 'swim' | 'bike' | 'run' | 'strength'

const completionStorageKey = 'endurance-one-completions-v1'
const themeStorageKey = 'endurance-one-theme'
const allWorkouts = getPlanWorkouts().flatMap((day) => day.workouts)
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const workoutLabels: Record<WorkoutType, string> = {
  swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Strength', rest: 'Recovery', race: 'Race day',
}
const workoutIcons = { swim: Waves, bike: Bike, run: Footprints, strength: Dumbbell, rest: Moon, race: Activity }

function mondayOf(value: string) {
  const date = dateFromISO(value)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return toISODate(date)
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return dateFromISO(value).toLocaleDateString('en-US', options)
}

function formatRange(first: string, last: string) {
  const start = dateFromISO(first)
  const end = dateFromISO(last)
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function durationForDay(workouts: Workout[]) {
  const minutes = workouts.reduce((sum, workout) => sum + workout.durationMinutes, 0)
  if (minutes === 0) return 'Rest day'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${minutes}m`
}

function App() {
  const [weekStart, setWeekStart] = useState(PLAN_START)
  const [selectedDate, setSelectedDate] = useState(addDays(PLAN_START, 1))
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(getTrainingDay(addDays(PLAN_START, 1)).workouts[0].id)
  const [completions, setCompletions] = useState<CompletionMap>(() => {
    try {
      return JSON.parse(localStorage.getItem(completionStorageKey) ?? '{}') as CompletionMap
    } catch {
      return {}
    }
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light')
  const [today] = useState(() => toISODate(new Date()))
  const [stravaSessionToken, setStravaSessionToken] = useState(() => localStorage.getItem(stravaSessionStorageKey) ?? '')
  const [stravaStatus, setStravaStatus] = useState<StravaUiStatus>(() => !isStravaConfigured ? 'not-configured' : localStorage.getItem(stravaSessionStorageKey) ? 'syncing' : 'disconnected')
  const [stravaAthleteName, setStravaAthleteName] = useState('')
  const [stravaLastSync, setStravaLastSync] = useState('')
  const [stravaMessage, setStravaMessage] = useState(() => stravaCallbackMessage(new URLSearchParams(window.location.search).get('strava')))
  const [adviceType, setAdviceType] = useState<AdviceKey>('bike')
  const [adviceShown, setAdviceShown] = useState(false)

  useEffect(() => {
    localStorage.setItem(completionStorageKey, JSON.stringify(completions))
  }, [completions])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('strava')
    if (!result) return
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.delete('strava')
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
  }, [])

  useEffect(() => {
    if (!isStravaConfigured || !stravaSessionToken) return

    let active = true
    syncStrava(stravaSessionToken).then((result) => {
      if (!active) return
      if (!result.connected) {
        setStravaStatus('disconnected')
        setStravaAthleteName('')
        return
      }
      setStravaAthleteName(result.athleteName)
      setCompletions((current) => mergeCompletions(current, result.completedWorkoutIds))
      setStravaLastSync(new Date().toISOString())
      setStravaMessage(`Checked ${result.activityCount} Strava activities.`)
      setStravaStatus('connected')
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof Error && error.message === 'unauthorized') {
        localStorage.removeItem(stravaSessionStorageKey)
        setStravaSessionToken('')
        setStravaMessage('Your Strava sync session expired. Connect again to continue.')
      } else {
        setStravaMessage(stravaErrorMessage(error))
      }
      setStravaStatus('error')
    })
    return () => { active = false }
  }, [stravaSessionToken])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    return date >= PLAN_START && date <= RACE_DAY ? getTrainingDay(date) : { date, workouts: [] }
  }), [weekStart])
  const selectedDay = weekDays.find((day) => day.date === selectedDate) ?? getTrainingDay(selectedDate)
  const selectedWorkout = selectedDay.workouts.find((workout) => workout.id === selectedWorkoutId) ?? selectedDay.workouts[0]
  const weekWorkouts = weekDays.flatMap((day) => day.workouts)
  const weekCompleted = weekWorkouts.filter((workout) => completions[workout.id]).length
  const weekPercent = weekWorkouts.length ? Math.round(weekCompleted / weekWorkouts.length * 100) : 0
  const totalCompleted = allWorkouts.filter((workout) => completions[workout.id]).length
  const overallPercent = Math.round(totalCompleted / allWorkouts.length * 100)
  const weekHours = (weekWorkouts.reduce((total, workout) => total + workout.durationMinutes, 0) / 60).toFixed(1)
  const thisWeek = weekNumber(weekStart)
  const phase = trainingPhase(thisWeek)
  const daysToRace = Math.max(0, calendarDaysBetween(today, RACE_DAY))
  const firstVisibleDate = weekDays.find((day) => day.workouts.length)?.date ?? weekStart
  const lastVisibleDate = [...weekDays].reverse().find((day) => day.workouts.length)?.date ?? weekStart

  function moveWeek(direction: number) {
    const nextStart = addDays(weekStart, direction * 7)
    if (nextStart > mondayOf(RACE_DAY) || addDays(nextStart, 6) < PLAN_START) return
    setWeekStart(nextStart)
    const nextSelected = addDays(selectedDate, direction * 7)
    const bounded = nextSelected < PLAN_START ? PLAN_START : nextSelected > RACE_DAY ? RACE_DAY : nextSelected
    setSelectedDate(bounded)
    const day = getTrainingDay(bounded)
    setSelectedWorkoutId(day.workouts[0]?.id ?? '')
  }

  function selectDay(date: string) {
    if (date < PLAN_START || date > RACE_DAY) return
    setSelectedDate(date)
    setSelectedWorkoutId(getTrainingDay(date).workouts[0]?.id ?? '')
  }

  function toggleWorkout(id: string) {
    setCompletions((current) => ({ ...current, [id]: !current[id] }))
  }

  async function connectStrava(password: string) {
    try {
      const token = await createStravaSession(password)
      const authorizationUrl = await getStravaConnectionUrl(token)
      localStorage.setItem(stravaSessionStorageKey, token)
      window.location.assign(authorizationUrl)
    } catch (error) {
      setStravaStatus('error')
      setStravaMessage(stravaErrorMessage(error))
    }
  }

  async function syncStravaNow() {
    if (!stravaSessionToken) return
    setStravaStatus('syncing')
    setStravaMessage('')
    try {
      const result = await syncStrava(stravaSessionToken)
      if (!result.connected) {
        setStravaStatus('disconnected')
        setStravaAthleteName('')
        return
      }
      setStravaAthleteName(result.athleteName)
      setCompletions((current) => mergeCompletions(current, result.completedWorkoutIds))
      setStravaLastSync(new Date().toISOString())
      setStravaMessage(`Checked ${result.activityCount} Strava activities.`)
      setStravaStatus('connected')
    } catch (error) {
      setStravaMessage(stravaErrorMessage(error))
      setStravaStatus('error')
    }
  }

  async function disconnectStravaAccount() {
    if (!stravaSessionToken) return
    setStravaStatus('syncing')
    try {
      await disconnectStrava(stravaSessionToken)
      localStorage.removeItem(stravaSessionStorageKey)
      setStravaSessionToken('')
      setStravaAthleteName('')
      setStravaLastSync('')
      setStravaMessage('Strava has been disconnected.')
      setStravaStatus('disconnected')
    } catch (error) {
      setStravaMessage(stravaErrorMessage(error))
      setStravaStatus('error')
    }
  }

  function selectWorkout(workout: Workout) {
    setSelectedDate(workout.date)
    setSelectedWorkoutId(workout.id)
  }

  function adviceText() {
    if (adviceType === 'bike') return 'Protect the Saturday long ride when you can. If weather is the issue, move indoors; if time is short, shorten the ride and keep it aerobic. Do not stack it beside another hard day.'
    if (adviceType === 'run') return 'Keep the next long run if you are healthy, but do not squeeze two long runs together. Swap to a treadmill, elliptical, or aqua jog when impact or weather is the problem.'
    if (adviceType === 'swim') return 'Aim to retain two swims in the week. A short technique swim still counts; if the pool is unavailable, use shoulder bands and core work, then shift one swim to an open day.'
    return 'Strength is the first thing to shorten or drop when life gets busy. A few minutes of mobility is plenty; protect recovery and the key endurance sessions.'
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Endurance One home">
          <span className="brand-mark"><Activity size={18} strokeWidth={2.5} /></span>
          <span className="brand-name">ENDURANCE <b>ONE</b></span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a className="nav-link nav-link-active" href="#training">Training</a>
          <a className="nav-link" href="#guidance">Guidance</a>
        </nav>
        <div className="top-actions">
          <div className="race-chip"><span className="race-dot" /> JUN 13, 2027 <span className="race-chip-divider" /> {daysToRace} DAYS</div>
          <button className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <section className="intro" id="top">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR ROAD TO RACE DAY</div>
          <h1>One week at a time.</h1>
          <p className="intro-copy">A steady plan, built around real life. Your next step starts here.</p>
        </div>
        <div className="race-date-card">
          <span className="race-date-icon"><Activity size={19} /></span>
          <span><small>RACE DAY</small><strong>Sunday, June 13, 2027</strong></span>
          <span className="race-date-arrow"><ArrowRight size={17} /></span>
        </div>
      </section>

      <section className="training-layout" id="training">
        <div className="calendar-column">
          <div className="week-heading">
            <div>
              <div className="section-kicker">WEEK {String(thisWeek).padStart(2, '0')} <span>·</span> {phase.toUpperCase()}</div>
              <h2>{formatRange(firstVisibleDate, lastVisibleDate)}</h2>
            </div>
            <div className="week-controls" aria-label="Calendar week controls">
              <button className="icon-button" aria-label="Previous week" onClick={() => moveWeek(-1)} disabled={weekStart <= mondayOf(PLAN_START)}><ChevronLeft size={18} /></button>
              <button className="today-button" onClick={() => { setWeekStart(PLAN_START); selectDay(addDays(PLAN_START, 1)) }}>Plan start</button>
              <button className="icon-button" aria-label="Next week" onClick={() => moveWeek(1)} disabled={addDays(weekStart, 6) >= RACE_DAY}><ChevronRight size={18} /></button>
            </div>
          </div>

          <div className="week-meta"><span><CalendarDaysIcon /> 7-day training view</span><span><Clock3 size={14} /> {weekHours} planned hours</span></div>

          <div className="week-grid">
            {weekDays.map((day, index) => {
              const dayCompleted = day.workouts.filter((workout) => completions[workout.id]).length
              const isSelected = selectedDate === day.date
              const inRange = day.workouts.length > 0
              return (
                <div key={day.date} className={`day-column ${isSelected ? 'day-column-selected' : ''} ${!inRange ? 'day-column-outside' : ''}`}>
                  <button className="day-heading-button" onClick={() => selectDay(day.date)} disabled={!inRange} aria-pressed={isSelected}>
                    <span className="day-name">{weekdays[index]}</span>
                    <span className="day-number">{dateFromISO(day.date).getDate()}</span>
                    <span className="day-hours">{durationForDay(day.workouts)}</span>
                  </button>
                  <div className="day-workouts">
                    {day.workouts.length ? day.workouts.map((workout) => {
                      const Icon = workoutIcons[workout.type]
                      const completed = Boolean(completions[workout.id])
                      return (
                        <span key={workout.id} className={`workout-tile workout-${workout.type} ${completed ? 'workout-done' : ''}`}>
                          <button className="workout-select" onClick={() => selectWorkout(workout)} aria-label={`View ${workout.title}`}>
                            <span className="workout-tile-top"><Icon size={13} /><span className="workout-check" aria-hidden="true">{completed && <Check size={11} strokeWidth={3} />}</span></span>
                            <span className="workout-tile-name">{workout.title}</span>
                            <span className="workout-tile-duration">{workout.duration}</span>
                          </button>
                          <button type="button" className={`workout-toggle ${completed ? 'is-complete' : ''}`} aria-label={`${completed ? 'Unmark' : 'Mark'} ${workout.title} ${completed ? 'not completed' : 'completed'}`} aria-pressed={completed} onClick={() => toggleWorkout(workout.id)}>{completed && <Check size={10} strokeWidth={3} />}</button>
                        </span>
                      )
                    }) : <span className="outside-label">—</span>}
                  </div>
                  <span className="day-completion">{day.workouts.length ? `${dayCompleted}/${day.workouts.length}` : ''}</span>
                </div>
              )
            })}
          </div>

          <section className="weekly-progress-panel" aria-label="Weekly completion progress">
            <div className="progress-title-row"><div><span className="section-kicker">WEEKLY CHECK-IN</span><h3>{weekCompleted} of {weekWorkouts.length} sessions logged</h3></div><strong>{weekPercent}%</strong></div>
            <div className="progress-track"><span style={{ width: `${weekPercent}%` }} /></div>
            <div className="progress-foot"><span>Every session is a vote for consistency.</span><span>{weekWorkouts.length - weekCompleted} remaining</span></div>
          </section>

          <section className="selected-workout-panel" aria-live="polite">
            {selectedWorkout ? <WorkoutDetail workout={selectedWorkout} completed={Boolean(completions[selectedWorkout.id])} onToggle={() => toggleWorkout(selectedWorkout.id)} /> : <p className="empty-selection">Choose a training day to see its sessions.</p>}
          </section>
        </div>

        <aside className="sidebar">
          <StravaPanel configured={isStravaConfigured} status={stravaStatus} athleteName={stravaAthleteName} lastSync={stravaLastSync} message={stravaMessage} onConnect={connectStrava} onSync={syncStravaNow} onDisconnect={disconnectStravaAccount} />
          <section className="block-card">
            <div className="block-card-heading"><span className="section-kicker">YOUR TRAINING BLOCK</span><span className="phase-chip">{phase}</span></div>
            <div className="block-progress-wrap">
              <div className="progress-ring" style={{ '--progress': `${overallPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{overallPercent}%</strong><span>complete</span></div></div>
              <div className="block-copy"><strong>{totalCompleted} sessions</strong><span>logged so far</span><small>Across {allWorkouts.length} planned sessions</small></div>
            </div>
            <div className="block-range"><span>{formatDate(PLAN_START, { month: 'short', day: 'numeric' })}</span><span className="range-line"><i style={{ width: `${Math.max(overallPercent, 1)}%` }} /></span><span>{formatDate(RACE_DAY, { month: 'short', day: 'numeric' })}</span></div>
            <div className="block-footer"><span>Week {thisWeek} of {TOTAL_PLAN_WEEKS}</span><span>{TOTAL_PLAN_WEEKS - thisWeek} weeks to race</span></div>
          </section>

          <section className="advice-card" id="guidance">
            <div className="advice-heading"><span className="advice-icon"><CircleHelp size={18} /></span><div><span className="section-kicker">MISSED A WORKOUT?</span><h3>Keep the big picture.</h3></div></div>
            <p className="golden-rule">Better to skip than cram too much. <span>Do not try to make up for every missed workout.</span></p>
            <label className="advice-select-label" htmlFor="missed-session">I missed a…</label>
            <div className="select-wrap"><select id="missed-session" value={adviceType} onChange={(event) => { setAdviceType(event.target.value as AdviceKey); setAdviceShown(true) }}><option value="bike">Bike session</option><option value="run">Run session</option><option value="swim">Swim session</option><option value="strength">Strength or recovery</option></select><ChevronDown size={15} /></div>
            <button className="advice-button" onClick={() => setAdviceShown(true)}>{adviceShown ? 'Refresh guidance' : 'Get a sensible next step'} <ArrowRight size={15} /></button>
            {adviceShown && <p className="advice-result" aria-live="polite">{adviceText()}</p>}
            <div className="priority-list"><strong>When time is tight</strong><span><b>1</b> Preserve long rides and long runs</span><span><b>2</b> Keep at least two swims each week</span><span><b>3</b> Drop strength and extra easy work first</span></div>
          </section>

          <section className="color-key" aria-label="Workout type colors"><span className="section-kicker">SESSION KEY</span><div><span className="key-item key-swim"><i /> Swim</span><span className="key-item key-bike"><i /> Bike</span><span className="key-item key-run"><i /> Run</span><span className="key-item key-strength"><i /> Strength</span><span className="key-item key-rest"><i /> Rest</span></div></section>
        </aside>
      </section>

      <footer className="page-footer"><span>ENDURANCE ONE <i>·</i> BUILT FOR THE LONG GAME</span><span>Training plan begins September 28, 2026</span></footer>
    </main>
  )
}

function CalendarDaysIcon() {
  return <Activity size={14} />
}

function mergeCompletions(current: CompletionMap, workoutIds: string[]): CompletionMap {
  const next = { ...current }
  let changed = false
  for (const id of workoutIds) {
    if (!next[id]) {
      next[id] = true
      changed = true
    }
  }
  return changed ? next : current
}

function stravaErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'invalid_password') return 'That app access password was not accepted.'
  if (code === 'worker_not_configured') return 'The secure Strava service needs its credentials configured.'
  if (code === 'strava_rate_limit') return 'Strava is receiving too many requests. Try again in a little while.'
  if (code === 'strava_not_connected') return 'Connect your Strava account to sync activities.'
  if (code === 'strava_api_error') return 'Strava could not return activities. Check its connection and try again.'
  return 'Strava sync could not finish. Check the service setup and try again.'
}

function stravaCallbackMessage(result: string | null) {
  if (result === 'connected') return 'Strava is linked. Checking your training plan now.'
  if (result === 'denied') return 'Strava access was not granted.'
  if (result === 'scope-missing') return 'Allow activity read access in Strava to enable automatic completion.'
  if (result) return 'Strava could not complete the connection. Please try again.'
  return ''
}

function WorkoutDetail({ workout, completed, onToggle }: { workout: Workout; completed: boolean; onToggle: () => void }) {
  const Icon = workoutIcons[workout.type]
  return (
    <div className="workout-detail">
      <div className="detail-topline"><span className={`detail-type type-${workout.type}`}><Icon size={14} /> {workoutLabels[workout.type]}</span><button className={`completion-button ${completed ? 'is-complete' : ''}`} onClick={onToggle}>{completed ? <Check size={15} /> : <span className="completion-empty" />} {completed ? 'Completed' : 'Mark complete'}</button></div>
      <div className="detail-title-row"><div><span className="section-kicker">{formatDate(workout.date, { weekday: 'long', month: 'long', day: 'numeric' })}</span><h3>{workout.title}</h3></div></div>
      <p className="detail-description">{workout.description}</p>
      <div className="detail-metrics"><div><Clock3 size={15} /><span><small>Duration</small><strong>{workout.duration}</strong></span></div><div><Activity size={15} /><span><small>Distance</small><strong>{workout.distance}</strong></span></div></div>
      <div className="intensity-note"><span className="intensity-marker" /><div><small>EFFORT GUIDE</small><p>{workout.intensity}</p></div></div>
      <div className="alternatives"><div className="alternatives-title"><ArrowLeft size={14} /><span>Plan B is still a plan</span></div>{workout.alternatives.map((alternative) => <p key={alternative}>{alternative}</p>)}</div>
    </div>
  )
}

export default App
