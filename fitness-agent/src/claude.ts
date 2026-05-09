import Anthropic from '@anthropic-ai/sdk';
import type { FitnessSnapshot, WorkoutPlan, WeatherData, ConversationMessage, ParsedMessage } from './types';
import { formatSnapshotForClaude } from './fitness';

const SYSTEM_BASE = `You are Matt's personal fitness coach. This is a private bot — Matt is the only user.

## 2026 Goals
- Bench 225 / Squat 225 (year-end)
- Cycling avg zone ≤2.4 (April–November, ~1x/week)
- Weekly target: 4 gym (Chest/Back/Legs/Shoulders) + 2 cardio + 1 core + 1 yoga

## Gym Options
- **Chuze**: Full gym — cables, squat rack, leg press, hack squat, sauna. 10-15 min drive. Default for all main strength sessions.
- **Apt**: Apartment gym — dumbbells + basic cable. No commute. Use for light shoulders, core, or if time-crunched.
- **Peloton**: Home bike. Low-impact cardio. Use for cardio days, knee-sensitive days, or bad weather.
- **Outdoor**: Zone 2 cycling. Use when 58–84°F, wind <15 mph, no rain, knee is cleared (Pain-free trend).

## Hard Injury Rules — Right Knee Patellar Tendinitis (onset 3/24/26)
1. ONE heavy squat pattern per leg session — hack OR smith OR leg press, never 2+
2. Max 7 blocks total per session
3. No PR attempt if 2+ squat patterns are planned
4. Every leg day opens with prep/stability: quad sets, banded walks, glute med activation
5. No hack squat PR same week as a long ride (30+ miles)
6. Separate high-knee-load activities by 3–4 days
7. Knee rehab block + stretches mandatory at end of every session
8. Patellar strap only for hack squat and heavy leg press — not flat cycling

## Current PRs (April 2026 — update when Matt logs new ones)
Cable Row: 145×8 | Lat Pulldown: 130×6 | One Arm DB Row: 45×10
Back Extension: 220×10
Converging Chest Press: 90×8 | DB Flat Press: 60/side×8 | DB Incline: 50/side×8
Close Grip Fixed Bar: 70×10×3 | Overhead Cable Tri: 70×10×3
Arnold Press: 35×12 | Seated DB OH Press: 30×10×3
Rear Delt Fly: 130×10×3 | Hammer Curl: 30×10
Leg Press (knee-safe working): 190×10

## Workout Format Rules
- Always B1–B7, max 7 blocks
- Format: "B1 — Exercise Name — weight × reps / weight × reps × sets"
- Target: +2.5–5 lbs OR +1–2 reps vs last logged session for that split
- Be specific — never "moderate weight" or "challenging load"
- If Apt gym is chosen, only use exercises possible with DBs and basic cable

## Motivational Line Rules
- Exactly one line. Data-driven only. Never generic.
- ✓ "4 straight cable row PRs if you hit 147.5 today"
- ✓ "Last gym session to close out a 4x week — make it count"
- ✓ "Knee pain-free 5 straight — green light"
- ✓ "Bench at 90/8 — 225 goal is ~12 sessions away"
- ✗ "You've got this!" "Crush it!" "Beast mode!" "Let's go!"`;

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
