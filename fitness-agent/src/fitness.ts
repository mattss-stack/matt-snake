import type { NotionSession, FitnessSnapshot, WorkoutPlan, WeatherData } from './types';
import { weatherDriveNote } from './weather';

function getMondayISO(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

export function buildSnapshot(
  sessions: NotionSession[],
  existing: Partial<FitnessSnapshot> = {},
): Omit<FitnessSnapshot, 'chatId' | 'todayPageId' | 'todayDate'> {
  const monday = getMondayISO(new Date());
  const lastSessions: FitnessSnapshot['lastSessions'] = {};
  const kneeTrend: string[] = [];
  const weekSessions: string[] = [];

  for (const s of sessions) {
    if (!lastSessions[s.split] && !['Rest/Recovery', 'Other'].includes(s.split)) {
      lastSessions[s.split] = {
        date: s.date,
        gym: s.gym,
        duration: s.duration,
        notes: s.notes,
        kneeFeel: s.kneeFeel,
        isPR: s.isPR,
        pageContent: s.pageContent,
      };
    }
    if (kneeTrend.length < 5 && s.kneeFeel && s.kneeFeel !== 'N/A') {
      kneeTrend.push(`${s.date} ${s.kneeFeel}`);
    }
    if (s.date >= monday && !['Rest/Recovery', 'Other'].includes(s.split)) {
      weekSessions.push(s.split);
    }
  }

  return { lastUpdated: new Date().toISOString(), lastSessions, kneeTrend, weekSessions };
}

export function formatSnapshotForClaude(snapshot: FitnessSnapshot): string {
  const lines: string[] = ['RECENT SESSIONS (newest first):'];

  if (Object.keys(snapshot.lastSessions).length === 0) {
    lines.push('No recent sessions found.');
  } else {
    for (const [split, s] of Object.entries(snapshot.lastSessions)) {
      const pr = s.isPR ? ' ★PR' : '';
      const dur = s.duration ? ` ${s.duration}min` : '';
      const knee = s.kneeFeel !== 'N/A' ? ` knee:${s.kneeFeel}` : '';
      lines.push(`${split} — ${s.date}${dur} @ ${s.gym}${knee}${pr}`);
      if (s.pageContent) {
        // Include the actual B1-B7 blocks so Claude knows exact weights used
        lines.push(s.pageContent);
      } else if (s.notes) {
        lines.push(`Notes: ${s.notes}`);
      }
      lines.push('');
    }
  }

  const gymCount = snapshot.weekSessions.filter((s) =>
    ['Chest', 'Back', 'Legs', 'Shoulders'].includes(s),
  ).length;
  const cardioCount = snapshot.weekSessions.filter((s) => s === 'Cycling').length;
  lines.push(
    `\nTHIS WEEK: ${snapshot.weekSessions.join(', ') || 'none yet'} — ${gymCount}/4 gym, ${cardioCount}/2 cardio`,
  );

  const kneeStr = snapshot.kneeTrend.length > 0 ? snapshot.kneeTrend.join(' | ') : 'no recent data';
  lines.push(`KNEE TREND: ${kneeStr}`);

  return lines.join('\n');
}

export function formatTelegramBriefing(
  plan: WorkoutPlan,
  weather: WeatherData,
  notionUrl: string,
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const lines: string[] = [`*${today}*`, ''];

  // Weather line
  const weatherIcon = getWeatherIcon(weather.description);
  lines.push(`${weatherIcon} ${weatherDriveNote(weather)}`);
  lines.push('');

  // Gym recommendation
  lines.push(`📍 *${plan.gym}* — ${plan.gymReason}`);
  lines.push('');

  // Workout
  lines.push(`*${plan.sessionTitle}*`);

  if (plan.isRestDay) {
    lines.push('_Rest & recovery — mobility, stretching, or a walk_');
  } else {
    if (plan.legDayViolations) {
      lines.push(`⚠️ _Leg day check: ${plan.legDayViolations}_`);
      lines.push('');
    }
    for (const b of plan.blocks) {
      lines.push(`${b.label} — ${b.exercise} — ${b.prescription}`);
    }
    if (plan.extras.length > 0) {
      lines.push('');
      lines.push(`+ ${plan.extras.join(' · ')}`);
    }
  }

  lines.push('');
  lines.push('🍌 _Half banana before leaving_');
  lines.push('');
  lines.push(`[Open in Notion →](${notionUrl})`);
  lines.push('');
  lines.push(`_${plan.motivationalLine}_`);

  return lines.join('\n');
}

function getWeatherIcon(description: string): string {
  const d = description.toLowerCase();
  if (d.includes('sunny') || d.includes('clear')) return '☀️';
  if (d.includes('partly')) return '🌤';
  if (d.includes('cloud') || d.includes('overcast')) return '☁️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌧';
  if (d.includes('storm') || d.includes('thunder')) return '⛈';
  if (d.includes('fog') || d.includes('mist')) return '🌫';
  return '🌡';
}
