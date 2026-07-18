// ──────────────────────────────────────────────
// Living atmosphere — the shared sky every character lives under
// ──────────────────────────────────────────────
// A world-wide environment: the real clock, the season, the date and any
// holiday, and — when a city is configured — real current weather from
// Open-Meteo (free, keyless). Injected into every mind wake so everyone shares
// the same rainy Tuesday evening, and surfaced in the panel. Weather is cached
// for an hour; the clock/season/date are computed fresh.
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { safeFetch } from "../../utils/security.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";

const WEATHER_CACHE_KEY = "worldWeatherCache";
const GEOCODE_CACHE_KEY = "worldGeocodeCache";
const WEATHER_TTL_MS = 60 * 60_000;

export interface WorldAtmosphere {
  /** "Sunday morning", "Tuesday evening"… */
  dayPart: string;
  weekday: string;
  /** dawn | morning | midday | afternoon | evening | night */
  phase: string;
  season: string;
  /** "Jul 19" — the real date. */
  dateLabel: string;
  holiday: string | null;
  /** Real weather, when a location is configured and reachable. */
  weather: { tempC: number; condition: string; isDay: boolean; location: string } | null;
  /** One-line summary for prompt injection. */
  summary: string;
}

function phaseOf(hour: number): string {
  if (hour < 5) return "night";
  if (hour < 8) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function seasonOf(month: number): string {
  // Northern-hemisphere seasons by month (1-12).
  if (month <= 2 || month === 12) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** A small built-in holiday table (month/day → name); no external dependency. */
function holidayOf(month: number, day: number): string | null {
  const table: Record<string, string> = {
    "1-1": "New Year's Day",
    "2-14": "Valentine's Day",
    "3-17": "St. Patrick's Day",
    "4-1": "April Fools' Day",
    "7-4": "Independence Day",
    "10-31": "Halloween",
    "12-24": "Christmas Eve",
    "12-25": "Christmas",
    "12-31": "New Year's Eve",
  };
  return table[`${month}-${day}`] ?? null;
}

// WMO weather codes → plain words (Open-Meteo `weather_code`).
function weatherCondition(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzling";
  if (code <= 67) return "raining";
  if (code <= 77) return "snowing";
  if (code <= 82) return "rainy";
  if (code <= 86) return "snowy";
  if (code <= 99) return "thunderstorms";
  return "mild";
}

async function geocodeCity(db: DB, city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const appSettings = createAppSettingsStorage(db);
  const cacheKey = `${GEOCODE_CACHE_KEY}:${city.toLowerCase().trim()}`;
  const cached = await appSettings.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* refetch */
    }
  }
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8000),
      policy: { allowedProtocols: ["https:"] },
      allowedContentTypes: ["application/json"],
      maxResponseBytes: 512 * 1024,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> };
    const hit = data.results?.[0];
    if (!hit) return null;
    const resolved = { lat: hit.latitude, lon: hit.longitude, name: hit.name };
    await appSettings.set(cacheKey, JSON.stringify(resolved));
    return resolved;
  } catch (error) {
    logger.debug(error, "[world/atmosphere] Geocode failed for %s", city);
    return null;
  }
}

/** Fetch + cache current weather for the configured city (hourly TTL). */
export async function refreshWeather(db: DB, city: string): Promise<WorldAtmosphere["weather"]> {
  if (!city.trim()) return null;
  const appSettings = createAppSettingsStorage(db);
  const cached = await appSettings.get(WEATHER_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { fetchedAt: number; city: string; weather: WorldAtmosphere["weather"] };
      if (parsed.city === city && Date.now() - parsed.fetchedAt < WEATHER_TTL_MS) return parsed.weather;
    } catch {
      /* refetch */
    }
  }
  const geo = await geocodeCity(db, city);
  if (!geo) return null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,is_day`;
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8000),
      policy: { allowedProtocols: ["https:"] },
      allowedContentTypes: ["application/json"],
      maxResponseBytes: 512 * 1024,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
    };
    const current = data.current;
    if (!current) return null;
    const weather: WorldAtmosphere["weather"] = {
      tempC: Math.round(current.temperature_2m ?? 0),
      condition: weatherCondition(current.weather_code ?? 0),
      isDay: current.is_day !== 0,
      location: geo.name,
    };
    await appSettings.set(WEATHER_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), city, weather }));
    return weather;
  } catch (error) {
    logger.debug(error, "[world/atmosphere] Weather fetch failed");
    return null;
  }
}

/** The current shared atmosphere. Reads cached weather (never fetches here). */
export async function getAtmosphere(db: DB, weatherLocation: string, now: Date = new Date()): Promise<WorldAtmosphere> {
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const hour = now.getHours();
  const phase = phaseOf(hour);
  const season = seasonOf(now.getMonth() + 1);
  const dateLabel = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const holiday = holidayOf(now.getMonth() + 1, now.getDate());
  const dayPart = `${weekday} ${phase === "night" ? "night" : phase === "midday" ? "midday" : phase}`;

  let weather: WorldAtmosphere["weather"] = null;
  if (weatherLocation.trim()) {
    const appSettings = createAppSettingsStorage(db);
    const cached = await appSettings.get(WEATHER_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { city: string; weather: WorldAtmosphere["weather"] };
        if (parsed.city === weatherLocation) weather = parsed.weather;
      } catch {
        /* ignore */
      }
    }
  }

  const parts = [`It's ${season}, ${dayPart}`];
  if (holiday) parts.push(`— ${holiday}`);
  if (weather) parts.push(`— ${weather.condition}, ${weather.tempC}°C in ${weather.location}`);
  const summary = parts.join(" ");

  return { dayPart, weekday, phase, season, dateLabel, holiday, weather, summary };
}
