import type { InboundOrderInput } from "@transitum/shared";
import { badRequest } from "./errors.js";

/**
 * Parser mínimo de EDIFACT ORDERS (subset D.96A) para intake de encomendas.
 *
 * Extrai:
 *  - UNB: remetente (intercâmbio) → prefixo do externalRef
 *  - BGM+220: número da encomenda → externalRef
 *  - DTM+2:…:203 → data pedida
 *  - NAD+BY → cliente (nome/GLN), NAD+DP → morada de entrega
 *  - LIN+QTY+PRI/IMD → linhas (SKU, quantidade, preço, descrição)
 *
 * Sintaxe EDIFACT: segmentos terminados por `'`, elementos por `+`,
 * componentes por `:`, release `?` (escapa o carácter seguinte).
 */

interface Seg {
  tag: string;
  /** Elementos separados por '+', cada um com componentes separadas por ':' */
  el: string[][];
}

const unescape = (v: string) => v.replace(/\?(.)/g, "$1");

function parseSegments(raw: string): Seg[] {
  // UNA service string (UNA:+.? ') é opcional — descarta-a
  const body = raw.replace(/^UNA.{6}/s, "");
  return body
    .split(/(?<!\?)'/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const els = s.split(/(?<!\?)\+/).map((e) => e.split(/(?<!\?)\:/).map(unescape));
      return { tag: els[0][0]?.toUpperCase() ?? "", el: els.slice(1) };
    })
    .filter((s) => s.tag.length === 3);
}

const comp = (seg: Seg, e: number, c = 0) => seg.el[e]?.[c]?.trim() || "";

/** Elemento de texto livre do NAD: junta os componentes de nome/morada. */
const partyName = (seg: Seg) =>
  [comp(seg, 3, 0), comp(seg, 3, 1)].filter(Boolean).join(" ") || comp(seg, 1, 0) || comp(seg, 2, 0);

const ymd = (v: string) =>
  v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.length === 6 ? `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}` : undefined;

/**
 * Converte uma mensagem ORDERS EDIFACT (texto do ficheiro) para o formato
 * interno de intake. Lança badRequest quando não há cabeçalho nem linhas.
 */
export function parseEdifactOrders(raw: string): InboundOrderInput {
  const segs = parseSegments(raw);
  if (!segs.some((s) => s.tag === "UNH")) {
    throw badRequest("Mensagem EDIFACT inválida — falta UNH");
  }
  const unb = segs.find((s) => s.tag === "UNB");
  const bgm = segs.find((s) => s.tag === "BGM");
  const docNumber = comp(bgm ?? ({} as Seg), 1, 0) || comp(bgm ?? ({} as Seg), 1, 1);
  if (!docNumber) throw badRequest("ORDERS sem número de documento (BGM)");
  const sender = comp(unb ?? ({} as Seg), 1, 0) || "edi";

  const by = segs.find((s) => s.tag === "NAD" && comp(s, 0) === "BY");
  const dp = segs.find((s) => s.tag === "NAD" && comp(s, 0) === "DP");
  const dtm = segs.find((s) => s.tag === "DTM" && ["2", "64", "63"].includes(comp(s, 0, 0)));

  // Linhas: LIN inicia um grupo; QTY/PRI/IMD seguintes pertencem a essa linha
  interface LineAcc {
    sku?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
  }
  const lines: LineAcc[] = [];
  let cur: LineAcc | null = null;
  for (const s of segs) {
    if (s.tag === "LIN") {
      cur = { sku: comp(s, 2, 0) || undefined };
      lines.push(cur);
    } else if (!cur) {
      continue;
    } else if (s.tag === "QTY") {
      const q = Number(comp(s, 0, 1));
      if (Number.isFinite(q) && q > 0) cur.quantity = Math.round(q);
    } else if (s.tag === "PRI") {
      const p = Number(comp(s, 0, 1));
      if (Number.isFinite(p) && p >= 0) cur.unitPrice = p;
    } else if (s.tag === "IMD") {
      cur.description = cur.description ?? (comp(s, 2, 3) || comp(s, 2, 0) || undefined);
    }
  }
  const mapped = lines
    .filter((l) => l.sku || l.description || l.quantity)
    .map((l) => ({
      sku: l.sku,
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice,
    }))
    .filter((l) => l.sku || l.description);
  if (!mapped.length) throw badRequest("ORDERS sem linhas (LIN)");

  return {
    externalRef: `edifact:${sender}:${docNumber}`.slice(0, 80),
    customer: { name: (partyName(by ?? ({} as Seg)) || `Cliente EDI ${sender}`).slice(0, 160) },
    requestedDate: dtm ? ymd(comp(dtm, 0, 1)) : undefined,
    deliveryLine1: dp ? [comp(dp, 4, 0), comp(dp, 4, 1)].filter(Boolean).join(" ") || undefined : undefined,
    deliveryCity: dp ? comp(dp, 5, 0) || undefined : undefined,
    deliveryPostalCode: dp ? comp(dp, 7, 0) || undefined : undefined,
    deliveryCountry: dp ? comp(dp, 8, 0) || undefined : undefined,
    lines: mapped,
  };
}
