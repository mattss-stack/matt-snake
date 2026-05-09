import type { WeatherData } from './types';

interface WttrResponse {
  current_condition: Array<{
    temp_F: string;
    FeelsLikeF: string;
    weatherDesc: Array<{ value: string }>;
    windspeedMiles: string;
  }>;
}

export async function getWeather(location: string): Promise<WeatherData> {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('failed');

    const data = (await res.json()) as WttrResponse;
    const c = data.current_condition[0];
    const temp = parseInt(c.temp_F);
    const wind = parseInt(c.windspeedMiles);
    const desc = c.weatherDesc[0].value.toLowerCase();
    const isWet = desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower') || desc.includes('storm');

    return {
      temp: `${c.temp_F}°F`,
      feelsLike: `${c.FeelsLikeF}°F`,
      description: c.weatherDesc[0].value,
      windSpeed: `${c.windspeedMiles} mph`,
      goodForOutdoor: temp >= 58 && temp <= 84 && wind < 15 && !isWet,
    };
  } catch {
    return {
      temp: 'unavailable',
      feelsLike: 'unavailable',
      description: 'unavailable',
      windSpeed: 'unavailable',
      goodForOutdoor: false,
    };
  }
}

export function weatherDriveNote(weather: WeatherData): string {
  const temp = parseInt(weather.temp);
  if (isNaN(temp)) return weather.description;
  const desc = weather.description.toLowerCase();
  const isWet = desc.includes('rain') || desc.includes('drizzle');
  if (isWet) return `${weather.temp}, ${weather.description.toLowerCase()} — umbrella`;
  if (temp < 50) return `${weather.temp} — heavy jacket`;
  if (temp < 62) return `${weather.temp} — light jacket`;
  if (temp < 74) return `${weather.temp} — comfortable out`;
  if (temp < 84) return `${weather.temp} — warm, stay hydrated`;
  return `${weather.temp} — hot, extra water`;
}
