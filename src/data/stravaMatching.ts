import type { Workout, WorkoutType } from './trainingPlan'

export type StravaActivity = {
  id: number | string
  name: string
  type: string
  sport_type: string
  start_date_local: string
  moving_time: number
  distance: number
}

const activityTypes: Record<Exclude<WorkoutType, 'rest' | 'race'>, string[]> = {
  swim: ['swim', 'swimming', 'lap_swimming', 'open_water'],
  bike: ['ride', 'cycling', 'bicycle', 'virtualride', 'ebikeride', 'mountainbikeride', 'gravelride', 'emountainbikeride', 'velomobile', 'handcycle', 'indoor_cycling'],
  run: ['run', 'running', 'trailrun', 'trail_running', 'virtualrun', 'treadmill'],
  strength: ['weighttraining', 'strength_training', 'crossfit', 'workout', 'fitness_equipment', 'highintensityintervaltraining'],
}

function workoutForActivity(activity: StravaActivity): Exclude<WorkoutType, 'rest' | 'race'> | null {
  const activityNames = [activity.sport_type, activity.type].map((type) => type.toLowerCase().replace(/[^a-z]/g, ''))
  for (const [workoutType, acceptedTypes] of Object.entries(activityTypes) as [Exclude<WorkoutType, 'rest' | 'race'>, string[]][]) {
    const normalizedAcceptedTypes = acceptedTypes.map((type) => type.toLowerCase().replace(/[^a-z]/g, ''))
    if (activityNames.some((name) => normalizedAcceptedTypes.includes(name))) return workoutType
  }
  return null
}

export function getCompletedWorkoutIds(workouts: Workout[], activities: StravaActivity[]) {
  const byDate = new Map<string, Map<string, Workout[]>>()
  for (const workout of workouts) {
    if (workout.type === 'rest' || workout.type === 'race') continue
    const dayWorkouts = byDate.get(workout.date) ?? new Map<string, Workout[]>()
    const sameType = dayWorkouts.get(workout.type) ?? []
    sameType.push(workout)
    dayWorkouts.set(workout.type, sameType)
    byDate.set(workout.date, dayWorkouts)
  }

  const completed: string[] = []
  const orderedActivities = [...activities].sort((first, second) => first.start_date_local.localeCompare(second.start_date_local))
  for (const activity of orderedActivities) {
    const date = activity.start_date_local.slice(0, 10)
    const type = workoutForActivity(activity)
    if (!type) continue
    const candidates = byDate.get(date)?.get(type)
    const workout = candidates?.shift()
    if (workout) completed.push(workout.id)
  }
  return completed
}
