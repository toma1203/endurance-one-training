interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  athleteId: number
  athleteName: string
}

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike
}

interface DurableObjectIdLike {}

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike
  get(id: DurableObjectIdLike): DurableObjectStubLike
}

interface Env {
  APP_PASSWORD: string
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  FRONTEND_URL: string
  STRAVA_STATE: DurableObjectNamespaceLike
}

interface ActivitySummary {
  id: number
  name: string
  type: string
  sport_type: string
  start_date_local: string
  moving_time: number
  distance: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: { id: number; firstname?: string; lastname?: string }
}

const encoder = new TextEncoder()
const storageKey = 'strava-tokens'

function encodeBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

async function verify(value: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  try {
    return await crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), encoder.encode(value))
  } catch {
    return false
  }
}

function encodePayload(payload: Record<string, string | number>) {
  return encodeBase64Url(encoder.encode(JSON.stringify(payload)))
}

async function makeSignedPayload(payload: Record<string, string | number>, secret: string) {
  const encoded = encodePayload(payload)
  return `${encoded}.${await sign(encoded, secret)}`
}

async function readSignedPayload(value: string, secret: string) {
  const [encoded, signature, extra] = value.split('.')
  if (!encoded || !signature || extra || !(await verify(encoded, signature, secret))) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as Record<string, unknown>
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function corsHeaders(env: Env) {
  return {
    'Access-Control-Allow-Origin': new URL(env.FRONTEND_URL).origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

function json(data: unknown, status: number, env: Env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function redirectToApp(env: Env, result: string) {
  const destination = new URL(env.FRONTEND_URL)
  destination.searchParams.set('strava', result)
  return Response.redirect(destination.toString(), 303)
}

function getState(env: Env) {
  const namespace = env.STRAVA_STATE
  return namespace.get(namespace.idFromName('single-athlete'))
}

async function readTokens(env: Env) {
  const response = await getState(env).fetch('https://state/token')
  if (!response.ok) throw new Error('Token storage unavailable')
  const data = await response.json() as { tokens: StoredTokens | null }
  return data.tokens
}

async function saveTokens(env: Env, tokens: StoredTokens) {
  const response = await getState(env).fetch('https://state/token', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens),
  })
  if (!response.ok) throw new Error('Token storage unavailable')
}

async function clearTokens(env: Env) {
  await getState(env).fetch('https://state/token', { method: 'DELETE' })
}

async function exchangeToken(env: Env, values: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      ...values,
    }),
  })
  const payload = await response.json() as TokenResponse | { message?: string }
  if (!response.ok || !('access_token' in payload)) {
    throw new Error('Strava token exchange failed')
  }
  return payload
}

async function validAccessToken(env: Env, stored: StoredTokens) {
  if (stored.expiresAt > Math.floor(Date.now() / 1000) + 3600) return stored.accessToken

  const refreshed = await exchangeToken(env, {
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  })
  const updated: StoredTokens = {
    ...stored,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: refreshed.expires_at,
  }
  await saveTokens(env, updated)
  return updated.accessToken
}

async function isAuthorized(request: Request, env: Env) {
  if (!env.APP_PASSWORD) return false
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const payload = await readSignedPayload(token, env.APP_PASSWORD)
  return payload?.sub === 'endurance-one'
}

async function handleCallback(request: Request, env: Env) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state') ?? ''
  if (!env.STRAVA_CLIENT_SECRET || !(await readSignedPayload(state, env.STRAVA_CLIENT_SECRET))) {
    return redirectToApp(env, 'error')
  }
  if (url.searchParams.get('error') === 'access_denied') return redirectToApp(env, 'denied')

  const code = url.searchParams.get('code')
  if (!code) return redirectToApp(env, 'error')

  try {
    const token = await exchangeToken(env, { grant_type: 'authorization_code', code })
    if (!token.athlete?.id) return redirectToApp(env, 'error')
    const grantedScopes = url.searchParams.get('scope')?.split(',') ?? []
    if (!grantedScopes.includes('activity:read_all')) return redirectToApp(env, 'scope-missing')

    const athleteName = [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(' ')
    await saveTokens(env, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      athleteId: token.athlete.id,
      athleteName,
    })
    return redirectToApp(env, 'connected')
  } catch {
    return redirectToApp(env, 'error')
  }
}

