import type { WorkoutDay } from './types';

// 0=Sunday, 1=Monday, ..., 6=Saturday
const WORKOUT_SCHEDULE: WorkoutDay[] = [
  { day: 'Sunday', type: 'Rest & Recovery', focus: 'foam rolling, light stretching, mobility work', isRestDay: true },
  { day: 'Monday', type: 'Upper Push', focus: 'chest, front shoulders, triceps', isRestDay: false },
  { day: 'Tuesday', type: 'Lower Body', focus: 'quads, hamstrings, glutes, calves', isRestDay: false },
  { day: 'Wednesday', type: 'Active Recovery', focus: 'brisk walk, yoga, or light cycling — keep heart rate low', isRestDay: true },
  { day: 'Thursday', type: 'Upper Pull', focus: 'back, rear delts, biceps', isRestDay: false },
  { day: 'Friday', type: 'Full Body Power', focus: 'compound lifts, explosive movements', isRestDay: false },
  { day: 'Saturday', type: 'Cardio & Core', focus: 'HIIT intervals, ab circuit, functional core', isRestDay: false },
];

export function getTodayWorkout(): WorkoutDay {
  const dayIndex = new Date().getDay();
  return WORKOUT_SCHEDULE[dayIndex];
}
