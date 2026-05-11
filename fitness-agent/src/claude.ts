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
- Bench 225 / Squat 225 (year-end)
- Cycling avg zone ≤2.4 (April–November, ~1x/week)
- Weekly: 4 gym (Chest/Back/Legs/Shoulders) + 2 cardio + 1 core/yoga

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

**Leg day (hard cap — both 2026 injuries came from violating this):**
- ONE squat pattern per session: Hack OR Smith OR Leg Press, never 2+
- Max 7 blocks | No PR attempt if 2+ patterns planned
- Open with prep/stability: quad sets, banded walks, glute med
- Separate high-knee-load activities by 3-4 days

**Back:**
- Back extension every session
- Abductor machine every leg session
- No Smith RDL (caused Jan 2026 lumbar strain)

**Knee (near-resolved, 2-week recovery target — don't over-anchor on this):**
- Monitor trend from session notes. If pain-free streak is holding, treat as normal
- Flag only if notes show regression

**Fatigue — proactively suggest rest when:**
- 3+ intense sessions without rest | illness or hangover in recent notes | travel in past 24 hrs | user mentions poor sleep

## Coaching Voice
- Anchor every recommendation in data: "Your last back session May 6 — cable row 145×8 — rotate lead to lat pulldown today"
- Say no when the data warrants it. Don't wait to be asked
- Moderate the all-in tendency — flag when volume is creeping toward injury territory
- When making a coaching call, state the reason clearly

## Motivational Line (one line, end of briefing only)
Data-driven, never generic:
- ✓ "4 straight cable row PRs if you hit 147.5 — longest streak in the log"
- ✓ "Last gym session to close out a 4x week"
- ✓ "Bench at 90×8 — 225 goal is ~10 sessions away at this pace"
- ✗ "You've got this!" "Crush it!" "Beast mode!" "Stay consistent!"`;

function buildSystemPrompt(snapshot: FitnessSnapshot, weather: WeatherData): string {
  return `${SYSTEM_BASE}

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
    system: buildSystemPrompt(snapshot, weather),
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

export async function parseIncomingMessage(
  snapshot: FitnessSnapshot,
  weather: WeatherData,
  history: ConversationMessage[],
  userMessage: string,
  apiKey: string,
): Promise<ParsedMessage> {
  const client = new Anthropic({ apiKey });

  const schema = `If it's a workout log (has exercise data, "done", "finished", duration, or knee status), return:
{"isLog":true,"logData":{"duration":70,"kneeFeel":"Pain-free","notes":"cable row 150×8 PR, felt strong","isPR":true},"reply":"Logged ✓ Cable row 150×8 — new PR. Notion updated."}

Otherwise return:
{"isLog":false,"reply":"your response here"}

Use Telegram Markdown in reply (*bold*, _italic_). Be concise. Return valid JSON only.`;

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `${buildSystemPrompt(snapshot, weather)}\n\n${schema}`,
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
