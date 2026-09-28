import { describe, expect, it } from 'vitest'
import { getTrainingDay, RACE_DAY } from './trainingPlan'
import { getCompletedWorkoutIds, type StravaActivity } from './stravaMatching'

function activity(date: string, type: string, id: number): StravaActivity {
  return {
    id,
    name: `${type} session`,
    type,
    sport_type: type,
    start_date_local: `${date}T07:30:00`,
    moving_time: 3600,
    distance: 10000,
  }
}

describe('getCompletedWorkoutIds', () => {
  it('matches swim and run activities to workouts on their local activity date', () => {
    const workouts = getTrainingDay('2026-09-29').workouts
    const activities = [activity('2026-09-29', 'Run', 1), activity('2026-09-29', 'Swim', 2)]

    expect(getCompletedWorkoutIds(workouts, activities)).toEqual(expect.arrayContaining(workouts.map((workout) => workout.id)))
  })

  it('matches virtual rides and weight training to bike and strength sessions', () => {
    const workouts = getTrainingDay('2026-09-30').workouts
    const activities = [activity('2026-09-30', 'VirtualRide', 3), activity('2026-09-30', 'WeightTraining', 4)]

    expect(getCompletedWorkoutIds(workouts, activities)).toEqual(expect.arrayContaining(workouts.map((workout) => workout.id)))
  })

  it('does not match an activity from the neighboring local date', () => {
    const workouts = getTrainingDay('2026-09-29').workouts

    expect(getCompletedWorkoutIds(workouts, [activity('2026-09-30', 'Run', 5)])).toEqual([])
  })

  it('matches at most one activity to each planned session', () => {
    const workouts = getTrainingDay('2026-09-29').workouts
    const activities = [activity('2026-09-29', 'Run', 6), activity('2026-09-29', 'TrailRun', 7)]

    expect(getCompletedWorkoutIds(workouts, activities).filter((id) => id === workouts.find((workout) => workout.type === 'run')?.id)).toHaveLength(1)
  })

  it('does not auto-complete rest or race day workouts', () => {
    const workouts = [
      ...getTrainingDay('2026-09-28').workouts,
      ...getTrainingDay(RACE_DAY).workouts,
    ]
    const activities = [activity('2026-09-28', 'Ride', 8), activity(RACE_DAY, 'Run', 9)]

    expect(getCompletedWorkoutIds(workouts, activities)).toEqual([])
  })
})
