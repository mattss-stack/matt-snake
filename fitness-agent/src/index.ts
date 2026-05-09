import { sendMessage, sendTyping, setWebhook } from './telegram';
import { getWeather } from './weather';
import { buildSnapshot, formatTelegramBriefing } from './fitness';
import { generateWorkoutPlan, parseIncomingMessage } from './claude';
import { getRecentSessions, createWorkoutPage, updateWorkoutPage, notionPageUrl } from './notion';
import type { Env, FitnessSnapshot, ConversationMessage, TelegramUpdate } from './types';

const LOCATION = 'San Diego, CA';
const KV_SNAPSHOT = 'snapshot';
const KV_CONV = 'conv';

async function getSnapshot(env: Env): Promise<FitnessSnapshot | null> {
  const raw = await env.FITNESS_KV.get(KV_SNAPSHOT);
  return raw ? (JSON.parse(raw) as FitnessSnapshot) : null;
}

async function saveSnapshot(env: Env, snapshot: FitnessSnapshot): Promise<void> {
  await env.FITNESS_KV.put(KV_SNAPSHOT, JSON.stringify(snapshot));
}

async function getHistory(env: Env): Promise<ConversationMessage[]> {
  const raw = await env.FITNESS_KV.get(KV_CONV);
  return raw ? (JSON.parse(raw) as ConversationMessage[]) : [];
}

async function appendHistory(
  env: Env,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  const history = await getHistory(env);
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: assistantMsg });
  // Keep last 20 messages (10 exchanges), summarised naturally by Claude in context
  await env.FITNESS_KV.put(KV_CONV, JSON.stringify(history.slice(-20)));
}

async function sendDailyBriefing(env: Env): Promise<void> {
  const snapshot = await getSnapshot(env);
  if (!snapshot?.chatId) return; // no registered user yet

  const [sessions, weather] = await Promise.all([
    getRecentSessions(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, 14),
    getWeather(LOCATION),
  ]);

  const freshSnapshot: FitnessSnapshot = {
    ...snapshot,
    ...buildSnapshot(sessions, snapshot),
    chatId: snapshot.chatId,
  };

  const plan = await generateWorkoutPlan(freshSnapshot, weather, env.ANTHROPIC_API_KEY);

  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD

  let pageId: string | undefined;
  if (!plan.isRestDay && plan.blocks.length > 0) {
    try {
      pageId = await createWorkoutPage(
        env.NOTION_API_KEY,
        env.NOTION_DATABASE_ID,
        plan.sessionTitle,
        todayISO,
        plan.split,
        plan.gym,
        plan.blocks,
        plan.extras,
      );
    } catch {
      // Notion write failed — briefing still sends without link
    }
  }

  freshSnapshot.todayPageId = pageId;
  freshSnapshot.todayDate = todayISO;
  await saveSnapshot(env, freshSnapshot);

  const notionUrl = pageId ? notionPageUrl(pageId) : 'https://notion.so';
  const message = formatTelegramBriefing(plan, weather, notionUrl);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, snapshot.chatId, message);
}

async function handleCommand(env: Env, chatId: number, command: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (command === '/start') {
    const snapshot = await getSnapshot(env);
    if (snapshot?.chatId) {
      await sendMessage(token, chatId,
        `Already registered. Commands:\n/briefing — generate today's plan now\n/help — show commands`,
      );
    } else {
      const existing = snapshot ?? {} as Partial<FitnessSnapshot>;
      const newSnapshot: FitnessSnapshot = {
        chatId,
        lastUpdated: new Date().toISOString(),
        lastSessions: existing.lastSessions ?? {},
        kneeTrend: existing.kneeTrend ?? [],
        weekSessions: existing.weekSessions ?? [],
      };
      await saveSnapshot(env, newSnapshot);
      await sendMessage(token, chatId,
        `Registered. You'll get a briefing every morning at 5 AM PT.\n\nType /briefing to get today's plan now, or just ask me anything about your training.`,
      );
    }
    return;
  }

  if (command === '/briefing') {
    await sendTyping(token, chatId);
    await sendDailyBriefing(env);
    return;
  }

  if (command === '/help') {
    await sendMessage(token, chatId,
      `*Commands*\n/briefing — generate today's workout now\n/start — register for daily briefings\n/help — this menu\n\n_Or just message me — log a session, ask about form, ask what to eat, anything._`,
    );
    return;
  }
}

async function handleIncoming(env: Env, update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  if (text.startsWith('/')) {
    await handleCommand(env, chatId, text.split(' ')[0].toLowerCase());
    return;
  }

  const snapshot = await getSnapshot(env);
  if (!snapshot?.chatId) {
    await sendMessage(token, chatId, 'Run /start first to register.');
    return;
  }

  await sendTyping(token, chatId);

  const [sessions, weather, history] = await Promise.all([
    // Only re-fetch Notion if snapshot is stale (>6 hours old)
    isSnapshotStale(snapshot)
      ? getRecentSessions(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, 14)
      : Promise.resolve(null),
    getWeather(LOCATION),
    getHistory(env),
  ]);

  let activeSnapshot = snapshot;
  if (sessions) {
    activeSnapshot = { ...snapshot, ...buildSnapshot(sessions, snapshot), chatId: snapshot.chatId };
    await saveSnapshot(env, activeSnapshot);
  }

  const parsed = await parseIncomingMessage(activeSnapshot, weather, history, text, env.ANTHROPIC_API_KEY);

  if (parsed.isLog && parsed.logData) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (snapshot.todayPageId && snapshot.todayDate === today) {
      try {
        await updateWorkoutPage(env.NOTION_API_KEY, snapshot.todayPageId, parsed.logData);
      } catch {
        // Update failed silently — user still gets confirmation reply
      }
    }
    // Refresh snapshot from Notion after log so next message has updated data
    try {
      const refreshed = await getRecentSessions(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, 14);
      const updated = { ...activeSnapshot, ...buildSnapshot(refreshed, activeSnapshot), chatId: activeSnapshot.chatId };
      await saveSnapshot(env, updated);
    } catch {
      // Non-critical
    }
  }

  await sendMessage(token, chatId, parsed.reply);
  await appendHistory(env, text, parsed.reply);
}

function isSnapshotStale(snapshot: FitnessSnapshot): boolean {
  const sixHours = 6 * 60 * 60 * 1000;
  return Date.now() - new Date(snapshot.lastUpdated).getTime() > sixHours;
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
      await handleIncoming(env, update);
      return new Response('OK');
    }

    // One-time webhook registration: visit this URL after deploying
    if (request.method === 'GET' && url.pathname === '/setup-webhook') {
      const result = await setWebhook(
        env.TELEGRAM_BOT_TOKEN,
        `https://${url.host}/webhook`,
        env.TELEGRAM_WEBHOOK_SECRET,
      );
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Matt Fitness Agent');
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await sendDailyBriefing(env);
  },
};
