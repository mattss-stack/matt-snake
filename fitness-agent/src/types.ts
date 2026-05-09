export interface UserProfile {
  chatId: number;
  name: string;
  location: string;
  fitnessGoal: string;
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced';
  equipmentAccess: string;
  setupComplete: boolean;
  registeredAt: string;
  lastBriefingSent?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WeatherData {
  temp: string;
  feelsLike: string;
  description: string;
  humidity: string;
  windSpeed: string;
}

export interface WorkoutDay {
  day: string;
  type: string;
  focus: string;
  isRestDay: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number };
  text?: string;
  date: number;
}
