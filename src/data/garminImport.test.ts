import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder'
import { parseGarminFiles } from './garminImport'

const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-09-29T06:30:00Z</Id><Lap StartTime="2026-09-29T06:30:00Z"><TotalTimeSeconds>2100</TotalTimeSeconds><DistanceMeters>6000</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>`
const gpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Wednesday cycling</name><type>cycling</type><trkseg><trkpt lat="45.0000" lon="15.0000"><time>2026-09-30T06:00:00Z</time></trkpt><trkpt lat="45.0010" lon="15.0010"><time>2026-09-30T07:00:00Z</time></trkpt></trkseg></trk></gpx>`

function localDateTime(utc: string) {
  const date = new Date(utc)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function createFitRun() {
  const start = FitEncoder.toFitTimestamp(new Date('2026-09-29T06:30:00Z'))
  return new FitEncoder().writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: start },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: start },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 2_100_000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 600_000 },
  ]).close()
}

describe('parseGarminFiles', () => {
  it('reads FIT session summaries in the browser', async () => {
    const fitBytes = createFitRun()
    const fitBuffer = fitBytes.buffer.slice(fitBytes.byteOffset, fitBytes.byteOffset + fitBytes.byteLength) as ArrayBuffer
    const file = new File([fitBuffer], 'run.fit')
    const result = await parseGarminFiles([file])

    expect(result.skippedFiles).toEqual([])
    expect(result.activities).toHaveLength(1)
    expect(result.activities[0]).toMatchObject({
      sport_type: 'Run',
      start_date_local: localDateTime('2026-09-29T06:30:00Z'),
      moving_time: 2100,
      distance: 6000,
    })
  })

  it('reads TCX runs and GPX rides from multiple selected files', async () => {
    const files = [new File([tcx], 'run.tcx'), new File([gpx], 'ride.gpx')]
    const result = await parseGarminFiles(files)

    expect(result.skippedFiles).toEqual([])
    expect(result.activities).toHaveLength(2)
    expect(result.activities.map(({ sport_type, start_date_local }) => [sport_type, start_date_local])).toEqual([
      ['Run', localDateTime('2026-09-29T06:30:00Z')],
      ['Ride', localDateTime('2026-09-30T06:00:00Z')],
    ])
    expect(result.activities[0].moving_time).toBe(2100)
    expect(result.activities[1].distance).toBeGreaterThan(100)
  })

  it('reads Garmin activity-list CSV with comma or semicolon delimiter', async () => {
    const csv = [
      'Activity Type,Date,Favorite,Title,Distance,Calories,Time',
      'Running,2026-09-29 06:30:00,false,"Tempo, morning run",6.25,400,0:35:00',
      'Cycling,2026-09-30 07:00:00,false,Wednesday ride,42.5,700,1:30:00',
    ].join('\r\n')
    const result = await parseGarminFiles([new File([csv], 'Activities.csv')])

    expect(result.skippedFiles).toEqual([])
    expect(result.activities).toHaveLength(2)
    expect(result.activities[0]).toMatchObject({
      name: 'Tempo, morning run',
      sport_type: 'Run',
      start_date_local: '2026-09-29T06:30:00',
      moving_time: 2100,
      distance: 6250,
    })
    expect(result.activities[1]).toMatchObject({ sport_type: 'Ride', moving_time: 5400, distance: 42500 })

    const semicolonCsv = 'Activity Type;Date;Title;Distance (mi);Elapsed Time\nRunning;2026-09-29 07:00:00;Park run;3.1;0:30:00'
    const semicolonResult = await parseGarminFiles([new File([semicolonCsv], 'activities.csv')])
    expect(semicolonResult.activities[0]).toMatchObject({ distance: 4989, moving_time: 1800 })
  })

  it('extracts supported activity files from a bulk Garmin ZIP', async () => {
    const archive = zipSync({
      'activities/run.tcx': new TextEncoder().encode(tcx),
      'activities/ride.gpx': new TextEncoder().encode(gpx),
      'profile.json': new TextEncoder().encode('{"ignored":true}'),
    })
    const result = await parseGarminFiles([new File([archive], 'garmin-export.zip')])

    expect(result.skippedFiles).toEqual([])
    expect(result.activities).toHaveLength(2)
  })

  it('creates stable IDs so repeated uploads can be ignored', async () => {
    const file = new File([tcx], 'run.tcx')
    const first = await parseGarminFiles([file])
    const second = await parseGarminFiles([file])

    expect(second.activities[0].id).toBe(first.activities[0].id)
  })
})