import { createHash, randomInt } from "node:crypto";
import type { CarrierProvider } from "@transitum/shared";

/**
 * Adaptadores de transportadoras portuguesas.
 *
 *  - `sandbox`: simula marcação (nº de tracking no formato de cada operador) e
 *    progressão de tracking — para demonstração e testes, sem credenciais.
 *  - `live`:
 *      · Nacex — webservice HTTP público (pda.nacex.com/nacex_ws), métodos
 *        putExpedicion / getEstadoExpedicion / cancelExpedicion.
 *      · CTT Expresso e DPD Portugal — as APIs exigem contrato e documentação
 *        fornecida pelo operador; até lá, o tracking pode ser recebido por push
 *        em POST /api/v1/carrier-events (chave de API).
 */

export interface BookingInput {
  shipmentNumber: string;
  reference: string;
  sender: { name: string; line1: string; city: string; postalCode: string; country: string; phone?: string | null };
  recipient: { name: string; line1: string; city: string; postalCode: string; country: string; phone?: string | null; email?: string | null };
  packages: number;
  weightKg: number;
  notes?: string | null;
}

export interface BookingResult {
  trackingNumber: string;
  /** Referência interna do operador (ex.: código de expedição Nacex) */
  carrierRef: string;
}

export type CarrierStatus = "info" | "in_transit" | "out_for_delivery" | "delivered" | "exception";

export interface TrackingEvent {
  code: string;
  status: CarrierStatus;
  description: string;
  location?: string;
  occurredAt: Date;
}

export interface CarrierAdapter {
  provider: CarrierProvider;
  mode: "sandbox" | "live";
  book(input: BookingInput): Promise<BookingResult>;
  track(ref: { trackingNumber: string; carrierRef: string | null; bookedAt: Date }, now?: Date): Promise<TrackingEvent[]>;
  cancel(ref: { trackingNumber: string; carrierRef: string | null }): Promise<void>;
}

export const PROVIDER_LABELS: Record<CarrierProvider, string> = {
  ctt: "CTT Expresso",
  dpd: "DPD Portugal",
  nacex: "Nacex",
};

/** Campos de credenciais/configuração esperados por operador (para a UI e validação). */
export const PROVIDER_FIELDS: Record<CarrierProvider, { credentials: string[]; config: string[] }> = {
  ctt: { credentials: ["authenticationId", "clientId"], config: ["contractId", "subProductCode"] },
  dpd: { credentials: ["username", "password"], config: ["customerNumber", "service"] },
  nacex: { credentials: ["user", "password"], config: ["agency", "client", "service"] },
};

// ── Sandbox ─────────────────────────────────────────────────────────────────

function sandboxTrackingNumber(provider: CarrierProvider): string {
  const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
  if (provider === "ctt") {
    // Formato UPU S10: 2 letras + 8 dígitos + dígito de controlo + país
    const body = digits(8);
    const weights = [8, 6, 4, 2, 3, 5, 9, 7];
    const sum = body.split("").reduce((a, d, i) => a + Number(d) * weights[i], 0);
    let check = 11 - (sum % 11);
    if (check === 10) check = 0;
    if (check === 11) check = 5;
    return `EA${body}${check}PT`;
  }
  if (provider === "dpd") return `0${digits(13)}`;
  return `${digits(4)}/${digits(8)}`;
}

/** Linha temporal simulada a partir da hora de marcação. */
const SANDBOX_TIMELINE: { afterMin: number; code: string; status: CarrierStatus; description: string; location: string }[] = [
  { afterMin: 0, code: "ACCEPTED", status: "info", description: "Envio registado pelo expedidor", location: "Origem" },
  { afterMin: 120, code: "PICKED_UP", status: "in_transit", description: "Recolhido pelo operador", location: "Centro operacional de origem" },
  { afterMin: 480, code: "HUB", status: "in_transit", description: "Em trânsito no centro de distribuição", location: "Hub nacional" },
  { afterMin: 1200, code: "OUT_FOR_DELIVERY", status: "out_for_delivery", description: "Em distribuição", location: "Centro de distribuição de destino" },
  { afterMin: 1440, code: "DELIVERED", status: "delivered", description: "Entregue ao destinatário", location: "Destino" },
];

