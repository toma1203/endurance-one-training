import { unzipSync } from 'fflate'
import { toISODate } from './trainingPlan'
import type { StravaActivity } from './stravaMatching'

export type GarminActivity = StravaActivity & {
  id: string
  sourceFile: string
}

export type GarminImportResult = {
  activities: GarminActivity[]
  skippedFiles: string[]
}

type XmlActivity = {
  id: string
  type: string
  sport_type: string
  start_date_local: string
  moving_time: number
  distance: number
  name: string
}

const supportedExtensions = ['.fit', '.tcx', '.gpx', '.csv']
const maximumSelectedFiles = 100
const maximumSelectedBytes = 100 * 1024 * 1024
const maximumSourceFileBytes = 50 * 1024 * 1024
const maximumArchiveBytes = 100 * 1024 * 1024
const maximumArchiveExpandedBytes = 150 * 1024 * 1024
const maximumArchiveActivityFiles = 300

function extensionOf(name: string) {
  const lower = name.toLowerCase()
  return supportedExtensions.find((extension) => lower.endsWith(extension)) ?? ''
}

function isSupportedFile(name: string) {
  return Boolean(extensionOf(name))
}

function toLocalDateTime(value: string, offsetSeconds?: number) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return ''
  if (typeof offsetSeconds === 'number' && Number.isFinite(offsetSeconds)) {
    timestamp.setTime(timestamp.getTime() + offsetSeconds * 1000)
    const localDate = new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate()))
    return `${toISODate(localDate)}T${pad(timestamp.getUTCHours())}:${pad(timestamp.getUTCMinutes())}:${pad(timestamp.getUTCSeconds())}`
  }
  return `${toISODate(timestamp)}T${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function guessSport(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (/swim|pool|openwater/.test(normalized)) return 'Swim'
  if (/cycling|bicycle|mountainbikeride|gravelride|virtualride|ebikeride|ride|bike|spin/.test(normalized)) return 'Ride'
  if (/running|trailrun|virtualrun|treadmill|jog|run/.test(normalized)) return 'Run'
  if (/weight|strength|crossfit|fitness|workout|training/.test(normalized)) return 'WeightTraining'
  return String(value ?? 'Workout')
}

function hashBytes(bytes: Uint8Array) {
  let hash = 2166136261
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableId(fileHash: string, index: number, activity: Omit<GarminActivity, 'id' | 'sourceFile'>) {
  return `${fileHash}|${index}|${activity.sport_type}|${activity.start_date_local}|${Math.round(activity.moving_time)}|${Math.round(activity.distance)}`
}

function xmlElements(root: Document | Element, name: string) {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName.toLowerCase() === name.toLowerCase())
}

function childText(element: Element, name: string) {
  return Array.from(element.getElementsByTagName('*'))
    .find((child) => child.localName.toLowerCase() === name.toLowerCase())?.textContent?.trim() ?? ''
}

function parseCsvRows(content: string) {
  const firstLine = content.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < content.length; index++) {
    const character = content[index]
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim())
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index++
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/\uFEFF/g, '').replace(/[^a-z0-9]/g, '')
}

function numberFromCsv(value: string) {
  const trimmed = value.trim().replace(/[\s\u00a0]/g, '')
  if (!trimmed) return 0
  const normalized = trimmed.includes(',') && !trimmed.includes('.')
    ? trimmed.replace(',', '.')
    : trimmed.replace(/,/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function durationFromCsv(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return numberFromCsv(trimmed)
  const parts = trimmed.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return 0
  const seconds = Number(parts.pop())
  const minutes = Number(parts.pop())
  const hours = parts.length ? Number(parts[0]) : 0
  return hours * 3600 + minutes * 60 + seconds
}

function parseCsv(content: string): XmlActivity[] {
  const rows = parseCsvRows(content)
  if (rows.length < 2) return []
  const headers = rows[0].map(normalizedHeader)
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const typeColumn = column('activitytype', 'sporttype', 'sport', 'type')
  const titleColumn = column('title', 'activityname', 'name')
  const dateColumn = column('date', 'starttime', 'startdate', 'activitydate', 'startdatelocal')
  const distanceColumn = column('distance', 'distancem', 'distancemeters', 'distancekm', 'distancemi', 'distancemiles')
  const durationColumn = column('time', 'elapsedtime', 'movingtime', 'duration', 'totaltime')
  if (dateColumn < 0 || (typeColumn < 0 && titleColumn < 0)) return []

  const get = (cells: string[], index: number) => index < 0 ? '' : cells[index] ?? ''
  return rows.slice(1).flatMap((cells) => {
    const date = toLocalDateTime(get(cells, dateColumn))
    if (!date) return []
    const name = get(cells, titleColumn) || get(cells, typeColumn) || 'Workout'
    const sport = guessSport(get(cells, typeColumn) || name)
    const rawDistance = numberFromCsv(get(cells, distanceColumn))
    const distanceHeader = distanceColumn >= 0 ? headers[distanceColumn] : ''
    const distance = distanceHeader.endsWith('m') || distanceHeader.includes('meter') ? rawDistance
      : distanceHeader.includes('mile') || distanceHeader.endsWith('mi') ? rawDistance * 1609.344
        : rawDistance * 1000
    return [{
      id: '',
      name,
      type: sport,
      sport_type: sport,
      start_date_local: date,
      moving_time: durationFromCsv(get(cells, durationColumn)),
      distance: Math.round(distance),
    }]
  })
}

function parseTcx(content: string): XmlActivity[] {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  if (xmlElements(document, 'parsererror').length) throw new Error('The TCX file is not valid XML.')
  const activities = xmlElements(document, 'Activity')
  return activities.flatMap((element) => {
    const laps = xmlElements(element, 'Lap').filter((lap) => lap.parentElement === element || lap.parentElement?.localName.toLowerCase() === 'activities')
    const idValue = childText(element, 'Id') || childText(laps[0] ?? element, 'StartTime')
    const start = toLocalDateTime(idValue)
    if (!start) return []
    const seconds = laps.reduce((sum, lap) => sum + Number(childText(lap, 'TotalTimeSeconds') || 0), 0)
    const distance = laps.reduce((sum, lap) => sum + Number(childText(lap, 'DistanceMeters') || 0), 0)
    const sport = guessSport(element.getAttribute('Sport') || 'Workout')
    return [{
      id: '',
      name: `${sport} activity`,
      type: sport,
      sport_type: sport,
      start_date_local: start,
      moving_time: Number.isFinite(seconds) ? seconds : 0,
      distance: Number.isFinite(distance) ? distance : 0,
    }]
  })
}

function distanceBetween(firstLat: number, firstLon: number, secondLat: number, secondLon: number) {
  const earthRadiusMeters = 6371000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = toRadians(secondLat - firstLat)
  const longitudeDelta = toRadians(secondLon - firstLon)
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(firstLat)) * Math.cos(toRadians(secondLat)) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function parseGpx(content: string, sourceName: string): XmlActivity[] {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  if (xmlElements(document, 'parsererror').length) throw new Error('The GPX file is not valid XML.')
  const tracks = xmlElements(document, 'trk')
  return tracks.flatMap((track) => {
    const points = xmlElements(track, 'trkpt')
    const samples = points.flatMap((point) => {
      const latitude = Number(point.getAttribute('lat'))
      const longitude = Number(point.getAttribute('lon'))
      const time = childText(point, 'time')
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !time) return []
      return [{ latitude, longitude, time }]
    })
    if (samples.length < 2) return []
    const start = toLocalDateTime(samples[0].time)
    const end = new Date(samples[samples.length - 1].time).getTime()
    const startMilliseconds = new Date(samples[0].time).getTime()
    if (!start || !Number.isFinite(end) || end <= startMilliseconds) return []
    let distance = 0
    for (let index = 1; index < samples.length; index++) {
      distance += distanceBetween(samples[index - 1].latitude, samples[index - 1].longitude, samples[index].latitude, samples[index].longitude)
    }
    const name = childText(track, 'name') || sourceName
    const sport = guessSport(childText(track, 'type') || name)
    return [{
      id: '',
      name,
      type: sport,
      sport_type: sport,
      start_date_local: start,
      moving_time: Math.round((end - startMilliseconds) / 1000),
      distance: Math.round(distance),
    }]
  })
}

async function parseFit(data: ArrayBuffer): Promise<XmlActivity[]> {
  const { default: FitParser } = await import('fit-file-parser')
  const parsed = await new FitParser({ mode: 'list', lengthUnit: 'm' }).parseAsync(data)
  const sessions = parsed.sessions ?? []
  return sessions.flatMap((session, index) => {
    const timestamp = String(session.start_time ?? session.timestamp ?? '')
    const offsetSeconds = (session as unknown as Record<string, unknown>).utc_offset
    const start = toLocalDateTime(timestamp, typeof offsetSeconds === 'number' ? offsetSeconds : undefined)
    if (!start) return []
    const sport = guessSport(session.sport ?? parsed.sports?.[index]?.sport ?? 'Workout')
    const duration = Number(session.total_timer_time ?? session.total_elapsed_time ?? 0)
    const distance = Number(session.total_distance ?? 0)
    return [{
      id: '',
      name: `${sport} activity`,
      type: sport,
      sport_type: sport,
      start_date_local: start,
      moving_time: Number.isFinite(duration) ? duration : 0,
      distance: Number.isFinite(distance) ? distance : 0,
    }]
  })
}

async function parseActivityFile(name: string, bytes: Uint8Array): Promise<XmlActivity[]> {
  if (bytes.byteLength > maximumSourceFileBytes) throw new Error('Files must be 50 MB or smaller.')
  const extension = extensionOf(name)
  if (extension === '.fit') {
    const data = bytes.slice().buffer as ArrayBuffer
    return parseFit(data)
  }
  const content = new TextDecoder().decode(bytes)
  if (extension === '.csv') return parseCsv(content)
  if (extension === '.tcx') return parseTcx(content)
  if (extension === '.gpx') return parseGpx(content, name)
  throw new Error('Choose a FIT, TCX, GPX, or CSV activity file.')
}

function attachSource(activities: XmlActivity[], sourceFile: string, fileHash: string) {
  return activities.map((activity, index) => {
    const { id: _ignored, ...summary } = activity
    return { ...summary, id: stableId(fileHash, index, summary), sourceFile } satisfies GarminActivity
  })
}

async function readZip(file: File) {
  if (file.size > maximumArchiveBytes) throw new Error('ZIP files must be 100 MB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let expandedSize = 0
  let activityFileCount = 0
  const archive = unzipSync(bytes, {
    filter: (entry) => {
      if (!isSupportedFile(entry.name)) return false
      expandedSize += entry.originalSize
      activityFileCount++
      if (activityFileCount > maximumArchiveActivityFiles || expandedSize > maximumArchiveExpandedBytes) {
        throw new Error('This archive is too large. Select up to 300 activity files and 150 MB expanded.')
      }
      return true
    },
  })
  const activities: GarminActivity[] = []
  const skippedFiles: string[] = []
  if (Object.keys(archive).length === 0) skippedFiles.push(file.name)
  for (const [entryName, entryBytes] of Object.entries(archive)) {
    try {
      activities.push(...attachSource(await parseActivityFile(entryName, entryBytes), file.name, hashBytes(entryBytes)))
    } catch {
      skippedFiles.push(entryName)
    }
  }
  return { activities, skippedFiles }
}

export async function parseGarminFiles(files: FileList | File[]): Promise<GarminImportResult> {
  const selected = Array.from(files)
  if (!selected.length) return { activities: [], skippedFiles: [] }
  if (selected.length > maximumSelectedFiles) throw new Error(`Choose no more than ${maximumSelectedFiles} files at a time.`)
  if (selected.reduce((total, file) => total + file.size, 0) > maximumSelectedBytes) {
    throw new Error('Selected files must total 100 MB or less. Choose a smaller batch.')
  }

  const activities: GarminActivity[] = []
  const skippedFiles: string[] = []
  for (const file of selected) {
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const result = await readZip(file)
        activities.push(...result.activities)
        skippedFiles.push(...result.skippedFiles)
        continue
      }
      if (!isSupportedFile(file.name)) {
        skippedFiles.push(file.name)
        continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await parseActivityFile(file.name, bytes)
      activities.push(...attachSource(parsed, file.name, hashBytes(bytes)))
    } catch {
      skippedFiles.push(file.name)
    }
  }
  return { activities, skippedFiles }
}
