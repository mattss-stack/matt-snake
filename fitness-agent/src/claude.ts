import Anthropic from '@anthropic-ai/sdk';
import type { UserProfile, WeatherData, WorkoutDay, ConversationMessage } from './types';

function buildSystemPrompt(profile: UserProfile, weather: WeatherData, workout: WorkoutDay): string {
  return `You are a personal fitness coach for ${profile.name}. You are knowledgeable, motivating, and direct — you get to the point.

User Profile:
- Name: ${profile.name}
- Location: ${profile.location}
- Fitness Goal: ${profile.fitnessGoal}
- Fitness Level: ${profile.fitnessLevel}
- Equipment: ${profile.equipmentAccess}

Today's Weather in ${profile.location}:
- Conditions: ${weather.description}
- Temperature: ${weather.temp} (feels like ${weather.feelsLike})
- Humidity: ${weather.humidity}, Wind: ${weather.windSpeed}

Today's Scheduled Workout: ${workout.type}
Focus: ${workout.focus}

Format all responses using Telegram Markdown: *bold* for headings and exercise names, _italic_ for emphasis. Never use # headers. Keep responses conversational and concise — no walls of text.`;
}

function buildSetupSystemPrompt(): string {
  return `Extract fitness profile information from the user's message. Return ONLY a valid JSON object with exactly these fields (use null for any that are missing or unclear):
{
  "name": string | null,
  "location": string | null,
  "fitnessGoal": string | null,
  "fitnessLevel": "beginner" | "intermediate" | "advanced" | null,
  "equipmentAccess": string | null
}
Return only the JSON, no other text.`;
}

export async function generateMorningBriefing(
  profile: UserProfile,
  weather: WeatherData,
  workout: WorkoutDay,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const userContent = workout.isRestDay
    ? `Generate a morning recovery day briefing. Include: a brief weather mention, what to do for active recovery today (specific activities/stretches), one tip for recovery/sleep/nutrition, and a short motivational line. Keep it under 250 words.`
    : `Generate a morning workout briefing for today's ${workout.type} session. Include:
1. Brief weather note with any relevant advice (e.g., "great day to warm up outside" or "drink extra water in the heat")
2. Today's workout with 4-6 specific exercises, sets, reps, and rest times — appropriate for a ${profile.fitnessLevel} training toward ${profile.fitnessGoal}
3. One key form tip or focus cue for today
4. A short energizing closer (1 sentence)

Keep it under 350 words. Be specific with the exercises — no generic "do some squats", give the full prescription.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(profile, weather, workout),
    messages: [{ role: 'user', content: userContent }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'Unable to generate briefing.';
}

export async function handleConversation(
  profile: UserProfile,
  weather: WeatherData,
  workout: WorkoutDay,
  history: ConversationMessage[],
  userMessage: string,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const trimmedHistory = history.slice(-8);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(profile, weather, workout),
    messages: [
      ...trimmedHistory,
      { role: 'user', content: userMessage },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : "I couldn't process that. Try again?";
}

export async function extractProfile(
  userMessage: string,
  apiKey: string,
): Promise<Partial<Pick<UserProfile, 'name' | 'location' | 'fitnessGoal' | 'fitnessLevel' | 'equipmentAccess'>>> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: buildSetupSystemPrompt(),
    messages: [{ role: 'user', content: userMessage }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    return JSON.parse(text);
  } catch {
    return {};
  }
}
