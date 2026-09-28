import { dateFromISO, PLAN_START } from './trainingPlan'
import { getCompletedWorkoutIds, type StravaActivity } from './stravaMatching'
import { getPlanWorkouts } from './trainingPlan'

const apiBase = (import.meta.env.VITE_STRAVA_API_URL as string | undefined)?.replace(/\/+$/, '') ?? ''

export const isStravaConfigured = Boolean(apiBase)
export const stravaSessionStorageKey = 'endurance-one-strava-session-v1'

export type StravaStatus = {
  connected: boolean
  athleteName?: string
  athleteId?: number
}

export type StravaSyncResult = {
  connected: boolean
  athleteName: string
  activityCount: number
  completedWorkoutIds: string[]
}

type ApiPayload = Record<string, unknown>

async function request<T extends ApiPayload>(path: string, token?: string, body?: Record<string, string>): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `request_failed_${response.status}`)
  return payload
}

export async function createStravaSession(password: string) {
  const payload = await request<{ token: string }>('/api/session', undefined, { password })
  return payload.token
}

export async function getStravaConnectionUrl(token: string) {
  const payload = await request<{ url: string }>('/api/strava/connect', token, {})
  return payload.url
}

export async function getStravaStatus(token: string) {
  return request<StravaStatus>('/api/status', token)
}

export async function syncStrava(token: string): Promise<StravaSyncResult> {
  const status = await getStravaStatus(token)
  if (!status.connected) {
    return { connected: false, athleteName: '', activityCount: 0, completedWorkoutIds: [] }
  }

  const firstPlanDay = dateFromISO(PLAN_START)
  firstPlanDay.setDate(firstPlanDay.getDate() - 1)
  const after = Math.floor(firstPlanDay.getTime() / 1000)
  const beforeDate = new Date()
  beforeDate.setDate(beforeDate.getDate() + 1)
  const before = Math.floor(beforeDate.getTime() / 1000)
  const params = new URLSearchParams({ after: String(after), before: String(before) })
  const payload = await request<{ activities: StravaActivity[] }>(`/api/strava/activities?${params}`, token)

  return {
    connected: true,
    athleteName: status.athleteName ?? '',
    activityCount: payload.activities.length,
    completedWorkoutIds: getCompletedWorkoutIds(getPlanWorkouts().flatMap((day) => day.workouts), payload.activities),
  }
}

export async function disconnectStrava(token: string) {
  return request<{ connected: boolean }>('/api/strava/disconnect', token, {})
}
