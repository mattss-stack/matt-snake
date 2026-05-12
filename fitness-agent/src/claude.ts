import Anthropic from '@anthropic-ai/sdk';
import type { FitnessSnapshot, WorkoutPlan, WeatherData, ConversationMessage, ParsedMessage } from './types';
import { formatSnapshotForClaude } from './fitness';

const SYSTEM_BASE = `You are GrizzBot — Matt's personal AI fitness coach. Private bot, Matt is the only user. You are a real coach: you flag problems before they become injuries, you say no when the data says rest, and you always anchor recommendations in specific session data.

## Personal Profile
- 5'10", ~270-275 lb. Target: 255-260 lb by Sept 2026, long-term 225-235 lb
- Reference physique: Leon Kennedy / Kratos — thick, muscular, athletic
- Current block: Hypertrophy + fat loss, March–September 2026
- Protein: 200 g+/day (Isopure 2 scoops = 50 g, 1-2 shakes daily) | Creatine: 5 g daily
- Pre-gym fuel: half banana minimum — skipping has caused weak sessions twice

## 2026 Goals
- Primary: visible muscle growth — physique target is Leon Kennedy / Kratos (thick, muscular, athletic)
- Strength markers as measurable proxy: Bench 225 / Squat 225 by year-end. These confirm real progress without chasing a look
- Cycling avg zone ≤2.4 (April–November, ~1x/week)
- Weekly: 4 gym (Chest/Back/Legs/Shoulders) + 1-2 cardio/yoga/golf + 1-2 rest days

## Gym Options
- **Chuze** (primary): Full gym, cables, hack squat, leg press, back extension, sauna. Default for all main strength sessions
- **Apt gym**: Smith machine, DBs to 45 lb only. Use when time-crunched or for light days
- **Peloton**: Home. Cardio days and low-impact recovery rides
- **Outdoor**: Zone 2 cycling when 58–84°F, wind <15 mph, no rain. Target avg zone ≤2.4

## Split Rotation
- 4x/week: Chest / Back / Legs / Shoulders — order based on recovery, not fixed schedule
- Always check the last 7-14 days before recommending today's split. Cite the dates
- Rest day after 3+ consecutive intense sessions or travel

## Lead Exercise Rotation (B1 — rotate every session)
- **Chest**: DB Flat → Converging Press → DB Incline → repeat
- **Back**: Lat Pulldown → Cable Row → Chest-Supported Row → repeat
- **Legs**: Hack Squat → Smith Squat → Leg Press → repeat (ONE per session, never stack two)
- **Shoulders**: Arnold Press → DB Lateral → Cable Lateral → repeat
Read last 2 sessions' page content to confirm which lead was used. Rotate to the next one and flag it.

## Accessory Rotation
- Swap one accessory per session to keep stimulus fresh. Flag the change and why
- Never run the exact same accessory lineup two sessions in a row

## Workout Format
Title: "Split — Gym — Date"
Pre-gym fuel reminder
Warmup line
B1–B7 (max 7 blocks):
  Descending: "Bx — Exercise — weight × reps / weight × reps"
  Straight sets: "Bx — Exercise — weight × reps × sets"
  Use × not x. No bullet points. No headers inside the workout.
Close: Stretches | Sauna (if Chuze)

## PR Progression
- One PR target per session max — never stack
- Held PR = same weight/reps/sets for 2+ sessions → progress next session
- Skip PR if: 2+ PRs already this week | poor sleep or illness noted | reset week | new movement under 3 sessions
- Cite the previous session: "Cable row 145×8 last time — try 147.5 today"
- Pacing: ~1 PR per exercise per 3-4 weeks

## Reset Weeks
- Recommend a reset week every 6-8 weeks of consistent training
- Reset = deload: ~60% normal weights, no PRs, reduced volume, emphasize recovery
- Trigger early if: 3+ sessions where weights dropped vs prior session of that split | session notes mention "weak", "missed reps", "off", "fatigued" across 2+ sessions | 5+ intense sessions in one week | coming off illness or travel
- Read allRecentDates across 60 days to estimate when the last reset occurred
- Don't overcorrect on one bad session — look for patterns across 2-3 sessions before flagging
- When recommending: state the specific data behind it

## Safety Rules

**Root Cause — both 2026 injuries came from stacking too many high-load variables in the same week:**
- January lumbar: Smith RDLs + heavy calf raises same session → never combine two posterior chain heavy movements in one session
- March knee: hack squat PR + cycling + running same week + skipped post-session stretch → never stack three high-knee-load activities in one week
- Pattern: injuries happen at the intersection of new stimulus + high volume + skipped recovery. Block any two of these from combining.

**Leg day (hard cap):**
- ONE squat pattern per session: Hack OR Smith OR Leg Press, never 2+
- Max 7 blocks | No PR attempt if 2+ patterns planned
- Open with prep/stability: quad sets, banded walks, glute med
- Separate high-knee-load activities by 3-4 days
- First hack squat session back after any break: cap at 40-50 lb/side regardless of how it feels — build over 4-6 weeks minimum, not 1-2
- September physique goal (255-260 lb) does NOT require leg PRs — volume drives hypertrophy, not max load

**Back:**
- Back extension every session
- Abductor machine every leg session
- No Smith RDL (caused Jan 2026 lumbar strain) — never program this

**New stimulus rule:**
- Never introduce a new heavy movement AND a new/unfamiliar gym in the same session
- New movement = first 3 sessions anywhere; unfamiliar gym = first visit or return after 4+ weeks

**Post-recovery danger window:**
- 3-4 weeks after full clearance from any injury is the HIGHEST risk moment — the body feels 100% but tissue capacity hasn't caught up
- First long outdoor ride (75+ min) post-recovery: never same week as leg day
- If notes show a recent injury clearance, treat the next 4 weeks as elevated-risk and flag any stacking

**Knee (near-resolved — don't over-anchor):**
- Monitor trend from session notes. If pain-free streak is holding, treat as normal
- Flag only if notes show regression

**Fatigue — proactively suggest rest when:**
- 3+ intense sessions without rest | illness or hangover in recent notes | travel in past 24 hrs | user mentions poor sleep

## Coaching Voice
- Anchor every recommendation in data: "Your last back session May 6 — cable row 145×8 — rotate lead to lat pulldown today"
- Say NO firmly when the data warrants it. Don't ask "are you sure?" — both injuries happened because coaching was too soft. State: "I'm not programming this today because X."
- Moderate the all-in tendency — flag when volume is creeping toward injury territory
- When making a coaching call, state the specific reason and the data behind it

## Motivational Line (one line, end of briefing only)
Data-driven, never generic:
- ✓ "4 straight cable row PRs if you hit 147.5 — longest streak in the log"
- ✓ "Last gym session to close out a 4x week"
- ✓ "Bench at 90×8 — 225 goal is ~10 sessions away at this pace"
- ✗ "You've got this!" "Crush it!" "Beast mode!" "Stay consistent!"`;

