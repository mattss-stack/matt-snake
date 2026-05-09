import { sendMessage, sendTyping, setWebhook } from './telegram';
import { getWeather } from './weather';
import { getTodayWorkout } from './fitness';
import { generateMorningBriefing, handleConversation, extractProfile } from './claude';
import type { UserProfile, ConversationMessage, TelegramUpdate } from './types';

export interface Env {
  FITNESS_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

const KV_USERS_KEY = 'users';
const kvUserKey = (chatId: number) => `user:${chatId}`;
const kvConvKey = (chatId: number) => `conv:${chatId}`;

async function getProfile(env: Env, chatId: number): Promise<UserProfile | null> {
  const raw = await env.FITNESS_KV.get(kvUserKey(chatId));
  return raw ? JSON.parse(raw) : null;
}

async function saveProfile(env: Env, profile: UserProfile): Promise<void> {
  await env.FITNESS_KV.put(kvUserKey(profile.chatId), JSON.stringify(profile));

  const usersRaw = await env.FITNESS_KV.get(KV_USERS_KEY);
  const users: number[] = usersRaw ? JSON.parse(usersRaw) : [];
  if (!users.includes(profile.chatId)) {
    users.push(profile.chatId);
    await env.FITNESS_KV.put(KV_USERS_KEY, JSON.stringify(users));
  }
}

async function getConversationHistory(env: Env, chatId: number): Promise<ConversationMessage[]> {
  const raw = await env.FITNESS_KV.get(kvConvKey(chatId));
  return raw ? JSON.parse(raw) : [];
}

async function appendConversation(
  env: Env,
  chatId: number,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const history = await getConversationHistory(env, chatId);
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: assistantMessage });
  const trimmed = history.slice(-20);
  await env.FITNESS_KV.put(kvConvKey(chatId), JSON.stringify(trimmed));
}

async function sendBriefingToUser(env: Env, chatId: number): Promise<void> {
  const profile = await getProfile(env, chatId);
  if (!profile || !profile.setupComplete) return;

  const [weather, workout] = await Promise.all([
    getWeather(profile.location),
    Promise.resolve(getTodayWorkout()),
  ]);

  const briefing = await generateMorningBriefing(profile, weather, workout, env.ANTHROPIC_API_KEY);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, briefing);

  profile.lastBriefingSent = new Date().toISOString();
  await saveProfile(env, profile);
}

async function handleCommand(
  env: Env,
  chatId: number,
  command: string,
  fromName: string,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (command === '/start') {
    const existing = await getProfile(env, chatId);
    if (existing?.setupComplete) {
      await sendMessage(token, chatId,
        `Welcome back, *${existing.name}*! Type anything to chat, or use:\n\n` +
        `/briefing — get today's workout briefing\n` +
        `/profile — view your current profile\n` +
        `/help — show all commands`
      );
    } else {
      await sendMessage(token, chatId,
        `Hey! I'm your personal fitness coach. Let's get you set up.\n\n` +
        `Tell me about yourself in one message:\n` +
        `• Your *name*\n` +
        `• Your *city* (for weather)\n` +
        `• Your *fitness goal* (e.g., build muscle, lose weight, improve endurance)\n` +
        `• Your *fitness level* (beginner / intermediate / advanced)\n` +
        `• Your *equipment* (e.g., full gym, home dumbbells, bodyweight only)\n\n` +
        `I'll generate your profile and send your first briefing right away.`
      );
    }
    return;
  }

  if (command === '/briefing') {
    const profile = await getProfile(env, chatId);
    if (!profile?.setupComplete) {
      await sendMessage(token, chatId, 'Run /start first to set up your profile.');
      return;
    }
    await sendTyping(token, chatId);
    await sendBriefingToUser(env, chatId);
    return;
  }

  if (command === '/profile') {
    const profile = await getProfile(env, chatId);
    if (!profile?.setupComplete) {
      await sendMessage(token, chatId, 'No profile found. Run /start to get set up.');
      return;
    }
    await sendMessage(token, chatId,
      `*Your Profile*\n\n` +
      `*Name:* ${profile.name}\n` +
      `*Location:* ${profile.location}\n` +
      `*Goal:* ${profile.fitnessGoal}\n` +
      `*Level:* ${profile.fitnessLevel}\n` +
      `*Equipment:* ${profile.equipmentAccess}\n\n` +
      `_To update anything, just tell me what to change._`
    );
    return;
  }

  if (command === '/help') {
    await sendMessage(token, chatId,
      `*Commands*\n\n` +
      `/start — set up your profile\n` +
      `/briefing — get today's workout briefing now\n` +
      `/profile — view your profile\n` +
      `/help — show this menu\n\n` +
      `_You can also just message me — ask about exercises, form tips, nutrition, or anything fitness-related._`
    );
    return;
  }
}

async function handleMessage(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  if (text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();
    await handleCommand(env, chatId, command, message.from.first_name);
    return;
  }

  const profile = await getProfile(env, chatId);

  if (!profile || !profile.setupComplete) {
    await sendTyping(token, chatId);

    const extracted = await extractProfile(text, env.ANTHROPIC_API_KEY);
    const hasEnough = extracted.name && extracted.location && extracted.fitnessGoal && extracted.fitnessLevel;

    if (!hasEnough) {
      await sendMessage(token, chatId,
        `I need a bit more info to set you up. Please include your *name*, *city*, *fitness goal*, *fitness level*, and *equipment access* in one message.`
      );
      return;
    }

    const newProfile: UserProfile = {
      chatId,
      name: extracted.name!,
      location: extracted.location!,
      fitnessGoal: extracted.fitnessGoal!,
      fitnessLevel: extracted.fitnessLevel!,
      equipmentAccess: extracted.equipmentAccess ?? 'not specified',
      setupComplete: true,
      registeredAt: new Date().toISOString(),
    };

    await saveProfile(env, newProfile);
    await sendMessage(token, chatId,
      `Got it, *${newProfile.name}*! Profile saved.\n\n` +
      `*Goal:* ${newProfile.fitnessGoal}\n` +
      `*Level:* ${newProfile.fitnessLevel}\n` +
      `*Location:* ${newProfile.location}\n` +
      `*Equipment:* ${newProfile.equipmentAccess}\n\n` +
      `Generating your first briefing now...`
    );

    await sendBriefingToUser(env, chatId);
    return;
  }

  await sendTyping(token, chatId);

  const [weather, workout, history] = await Promise.all([
    getWeather(profile.location),
    Promise.resolve(getTodayWorkout()),
    getConversationHistory(env, chatId),
  ]);

  const reply = await handleConversation(profile, weather, workout, history, text, env.ANTHROPIC_API_KEY);
  await sendMessage(token, chatId, reply);
  await appendConversation(env, chatId, text, reply);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      const update = (await request.json()) as TelegramUpdate;
      await handleMessage(env, update);
      return new Response('OK');
    }

    if (request.method === 'GET' && url.pathname === '/setup-webhook') {
      const workerUrl = `https://${url.host}/webhook`;
      const result = await setWebhook(env.TELEGRAM_BOT_TOKEN, workerUrl, env.TELEGRAM_WEBHOOK_SECRET);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Matt Fitness Agent — running');
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const usersRaw = await env.FITNESS_KV.get(KV_USERS_KEY);
    if (!usersRaw) return;

    const chatIds: number[] = JSON.parse(usersRaw);
    await Promise.all(chatIds.map((chatId) => sendBriefingToUser(env, chatId)));
  },
};