async function fetchActivities(request: Request, env: Env, stored: StoredTokens) {
  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after'))
  const before = Number(url.searchParams.get('before'))
  const maxRangeSeconds = 370 * 24 * 60 * 60
  if (!Number.isInteger(after) || !Number.isInteger(before) || after <= 0 || before <= after || before - after > maxRangeSeconds) {
    return json({ error: 'invalid_date_range' }, 400, env)
  }

  const accessToken = await validAccessToken(env, stored)
  const activities: ActivitySummary[] = []
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({ after: String(after), before: String(before), per_page: '100', page: String(page) })
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return json({ error: response.status === 429 ? 'strava_rate_limit' : 'strava_api_error' }, response.status === 429 ? 429 : 502, env)
    const pageActivities = await response.json() as ActivitySummary[]
    activities.push(...pageActivities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      type: activity.type,
      sport_type: activity.sport_type,
      start_date_local: activity.start_date_local,
      moving_time: activity.moving_time,
      distance: activity.distance,
    })))
    if (pageActivities.length < 100) break
  }
  return json({ activities }, 200, env)
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(env.FRONTEND_URL).origin) return json({ error: 'origin_not_allowed' }, 403, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) })

  if (url.pathname === '/api/session' && request.method === 'POST') {
    if (!env.APP_PASSWORD) return json({ error: 'worker_not_configured' }, 503, env)
    const body = await request.json() as { password?: string }
    if (body.password !== env.APP_PASSWORD) return json({ error: 'invalid_password' }, 401, env)
    const token = await makeSignedPayload({ sub: 'endurance-one', exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60 }, env.APP_PASSWORD)
    return json({ token }, 200, env)
  }

  if (!(await isAuthorized(request, env))) return json({ error: env.APP_PASSWORD ? 'unauthorized' : 'worker_not_configured' }, env.APP_PASSWORD ? 401 : 503, env)

  if (url.pathname === '/api/status' && request.method === 'GET') {
    const tokens = await readTokens(env)
    return json(tokens ? { connected: true, athleteName: tokens.athleteName, athleteId: tokens.athleteId } : { connected: false }, 200, env)
  }

  if (url.pathname === '/api/strava/connect' && request.method === 'POST') {
    if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return json({ error: 'worker_not_configured' }, 503, env)
    const state = await makeSignedPayload({ nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 10 * 60 }, env.STRAVA_CLIENT_SECRET)
    const redirectUri = new URL('/oauth/callback', url.origin).toString()
    const authorize = new URL('https://www.strava.com/oauth/authorize')
    authorize.search = new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      approval_prompt: 'auto',
      scope: 'activity:read_all',
      state,
    }).toString()
    return json({ url: authorize.toString() }, 200, env)
  }

  if (url.pathname === '/api/strava/activities' && request.method === 'GET') {
    const tokens = await readTokens(env)
    if (!tokens) return json({ error: 'strava_not_connected' }, 409, env)
    return fetchActivities(request, env, tokens)
  }

  if (url.pathname === '/api/strava/disconnect' && request.method === 'POST') {
    const tokens = await readTokens(env)
    if (tokens) {
      const credentials = btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)
      const response = await fetch('https://www.strava.com/oauth/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token' }),
      })
      if (!response.ok) return json({ error: 'strava_revoke_failed' }, 502, env)
      await clearTokens(env)
    }
    return json({ connected: false }, 200, env)
  }

  return json({ error: 'not_found' }, 404, env)
}

export class StravaState {
  constructor(private readonly ctx: DurableObjectStateLike) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname !== '/token') return new Response('Not found', { status: 404 })
    if (request.method === 'GET') {
      return Response.json({ tokens: await this.ctx.storage.get<StoredTokens>(storageKey) ?? null })
    }
    if (request.method === 'PUT') {
      await this.ctx.storage.put(storageKey, await request.json() as StoredTokens)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'DELETE') {
      await this.ctx.storage.delete(storageKey)
      return new Response(null, { status: 204 })
    }
    return new Response('Method not allowed', { status: 405 })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/oauth/callback' && request.method === 'GET') return handleCallback(request, env)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env)
      } catch {
        return json({ error: 'internal_error' }, 500, env)
      }
    }
    return new Response('Endurance One Strava service', { status: 200 })
  },
}