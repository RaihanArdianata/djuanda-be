import { getWeather, setWeather } from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import type { WeatherContextData } from "../modules/engine/types";

function weatherApiUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, alertServiceEnv.weatherServiceUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<{ data?: T } | null> {
  try {
    const token = process.env.SERVICE_API_TOKEN;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as { data?: T };
  } catch {
    return null;
  }
}

export async function getWeatherContext(
  airportId: string,
  station = airportId,
): Promise<WeatherContextData | null> {
  let data = await getWeather(airportId);
  if (!data) {
    const currentRes = await fetchJson<WeatherContextData["current"]>(
      weatherApiUrl("/weather/current", { station }),
    );
    const forecastRes = await fetchJson<WeatherContextData["forecast"]>(
      weatherApiUrl("/weather/forecast", { station }),
    );
    const current = currentRes?.data ?? null;
    const forecast = forecastRes?.data ?? null;
    if (!current && !forecast) return null;
    data = { station, current, forecast };
    await setWeather(airportId, data);
  }
  return data;
}

export async function cacheWeather(
  airportId: string,
  data: WeatherContextData,
): Promise<void> {
  await setWeather(airportId, data);
}