function createSandboxAdapter(provider: CarrierProvider): CarrierAdapter {
  return {
    provider,
    mode: "sandbox",
    async book() {
      const trackingNumber = sandboxTrackingNumber(provider);
      return { trackingNumber, carrierRef: `SBX-${createHash("sha1").update(trackingNumber).digest("hex").slice(0, 10)}` };
    },
    async track(ref, now = new Date()) {
      const elapsedMin = (now.getTime() - ref.bookedAt.getTime()) / 60_000;
      return SANDBOX_TIMELINE.filter((e) => e.afterMin <= elapsedMin).map((e) => ({
        code: e.code,
        status: e.status,
        description: `${e.description} (sandbox ${PROVIDER_LABELS[provider]})`,
        location: e.location,
        occurredAt: new Date(ref.bookedAt.getTime() + e.afterMin * 60_000),
      }));
    },
    async cancel() {},
  };
}

// ── Nacex (live) ────────────────────────────────────────────────────────────

const NACEX_URL = "https://pda.nacex.com/nacex_ws/ws";

function createNacexAdapter(credentials: Record<string, string>, config: Record<string, string>): CarrierAdapter {
  const user = credentials.user;
  const pass = credentials.password ? createHash("md5").update(credentials.password).digest("hex").toUpperCase() : "";
  if (!user || !pass) throw new Error("Nacex: credenciais em falta (user, password)");

  const call = async (method: string, data: Record<string, string>) => {
    const pairs = Object.entries(data).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    const url = `${NACEX_URL}?method=${method}&user=${encodeURIComponent(user)}&pass=${pass}&data=${pairs.join("|")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = new TextDecoder("latin1").decode(await res.arrayBuffer());
    const parts = text.trim().split("|");
    if (!res.ok || parts[0] === "ERROR") throw new Error(`Nacex ${method}: ${parts[1] ?? text}`.slice(0, 280));
    return parts;
  };

  return {
    provider: "nacex",
    mode: "live",
    async book(input) {
      const parts = await call("putExpedicion", {
        del_cli: config.agency ?? "",
        num_cli: config.client ?? "",
        tip_ser: config.service || "26",
        tip_cob: "O",
        tip_env: "2",
        ref_cli: input.reference.slice(0, 20),
        bul: String(input.packages).padStart(3, "0"),
        kil: input.weightKg.toFixed(3).padStart(9, "0"),
        nom_rec: input.sender.name.slice(0, 35),
        dir_rec: input.sender.line1.slice(0, 45),
        cp_rec: input.sender.postalCode,
        pob_rec: input.sender.city.slice(0, 30),
        pais_rec: input.sender.country,
        tel_rec: input.sender.phone ?? "",
        nom_ent: input.recipient.name.slice(0, 35),
        dir_ent: input.recipient.line1.slice(0, 45),
        cp_ent: input.recipient.postalCode,
        pob_ent: input.recipient.city.slice(0, 30),
        pais_ent: input.recipient.country,
        tel_ent: input.recipient.phone ?? "",
        obs1: (input.notes ?? "").slice(0, 38),
      });
      // Resposta: código_expedição|agência/albarán|...
      return { carrierRef: parts[0], trackingNumber: parts[1] || parts[0] };
    },
    async track(ref) {
      const parts = await call("getEstadoExpedicion", { expe_codigo: ref.carrierRef ?? ref.trackingNumber });
      const description = parts.filter(Boolean).slice(1, 5).join(" · ") || parts.join(" ");
      const raw = parts.join(" ").toUpperCase();
      const status: CarrierStatus = /ENTREGAD|DELIVERED/.test(raw)
        ? "delivered"
        : /REPARTO|DISTRIBU/.test(raw)
          ? "out_for_delivery"
          : /INCIDENCIA|DEVUEL|ANOMAL/.test(raw)
            ? "exception"
            : "in_transit";
      return [{ code: parts[0] ?? "STATUS", status, description, occurredAt: new Date() }];
    },
    async cancel(ref) {
      await call("cancelExpedicion", { expe_codigo: ref.carrierRef ?? ref.trackingNumber });
    },
  };
}

export function createCarrierAdapter(conn: {
  provider: string;
  mode: string;
  credentials: Record<string, string>;
  config: Record<string, string>;
}): CarrierAdapter {
  const provider = conn.provider as CarrierProvider;
  if (conn.mode !== "live") return createSandboxAdapter(provider);
  if (provider === "nacex") return createNacexAdapter(conn.credentials, conn.config);
  throw new Error(
    `${PROVIDER_LABELS[provider]}: a integração "live" exige a especificação e credenciais do contrato com o operador. ` +
      `Use o modo sandbox ou envie eventos de tracking para POST /api/v1/carrier-events.`,
  );
}
