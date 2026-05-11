export interface Env {
  FITNESS_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  NOTION_API_KEY: string;
  NOTION_DATABASE_ID: string;
}

export interface FitnessSnapshot {
  chatId?: number;
  lastUpdated: string;
  todayPageId?: string;
  todayDate?: string;
  // Last 2 sessions per split with full page content — for progressive overload + exercise rotation
  recentByType: Record<string, SessionSummary[]>;
  // All sessions last 14 days (date + split only) — for scheduling: what needs rest, what's overdue
  allRecentDates: { date: string; split: string }[];
  kneeTrend: string[];   // last 5 knee feel readings: "2026-05-07 Pain-free"
  weekSessions: string[]; // splits completed since Monday
}

export interface SessionSummary {
  date: string;
  gym: string;
  duration?: number;
  notes: string;
  kneeFeel: string;
  isPR: boolean;
  pageContent?: string;
}

export interface NotionSession {
  id: string;
  url: string;
  date: string;
  split: string;
  gym: string;
  duration?: number;
  kneeFeel: string;
  notes: string;
  session: string;
  isPR: boolean;
  pageContent?: string; // B1-B7 workout lines from the page body
}

export interface WorkoutBlock {
  label: string;       // "B1"
  exercise: string;    // "Cable Row"
  prescription: string; // "145 × 8 / 130 × 10 / 115 × 12"
}

export interface WorkoutPlan {
  split: string;
  gym: 'Chuze' | 'Apt' | 'Peloton' | 'Outdoor';
  gymReason: string;
  sessionTitle: string;
  blocks: WorkoutBlock[];
  extras: string[];
  motivationalLine: string;
  isRestDay: boolean;
  legDayViolations: string | null;
}

export interface WeatherData {
  temp: string;
  feelsLike: string;
  description: string;
  windSpeed: string;
  goodForOutdoor: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
}

export interface ParsedMessage {
  isLog: boolean;
  logData?: {
    duration?: number;
    kneeFeel?: string;
    notes?: string;
    isPR?: boolean;
  };
  reply: string;
}
