import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { distanceCache } from "../db/schema.js";
import { env } from "../env.js";
import { estimateRoadKm, haversineKm, type Coords } from "./geo.js";

/**
 * Distâncias rodoviárias reais via OSRM (`/route/v1/driving`), com cache
 * persistente por par de coordenadas (~11 m de precisão). Sem router
 * configurado ou em falha, recua para a estimativa linha-reta × fator.
 */

export interface RouteLeg {
  km: number;
  durationMin: number | null;
  /** true quando veio do router; false = estimativa Haversine */
  routed: boolean;
}

const cacheKey = (a: Coords, b: Coords) =>
  `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

const routerEnabled = () => env.ROUTER === "osrm" && env.NODE_ENV !== "test";

async function osrmLeg(a: Coords, b: Coords): Promise<RouteLeg | null> {
  const url = new URL(
    `/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}`,
    env.ROUTER_URL,
  );
  url.searchParams.set("overview", "false");
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { "user-agent": `Transitum/0.1 (${env.WEB_BASE_URL})` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    routes?: { distance: number; duration: number }[];
  };
  const r = data.routes?.[0];
  if (!r) return null;
  return {
    km: Math.round((r.distance / 1000) * 10) / 10,
    durationMin: Math.round(r.duration / 60),
    routed: true,
  };
}

/** Distância A→B em km (+ duração estimada) — cache → OSRM → Haversine. */
export async function routeLeg(
  db: DB,
  a: Coords,
  b: Coords,
  log?: FastifyBaseLogger,
): Promise<RouteLeg> {
  const key = cacheKey(a, b);
  const [hit] = await db.select().from(distanceCache).where(eq(distanceCache.key, key));
  if (hit) return { km: hit.km, durationMin: hit.durationMin ?? null, routed: true };

  if (routerEnabled()) {
    try {
      const leg = await osrmLeg(a, b);
      if (leg) {
        await db
          .insert(distanceCache)
          .values({ key, km: leg.km, durationMin: leg.durationMin })
          .onConflictDoNothing();
        return leg;
      }
    } catch (err) {
      log?.warn({ err }, "OSRM indisponível — distância estimada");
    }
  }
  return {
    km: estimateRoadKm(a, b),
    durationMin: Math.round((haversineKm(a, b) * env.ROAD_DISTANCE_FACTOR) / 50 * 60),
    routed: false,
  };
}

/** Só distância (km). */
export const routeKm = async (db: DB, a: Coords, b: Coords, log?: FastifyBaseLogger) =>
  (await routeLeg(db, a, b, log)).km;

/**
 * Nearest-neighbor com matriz de distâncias real. Calcula as distâncias por
 * pares à medida que avança (n chamadas, cada uma com cache/router).
 * Paragens sem coordenadas ficam no fim, pela ordem original.
 */
export async function optimizeStopOrderAsync<T extends { lat: number | null; lng: number | null }>(
  db: DB,
  stops: T[],
  start?: Coords | null,
  log?: FastifyBaseLogger,
): Promise<T[]> {
  const geo = stops.filter((s) => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (geo.length < 2) return [...geo, ...rest];

  let anchor: Coords = start ?? { lat: geo[0].lat!, lng: geo[0].lng! };
  const remaining = start ? [...geo] : geo.slice(1);
  const ordered = start ? [] : [geo[0]];

  while (remaining.length) {
    const dists = await Promise.all(
      remaining.map((s) => routeKm(db, anchor, { lat: s.lat!, lng: s.lng! }, log)),
    );
    let best = 0;
    for (let i = 1; i < dists.length; i++) if (dists[i] < dists[best]) best = i;
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    anchor = { lat: next.lat!, lng: next.lng! };
  }
  return [...ordered, ...rest];
}
