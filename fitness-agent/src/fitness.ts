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
  confirmedRestDays: string[] = [],
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

  return {
    lastUpdated: new Date().toISOString(),
    recentByType,
    allRecentDates,
    kneeTrend,
    weekSessions,
    confirmedRestDays,
  };
}

function computeDensityAudit(snapshot: FitnessSnapshot): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const windowDays = 14;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffISO = cutoff.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // Training days in the 14-day window (exclude rest/recovery/other logged in Notion)
  const trainingDatesInWindow = snapshot.allRecentDates
    .filter((d) => d.date >= cutoffISO && d.date <= today)
    .filter((d) => !['Rest/Recovery', 'Other'].includes(d.split))
    .map((d) => d.date);
  const trainingDays = new Set(trainingDatesInWindow).size;

  // Confirmed rest days from calendar within window
  const confirmedRest = (snapshot.confirmedRestDays ?? []).filter(
    (d) => d >= cutoffISO && d <= today,
  );

  // Days accounted for = training + confirmed rest. Everything else is unlogged.
  const accountedDates = new Set([...trainingDatesInWindow, ...confirmedRest]);
  const unloggedDays = windowDays - accountedDates.size;

  const restRatio = Math.round(((confirmedRest.length + unloggedDays) / windowDays) * 100);

  // Consecutive training streak (count backwards from today)
  const trainingDateSet = new Set(trainingDatesInWindow);
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 14; i++) {
    const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (trainingDateSet.has(iso)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  // PRs this week
  const monday = getMondayISO(new Date());
  const prSessions = snapshot.allRecentDates.filter(
    (s) => s.date >= monday,
  );
  // We don't track PR flag per date in allRecentDates — flag from recentByType where available
  const prCount = Object.values(snapshot.recentByType)
    .flat()
    .filter((s) => s.isPR && s.date >= monday).length;

  const restFlag = restRatio < 15 ? ' — low, consider whether fatigue is accumulating' : '';
  const streakFlag = streak >= 5 ? ` — ${streak} straight, worth noting in your recommendation` : '';
  const prFlag = prCount >= 2 ? ' — at weekly limit, skip PR attempts today' : '';

  const calendarNote = (snapshot.confirmedRestDays ?? []).length === 0
    ? ' (calendar not connected — unlogged days assumed rest)'
    : ` (${confirmedRest.length} confirmed from calendar, ${unloggedDays} unlogged)`;

  return [
    '## LOAD CONTEXT — read before recommending',
    `Last ${windowDays} days: ${trainingDays} training days | ${confirmedRest.length + unloggedDays} rest/unlogged${calendarNote}`,
    `Rest ratio: ${restRatio}%${restFlag}`,
    `Consecutive training streak: ${streak} days${streakFlag}`,
    `PRs this week: ${prCount}${prFlag}`,
    '',
    'Use this as context, not a rulebook. A 4- or 5-day training block is normal.',
    'Flag fatigue only if session notes, intensity drops, or illness support it — not headcount alone.',
    '',
  ].join('\n');
}

export function formatSnapshotForClaude(snapshot: FitnessSnapshot): string {
  const lines: string[] = [];

  // Pre-flight density audit — always first so it can't be skipped
  lines.push(computeDensityAudit(snapshot));

  // Full recent schedule — Claude uses this to decide what to train today
  lines.push('## RECENT SCHEDULE (newest first)');
  if (snapshot.allRecentDates.length === 0) {
    lines.push('No sessions in the last 60 days.');
  } else {
    // Show Notion sessions + confirmed rest days merged and sorted newest-first
    const allEvents: { date: string; label: string }[] = [
      ...snapshot.allRecentDates.map((d) => ({ date: d.date, label: d.split })),
      ...(snapshot.confirmedRestDays ?? []).map((d) => ({ date: d, label: 'Rest (calendar)' })),
    ];
    allEvents.sort((a, b) => b.date.localeCompare(a.date));
    // Deduplicate by date (Notion session wins over calendar rest if both exist)
    const seen = new Set<string>();
    const deduped = allEvents.filter((e) => {
      if (seen.has(e.date)) return false;
      seen.add(e.date);
      return true;
    });
    lines.push(deduped.map((d) => `${d.date}: ${d.label}`).join(' | '));
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
