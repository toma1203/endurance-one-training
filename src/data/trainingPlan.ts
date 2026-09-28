export type WorkoutType = 'swim' | 'bike' | 'run' | 'strength' | 'rest' | 'race'

export type Workout = {
  id: string
  date: string
  type: WorkoutType
  title: string
  duration: string
  durationMinutes: number
  distance: string
  description: string
  intensity: string
  alternatives: string[]
}

export type TrainingDay = {
  date: string
  workouts: Workout[]
}

export const PLAN_START = '2026-09-28'
export const RACE_DAY = '2027-06-13'
export const TOTAL_PLAN_WEEKS = 37

const dayMs = 24 * 60 * 60 * 1000

export function dateFromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(value: string, amount: number) {
  const date = dateFromISO(value)
  date.setDate(date.getDate() + amount)
  return toISODate(date)
}

export function calendarDaysBetween(first: string, second: string) {
  const [firstYear, firstMonth, firstDay] = first.split('-').map(Number)
  const [secondYear, secondMonth, secondDay] = second.split('-').map(Number)
  const firstUtc = Date.UTC(firstYear, firstMonth - 1, firstDay)
  const secondUtc = Date.UTC(secondYear, secondMonth - 1, secondDay)
  return Math.round((secondUtc - firstUtc) / dayMs)
}

export function weekNumber(value: string) {
  return Math.floor(calendarDaysBetween(PLAN_START, value) / 7) + 1
}

