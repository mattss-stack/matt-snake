import type { WeatherData } from './types';

interface WttrDay {
  uvIndex: string;
  hourly: Array<{
    tempF: string;
    FeelsLikeF: string;
    weatherDesc: Array<{ value: string }>;
    humidity: string;
    windspeedMiles: string;
  }>;
}

interface WttrResponse {
  current_condition: Array<{
    temp_F: string;
    FeelsLikeF: string;
    weatherDesc: Array<{ value: string }>;
    humidity: string;
    windspeedMiles: string;
  }>;
  weather: WttrDay[];
}

export async function getWeather(location: string): Promise<WeatherData> {
  try {
    const encoded = encodeURIComponent(location);
    const response = await fetch(`https://wttr.in/${encoded}?format=j1`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) throw new Error('weather fetch failed');

    const data = (await response.json()) as WttrResponse;
    const current = data.current_condition[0];

    return {
      temp: `${current.temp_F}°F`,
      feelsLike: `${current.FeelsLikeF}°F`,
      description: current.weatherDesc[0].value,
      humidity: `${current.humidity}%`,
      windSpeed: `${current.windspeedMiles} mph`,
    };
  } catch {
    return {
      temp: 'unavailable',
      feelsLike: 'unavailable',
      description: 'Weather data unavailable',
      humidity: 'unavailable',
      windSpeed: 'unavailable',
    };
  }
}
