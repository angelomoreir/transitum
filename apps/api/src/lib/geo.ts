import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { geocodeCache } from "../db/schema.js";
import { env } from "../env.js";

export interface Coords {
  lat: number;
  lng: number;
}

export interface GeoAddress {
  line1: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Geocoder {
  geocode(addr: GeoAddress): Promise<Coords | null>;
}

const normalize = (a: GeoAddress) =>
  [a.line1, a.postalCode, a.city, a.country]
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|")
    .slice(0, 300);

/**
 * Nominatim (OpenStreetMap). Política de uso: máx. 1 pedido/s e User-Agent
 * identificável — garantido por uma fila serializada neste processo.
 * Resultados (incluindo "não encontrado") ficam em cache na BD.
 */
export function createNominatimGeocoder(db: DB, log?: FastifyBaseLogger): Geocoder {
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;

  const query = async (params: Record<string, string>): Promise<Coords | null> => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const url = new URL("/search", env.GEOCODER_URL);
    for (const [k, v] of Object.entries({ format: "jsonv2", limit: "1", ...params })) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: { "user-agent": `Transitum/0.1 (${env.WEB_BASE_URL})`, "accept-language": "pt-PT" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = (await res.json()) as { lat: string; lon: string }[];
    return rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null;
  };

  return {
    async geocode(addr) {
      const key = normalize(addr);
      const [hit] = await db.select().from(geocodeCache).where(eq(geocodeCache.key, key));
      if (hit) return hit.lat != null && hit.lng != null ? { lat: hit.lat, lng: hit.lng } : null;

      const job = queue.then(async () => {
        const country = addr.country.toLowerCase();
        // Morada completa; se falhar, recua para código postal + localidade
        return (
          (await query({
            street: addr.line1,
            city: addr.city,
            postalcode: addr.postalCode,
            countrycodes: country,
          })) ??
          (await query({ postalcode: addr.postalCode, city: addr.city, countrycodes: country })) ??
          (await query({ city: addr.city, countrycodes: country }))
        );
      });
      queue = job.catch(() => undefined);
      try {
        const coords = await job;
        await db
          .insert(geocodeCache)
          .values({ key, lat: coords?.lat ?? null, lng: coords?.lng ?? null })
          .onConflictDoNothing();
        return coords;
      } catch (err) {
        log?.warn({ err, addr: key }, "geocodificação falhou");
        return null;
      }
    },
  };
}

export const noopGeocoder: Geocoder = { geocode: async () => null };

export function createGeocoder(db: DB, log?: FastifyBaseLogger): Geocoder {
  if (env.GEOCODER === "none" || env.NODE_ENV === "test") return noopGeocoder;
  return createNominatimGeocoder(db, log);
}

/** Distância em linha reta (km) — fórmula de Haversine. */
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimativa de distância por estrada (linha reta × fator configurável). */
export const estimateRoadKm = (a: Coords, b: Coords) =>
  Math.round(haversineKm(a, b) * env.ROAD_DISTANCE_FACTOR * 10) / 10;

export const coordsOf = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null ? { lat, lng } : null;

/**
 * Ordenação greedy (nearest-neighbor) de paragens.
 * `start` é o ponto de partida (ex.: posição do motorista ou 1ª paragem);
 * por omissão usa-se a primeira paragem geocodificada. Paragens sem
 * coordenadas ficam no fim, pela ordem original.
 */
export function optimizeStopOrder<T extends { lat: number | null; lng: number | null }>(
  stops: T[],
  start?: Coords | null,
): T[] {
  const geo = stops.filter((s) => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (geo.length < 2) return [...geo, ...rest];

  let anchor: Coords = start ?? { lat: geo[0].lat!, lng: geo[0].lng! };
  const remaining = start ? [...geo] : geo.slice(1);
  const ordered = start ? [] : [geo[0]];

  while (remaining.length) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(anchor, { lat: remaining[i].lat!, lng: remaining[i].lng! });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    anchor = { lat: next.lat!, lng: next.lng! };
  }
  return [...ordered, ...rest];
}
