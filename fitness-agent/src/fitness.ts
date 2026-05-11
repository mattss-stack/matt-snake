import type { NotionSession, FitnessSnapshot, SessionSummary, WorkoutPlan, WeatherData } from './types';
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
  const recentByType: Record<string, SessionSummary[]> = {};
  const allRecentDates: { date: string; split: string }[] = [];
  const kneeTrend: string[] = [];
  const weekSessions: string[] = [];

  for (const s of sessions) {
    allRecentDates.push({ date: s.date, split: s.split });

    if (!['Rest/Recovery', 'Other'].includes(s.split)) {
      if (!recentByType[s.split]) recentByType[s.split] = [];
      // Keep last 2 per split (sessions are newest-first from Notion query)
      if (recentByType[s.split].length < 2) {
        recentByType[s.split].push({
          date: s.date,
          gym: s.gym,
          duration: s.duration,
          notes: s.notes,
          kneeFeel: s.kneeFeel,
          isPR: s.isPR,
          pageContent: s.pageContent,
        });
      }
    }

    if (kneeTrend.length < 5 && s.kneeFeel && s.kneeFeel !== 'N/A') {
      kneeTrend.push(`${s.date} ${s.kneeFeel}`);
    }

    if (s.date >= monday && !['Rest/Recovery', 'Other'].includes(s.split)) {
      weekSessions.push(s.split);
    }
  }

  return { lastUpdated: new Date().toISOString(), recentByType, allRecentDates, kneeTrend, weekSessions };
}

export function formatSnapshotForClaude(snapshot: FitnessSnapshot): string {
  const lines: string[] = [];

  // Full recent schedule — Claude uses this to decide what to train today
  lines.push('## RECENT SCHEDULE (newest first)');
  if (snapshot.allRecentDates.length === 0) {
    lines.push('No sessions in the last 14 days.');
  } else {
    lines.push(snapshot.allRecentDates.map((d) => `${d.date}: ${d.split}`).join(' | '));
  }
  lines.push('');

  // Last 2 sessions per split with full workout — for weights and exercise rotation
  lines.push('## LAST 2 SESSIONS PER TYPE');
  lines.push('(Use these for progressive overload targets and to rotate exercises)');
  lines.push('');

  if (Object.keys(snapshot.recentByType).length === 0) {
    lines.push('No session history found.');
  } else {
    for (const [split, sessions] of Object.entries(snapshot.recentByType)) {
      lines.push(`### ${split.toUpperCase()}`);
      sessions.forEach((s, i) => {
        const label = i === 0 ? 'Most recent' : 'Previous';
        const pr = s.isPR ? ' ★PR' : '';
        const dur = s.duration ? ` ${s.duration}min` : '';
        const knee = s.kneeFeel !== 'N/A' ? ` knee:${s.kneeFeel}` : '';
        lines.push(`${label}: ${s.date}${dur} @ ${s.gym}${knee}${pr}`);
        if (s.pageContent) {
          lines.push(s.pageContent);
        } else if (s.notes) {
          lines.push(`Notes: ${s.notes}`);
        }
        lines.push('');
      });
    }
  }

  // Weekly progress
  const gymCount = snapshot.weekSessions.filter((s) =>
    ['Chest', 'Back', 'Legs', 'Shoulders'].includes(s),
  ).length;
  const cardioCount = snapshot.weekSessions.filter((s) => s === 'Cycling').length;
  lines.push(`## THIS WEEK: ${snapshot.weekSessions.join(', ') || 'none yet'} — ${gymCount}/4 gym, ${cardioCount}/2 cardio`);

  // Knee trend
  const kneeStr = snapshot.kneeTrend.length > 0 ? snapshot.kneeTrend.join(' | ') : 'no data';
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

  const weatherIcon = getWeatherIcon(weather.description);
  lines.push(`${weatherIcon} ${weatherDriveNote(weather)}`);
  lines.push('');

  lines.push(`📍 *${plan.gym}* — ${plan.gymReason}`);
  lines.push('');

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