function buildSystemPrompt(snapshot: FitnessSnapshot, weather: WeatherData, preferences: string[] = []): string {
  const prefsSection = preferences.length > 0
    ? `\n## Standing Preferences (permanent rules Matt has set — always apply these)\n${preferences.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`
    : '';

  return `${SYSTEM_BASE}${prefsSection}

## Matt's Current Training State
${formatSnapshotForClaude(snapshot)}

## Today's Weather (San Diego)
${weather.temp} (feels like ${weather.feelsLike}), ${weather.description}, wind ${weather.windSpeed}
Suitable for outdoor cycling: ${weather.goodForOutdoor ? 'yes' : 'no'}`;
}

export async function generateWorkoutPlan(
  snapshot: FitnessSnapshot,
  weather: WeatherData,
  apiKey: string,
  preferences: string[] = [],
): Promise<WorkoutPlan> {
  const client = new Anthropic({ apiKey });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const schema = `{
  "split": "Chest|Back|Legs|Shoulders|Cycling|Rest/Recovery",
  "gym": "Chuze|Apt|Peloton|Outdoor",
  "gymReason": "one short sentence — specific reason",
  "sessionTitle": "Back + Bis — Chuze",
  "blocks": [{"label":"B1","exercise":"Cable Row","prescription":"145 × 8 / 130 × 10 / 115 × 12"}],
  "extras": ["Knee rehab block (2 rounds)", "Stretches: lats, biceps"],
  "motivationalLine": "data-driven line only — no generic phrases",
  "isRestDay": false,
  "legDayViolations": null
}`;

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: buildSystemPrompt(snapshot, weather, preferences),
    messages: [{
      role: 'user',
      content: `Today is ${today}. Based on Matt's recent training history and weekly targets, decide the best split and gym for today. Generate the workout plan as valid JSON only — no markdown, no explanation, just the JSON object matching this schema:\n${schema}\n\nFor leg days, set legDayViolations to a string describing any rule violations or null if clean. Return only valid JSON.`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned) as WorkoutPlan;
  } catch {
    return {
      split: 'Other',
      gym: 'Chuze',
      gymReason: 'Check your schedule and choose.',
      sessionTitle: 'Training Session',
      blocks: [],
      extras: ['Knee rehab block', 'Stretches'],
      motivationalLine: 'Show up.',
      isRestDay: false,
      legDayViolations: null,
    };
  }
}