export function trainingPhase(number: number) {
  if (number >= 37) return 'Race week'
  if (number >= 33) return 'Taper'
  if (number >= 27) return 'Peak'
  if (number >= 11) return 'Build'
  return 'Base'
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

function createWorkout(
  date: string,
  type: WorkoutType,
  title: string,
  durationMinutes: number,
  distance: string,
  description: string,
  intensity: string,
  alternatives: string[],
): Workout {
  return {
    id: `${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    date,
    type,
    title,
    duration: durationMinutes === 0 ? 'Rest day' : formatDuration(durationMinutes),
    durationMinutes,
    distance,
    description,
    intensity,
    alternatives,
  }
}

const swimAlternatives = [
  'Replace the pool session with 20–30 min of resistance-band work for the shoulders.',
  'Add 15 min of shoulder and core stability, then move the swim to Thursday if there is room.',
]
const bikeAlternatives = [
  'Move the session indoors to a trainer or spin bike; keep the same effort targets.',
  'If equipment is unavailable, use a brisk uphill walk for 45–60 min in a steady aerobic zone.',
]
const runAlternatives = [
  'Use a treadmill and keep the same easy or tempo effort rather than chasing pace.',
  'Choose the elliptical or aqua jogging for a low-impact aerobic substitute.',
]
const strengthAlternatives = [
  'Shorten to 15 min of bodyweight mobility and trunk stability, or skip it during a heavy week.',
]
const recoveryAlternatives = [
  'A relaxed walk and 10 min of mobility are enough. Full rest is also a good choice.',
]

function longSessionMinutes(number: number, type: 'bike' | 'run') {
  let minutes: number
  if (number <= 10) {
    minutes = type === 'bike' ? 150 + Math.min(number - 1, 9) * 15 : 50 + Math.min(number - 1, 9) * 6
  } else if (number <= 26) {
    minutes = type === 'bike' ? 240 + Math.min(number - 11, 10) * 12 : 95 + Math.min(number - 11, 10) * 4
  } else if (number <= 32) {
    minutes = type === 'bike' ? 300 + Math.min(number - 27, 5) * 10 : 140 + Math.min(number - 27, 5) * 5
  } else {
    const taperWeek = number - 32
    minutes = type === 'bike' ? Math.max(60, 240 - taperWeek * 55) : Math.max(35, 105 - taperWeek * 20)
  }

  if (number % 4 === 0 && number < 33) minutes = Math.round(minutes * 0.78)
  return minutes
}

function buildDay(date: string): TrainingDay {
  const number = weekNumber(date)
  const weekday = dateFromISO(date).getDay()
  const phase = trainingPhase(number)
  const deload = number % 4 === 0 && number < 33
  const raceWeek = number === TOTAL_PLAN_WEEKS
  const easyNote = deload ? 'Keep this week deliberately lighter to absorb the work.' : 'Finish feeling like you could do a little more.'
  let workouts: Workout[] = []

  if (date === RACE_DAY) {
    workouts = [createWorkout(
      date, 'race', 'Ironman race day', 0, '3.8 km swim · 180 km bike · 42.2 km run',
      'Your day. Start patiently, fuel early, and stay present through each discipline.',
      'Controlled first half; steady effort all day. Follow your practiced fueling plan.',
      ['No workout substitute for race day. Prioritize sleep, equipment checks, and the plan you rehearsed.'],
    )]
  } else if (weekday === 1) {
    workouts = [createWorkout(date, 'rest', 'Rest & reset', 0, 'Optional gentle mobility', 'A full day away from structured training. Recovery is part of the work.', 'Keep it genuinely easy; no missed sessions need to be added here.', recoveryAlternatives)]
  } else if (weekday === 2) {
    const swimMinutes = raceWeek ? 20 : number >= 27 ? 55 : number >= 11 ? 50 : 45
    const runMinutes = raceWeek ? 20 : number >= 27 ? 45 : number >= 11 ? 40 : 35
    workouts = [
      createWorkout(date, 'swim', raceWeek ? 'Short technique swim' : 'Technique + aerobic swim', swimMinutes, raceWeek ? '0.6 km' : `${(1.8 + Math.min(number, 25) * 0.05).toFixed(1)} km`, raceWeek ? 'A relaxed form check. Get out feeling fresh.' : 'Drills, relaxed form work, then continuous aerobic swimming.', raceWeek ? 'Easy throughout; no hard efforts.' : 'Mostly easy; smooth strokes and controlled breathing.', swimAlternatives),
      createWorkout(date, 'run', raceWeek ? 'Easy leg-opener' : 'Easy run', runMinutes, raceWeek ? '2–3 km' : `${Math.round(runMinutes / 6)} km`, raceWeek ? 'A short easy jog with a few relaxed strides if you feel good.' : 'Comfortable aerobic running with a few relaxed strides if you feel fresh.', raceWeek ? 'Easy and light. Finish feeling eager for race day.' : 'About 80% conversational. You should be able to speak in full sentences.', runAlternatives),
    ]
  } else if (weekday === 3) {
    const bikeMinutes = raceWeek ? 30 : number >= 27 ? 105 : number >= 11 ? 90 : 75
    const strengthMinutes = deload || number >= 33 ? 25 : 40
    workouts = [
      createWorkout(date, 'bike', raceWeek ? 'Easy pre-race spin' : 'Bike intervals', bikeMinutes, raceWeek ? '10–12 km' : `${Math.round(bikeMinutes * 0.42)} km`, raceWeek ? 'A light spin with a few short cadence pickups. Keep the legs fresh.' : 'Warm up, then complete 4–6 controlled efforts with easy spinning between.', raceWeek ? 'Very easy, with no sustained efforts.' : 'Steady tempo on the work intervals; smooth, never all-out.', bikeAlternatives),
      createWorkout(date, 'strength', 'Strength & stability', strengthMinutes, 'Mobility + core', 'Single-leg stability, glutes, trunk strength, and shoulder prehab.', 'Moderate, tidy reps. Leave two good reps in reserve.', strengthAlternatives),
    ]
  } else if (weekday === 4) {
    const swimMinutes = raceWeek ? 15 : number >= 27 ? 65 : number >= 11 ? 60 : 50
    const runMinutes = raceWeek ? 15 : number >= 27 ? 55 : number >= 11 ? 50 : 40
    workouts = [
      createWorkout(date, 'swim', raceWeek ? 'Easy swim tune-up' : 'Steady endurance swim', swimMinutes, raceWeek ? '0.5 km' : `${(2.0 + Math.min(number, 25) * 0.06).toFixed(1)} km`, raceWeek ? 'Easy water time; stop while you still feel fresh.' : 'Longer repeats at an even rhythm. Practice sighting and relaxed exhalation.', raceWeek ? 'Easy and relaxed.' : 'Comfortable aerobic effort with consistent form.', swimAlternatives),
      createWorkout(date, 'run', raceWeek ? 'Short shakeout run' : 'Run with controlled tempo', runMinutes, raceWeek ? '2 km' : `${Math.round(runMinutes / 6)} km`, raceWeek ? 'Short, comfortable shakeout. No tempo work this week.' : 'Easy warm-up, a short controlled tempo block, then an easy cool-down.', raceWeek ? 'Easy throughout; keep it light.' : 'Tempo should feel purposeful but repeatable; no sprinting.', runAlternatives),
    ]
  } else if (weekday === 5) {
    workouts = [createWorkout(date, 'rest', 'Recovery & mobility', raceWeek ? 10 : 20, raceWeek ? 'Optional 10 min' : 'Optional 20 min', raceWeek ? 'Keep the day quiet. A few easy mobility movements are plenty.' : 'Gentle mobility, easy walking, or complete rest. Check in with any soreness.', 'Very easy. Skip this session if you need more recovery.', recoveryAlternatives)]
  } else if (weekday === 6) {
    const minutes = raceWeek ? 20 : longSessionMinutes(number, 'bike')
    workouts = [createWorkout(date, 'bike', raceWeek ? 'Pre-race spin' : 'Long ride', minutes, raceWeek ? '6–8 km' : `${Math.round(minutes * 0.48)} km`, raceWeek ? 'A short, easy spin to check the bike and keep the legs loose.' : `${easyNote} Include practiced fueling and a steady cadence on varied terrain.`, raceWeek ? 'Very easy. Save your energy for tomorrow.' : 'Mostly Zone 2, conversational. Practice race-day fueling every 20–30 min.', bikeAlternatives)]
  } else {
    const minutes = longSessionMinutes(number, 'run')
    workouts = [createWorkout(date, 'run', 'Long run', minutes, `${Math.round(minutes / 6)} km`, `${easyNote} Keep the route comfortable and finish with good form.`, 'Easy aerobic effort; slow down on hills and in heat.', runAlternatives)]
  }

  if (phase === 'Race week' && date !== RACE_DAY && workouts.some((workout) => workout.type === 'strength')) {
    workouts = workouts.filter((workout) => workout.type !== 'strength')
  }

  return { date, workouts }
}

export function getTrainingDay(date: string) {
  return buildDay(date)
}

export function getPlanWorkouts() {
  const days: TrainingDay[] = []
  for (let offset = 0; offset <= calendarDaysBetween(PLAN_START, RACE_DAY); offset++) {
    days.push(buildDay(addDays(PLAN_START, offset)))
  }
  return days
}