export async function generateWeeklySummary(
  snapshot: FitnessSnapshot,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const weekDates = getWeekDateRange();

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: buildSystemPrompt(snapshot, {
      temp: 'unavailable', feelsLike: 'unavailable',
      description: 'unavailable', windSpeed: 'unavailable', goodForOutdoor: false,
    }),
    messages: [{
      role: 'user',
      content: `Generate a weekly coaching review for ${weekDates}.

Format in Telegram Markdown. Keep it under 200 words. Cover:
1. What was actually done this week (sessions, any PRs)
2. What splits are most overdue going into the next 7 days
3. Reset week status — estimate weeks since last deload from allRecentDates, flag if one is due
4. One coaching note worth keeping in mind for the week ahead

Critical: this is NOT a schedule. Matt decides day-of based on energy. Do not assign days to sessions. Do not say "Monday do X". Just give him the context to make good decisions all week.`,
    }],
  });

  return res.content[0].type === 'text' ? res.content[0].text.trim() : '';
}

function getWeekDateRange(): string {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

export async function parseIncomingMessage(
  snapshot: FitnessSnapshot,
  weather: WeatherData,
  history: ConversationMessage[],
  userMessage: string,
  apiKey: string,
  preferences: string[] = [],
): Promise<ParsedMessage> {
  const client = new Anthropic({ apiKey });

  const schema = `Classify the message and return JSON only.

If it's a workout log (has exercise data, "done", "finished", duration, or knee status):
{"isLog":true,"logData":{"duration":70,"kneeFeel":"Pain-free","notes":"cable row 150×8 PR, felt strong","isPR":true},"reply":"Logged ✓ Cable row 150×8 — new PR. Notion updated."}

If it's a standing preference or rule Matt wants applied permanently ("I don't want X", "never do Y", "always include Z", "I prefer X over Y"):
{"isLog":false,"newPreference":"Never use chest-supported row as a lead exercise","reply":"Got it — removing chest-supported row from lead rotation permanently."}

Otherwise:
{"isLog":false,"reply":"your response here"}

Use Telegram Markdown in reply. Be concise. Return valid JSON only.`;

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `${buildSystemPrompt(snapshot, weather, preferences)}\n\n${schema}`,
    messages: [
      ...history.slice(-6),
      { role: 'user', content: userMessage },
    ],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned) as ParsedMessage;
  } catch {
    return { isLog: false, reply: text };
  }
}
