import { createCipheriv, createPrivateKey, createSign, publicEncrypt, randomBytes, constants, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { env } from "../env.js";

/**
 * Comunicação de documentos de transporte à AT (DL 198/2012) via webservice
 * SOAP `sgdtws/documentosTransporte`.
 *
 *  - Ligação TLS mútua com o certificado do produtor de software (assinado pela AT).
 *  - Autenticação WS-Security: palavra-passe e data cifradas em AES-128-ECB com
 *    uma chave simétrica aleatória (Ks); Ks cifrada com a chave pública da AT (Nonce).
 *  - Ambiente de testes: porta 701; produção: porta 401.
 *
 * Em AT_MODE=mock (omissão) a resposta é simulada, mas o pedido é construído e
 * validado da mesma forma.
 */

export interface AtAddress {
  detail: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface StockMovement {
  taxId: string;
  companyName: string;
  companyAddress: AtAddress;
  documentNumber: string;
  atcud: string;
  movementDate: string; // YYYY-MM-DD
  movementType: "GT" | "GR";
  customerTaxId: string;
  customerName: string;
  customerAddress: AtAddress;
  addressTo: AtAddress;
  addressFrom: AtAddress;
  movementStartTime: Date;
  vehicleId?: string | null;
  lines: { description: string; quantity: number; unit: string; unitPrice: number }[];
}

export type AtResult =
  | { ok: true; atDocCode: string; message: string }
  | { ok: false; code: string; message: string };

export interface AtClient {
  mode: "mock" | "live";
  communicate(
    environment: "test" | "production",
    creds: { username: string; password: string },
    doc: StockMovement,
  ): Promise<AtResult>;
  /** Comunicação dos elementos de faturação (webservice fews/faturas). */
  communicateInvoice(
    environment: "test" | "production",
    creds: { username: string; password: string },
    doc: AtInvoice,
  ): Promise<AtResult>;
}

export const AT_ENDPOINTS = {
  test: { host: "servicos.portaldasfinancas.gov.pt", port: 701 },
  production: { host: "servicos.portaldasfinancas.gov.pt", port: 401 },
} as const;
const AT_PATH = "/sgdtws/documentosTransporte";
const AT_NS = "https://servicos.portaldasfinancas.gov.pt/sgdtws/documentosTransporte/";

/** NIF para clientes sem identificação fiscal ("consumidor final"). */
export const FINAL_CONSUMER_NIF = "999999990";

const xml = (v: string | number) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Data/hora local de Lisboa no formato AT/SAF-T (sem fuso): YYYY-MM-DDTHH:mm:ss */
export function lisbonDateTime(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Valida os campos obrigatórios/formatos antes do envio. Devolve lista de erros. */
export function validateStockMovement(doc: StockMovement): string[] {
  const errors: string[] = [];
  if (!/^\d{9}$/.test(doc.taxId)) errors.push("NIF do emitente inválido (definir em Definições → Dados fiscais)");
  const checkAddr = (label: string, a: AtAddress) => {
    if (!a.detail || !a.city || !a.postalCode || !a.country) errors.push(`Morada incompleta: ${label}`);
    if (a.country === "PT" && !/^\d{4}-\d{3}$/.test(a.postalCode)) {
      errors.push(`Código postal inválido (${label}): formato NNNN-NNN`);
    }
  };
  checkAddr("emitente", doc.companyAddress);
  checkAddr("cliente", doc.customerAddress);
  checkAddr("carga", doc.addressFrom);
  checkAddr("descarga", doc.addressTo);
  if (doc.lines.length === 0) errors.push("O documento precisa de pelo menos uma linha de mercadoria");
  return errors;
}

const addrXml = (tag: string, a: AtAddress) =>
  `<${tag}><Addressdetail>${xml(a.detail.slice(0, 100))}</Addressdetail><City>${xml(a.city.slice(0, 50))}</City><PostalCode>${xml(a.postalCode)}</PostalCode><Country>${xml(a.country)}</Country></${tag}>`;

/** Corpo SOAP — a ordem dos elementos segue o XSD (StockMovement). */
export function buildStockMovementXml(doc: StockMovement): string {
  return [
    `<ns2:envioDocumentoTransporteRequestElem xmlns:ns2="${AT_NS}">`,
    `<TaxRegistrationNumber>${xml(doc.taxId)}</TaxRegistrationNumber>`,
    `<CompanyName>${xml(doc.companyName.slice(0, 100))}</CompanyName>`,
    addrXml("CompanyAddress", doc.companyAddress),
    `<DocumentNumber>${xml(doc.documentNumber)}</DocumentNumber>`,
    `<ATCUD>${xml(doc.atcud)}</ATCUD>`,
    `<MovementStatus>N</MovementStatus>`,
    `<MovementDate>${doc.movementDate}</MovementDate>`,
    `<MovementType>${doc.movementType}</MovementType>`,
    `<CustomerTaxID>${xml(doc.customerTaxId)}</CustomerTaxID>`,
    addrXml("CustomerAddress", doc.customerAddress),
    `<CustomerName>${xml(doc.customerName.slice(0, 100))}</CustomerName>`,
    addrXml("AddressTo", doc.addressTo),
    addrXml("AddressFrom", doc.addressFrom),
    `<MovementStartTime>${lisbonDateTime(doc.movementStartTime)}</MovementStartTime>`,
    doc.vehicleId ? `<VehicleID>${xml(doc.vehicleId)}</VehicleID>` : "",
    ...doc.lines.map(
      (l) =>
        `<Line><ProductDescription>${xml(l.description.slice(0, 200))}</ProductDescription><Quantity>${l.quantity}</Quantity><UnitOfMeasure>${xml(l.unit)}</UnitOfMeasure><UnitPrice>${l.unitPrice.toFixed(2)}</UnitPrice></Line>`,
    ),
    `</ns2:envioDocumentoTransporteRequestElem>`,
  ].join("");
}

const aesEcb = (data: string, key: Buffer) => {
  const c = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([c.update(data, "utf8"), c.final()]).toString("base64");
};

/** Envelope SOAP com cabeçalho WS-Security no formato exigido pela AT. */
export function buildEnvelope(
  body: string,
  creds: { username: string; password: string },
  atPublicKeyPem: string | Buffer,
  now = new Date(),
): string {
  const ks = randomBytes(16);
  const publicKey = new X509Certificate(atPublicKeyPem).publicKey;
  const nonce = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, ks).toString("base64");
  const created = now.toISOString().replace(/\.\d{3}Z$/, ".00Z");
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">`,
    `<S:Header><wss:Security xmlns:wss="http://schemas.xmlsoap.org/ws/2002/12/secext"><wss:UsernameToken>`,
    `<wss:Username>${xml(creds.username)}</wss:Username>`,
    `<wss:Password>${aesEcb(creds.password, ks)}</wss:Password>`,
    `<wss:Nonce>${nonce}</wss:Nonce>`,
    `<wss:Created>${aesEcb(created, ks)}</wss:Created>`,
    `</wss:UsernameToken></wss:Security></S:Header>`,
    `<S:Body>${body}</S:Body></S:Envelope>`,
  ].join("");
}

const tag = (src: string, name: string) =>
  src.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;

export function parseAtResponse(body: string): AtResult {
  const fault = tag(body, "faultstring");
  if (fault) return { ok: false, code: "FAULT", message: fault.slice(0, 480) };
  const code = tag(body, "ReturnCode");
  const message = tag(body, "ReturnMessage") ?? "";
  const docCode = tag(body, "ATDocCodeID");
  if (code === "0" && docCode) return { ok: true, atDocCode: docCode, message };
  return { ok: false, code: code ?? "UNKNOWN", message: (message || body).slice(0, 480) };
}

function createLiveAtClient(): AtClient {
  if (!env.AT_PUBLIC_KEY_PATH || !env.AT_CLIENT_PFX_PATH) {
    throw new Error("AT_MODE=live exige AT_PUBLIC_KEY_PATH e AT_CLIENT_PFX_PATH");
  }
  const atPublicKey = readFileSync(env.AT_PUBLIC_KEY_PATH);
  const pfx = readFileSync(env.AT_CLIENT_PFX_PATH);
  const post = (
    environment: "test" | "production",
    creds: { username: string; password: string },
    body: string,
    endpoint: { host: string; port: number; path: string; ns: string; parse: (b: string) => AtResult },
  ): Promise<AtResult> => {
    const payload = buildEnvelope(body, creds, atPublicKey);
    return new Promise<AtResult>((resolve) => {
      const req = request(
        {
          host: endpoint.host,
          port: endpoint.port,
          path: endpoint.path,
          method: "POST",
          pfx,
          passphrase: env.AT_CLIENT_PFX_PASSPHRASE,
          timeout: 15_000,
          headers: {
            "content-type": "text/xml; charset=utf-8",
            soapaction: endpoint.ns,
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(endpoint.parse(Buffer.concat(chunks).toString("utf8"))));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout na ligação à AT")));
      req.on("error", (err) => resolve({ ok: false, code: "NETWORK", message: err.message }));
      req.end(payload);
    });
  };

  return {
    mode: "live",
    communicate(environment, creds, doc) {
      const errors = validateStockMovement(doc);
      if (errors.length) return Promise.resolve({ ok: false, code: "VALIDATION", message: errors.join("; ") });
      const { host, port } = AT_ENDPOINTS[environment];
      return post(environment, creds, buildStockMovementXml(doc), {
        host,
        port,
        path: AT_PATH,
        ns: AT_NS,
        parse: parseAtResponse,
      });
    },
    communicateInvoice(environment, creds, doc) {
      const errors = validateInvoice(doc);
      if (errors.length) return Promise.resolve({ ok: false, code: "VALIDATION", message: errors.join("; ") });
      const override = invoiceEndpoint();
      const { host, port } = override ?? AT_INVOICES[environment];
      return post(environment, creds, buildInvoiceXml(doc), {
        host,
        port,
        path: override?.path ?? AT_INVOICES_PATH,
        ns: AT_INVOICES_NS,
        parse: parseInvoiceResponse,
      });
    },
  };
}

/** Cliente simulado: valida o pedido e devolve um código AT fictício. */
export function createMockAtClient(): AtClient {
  return {
    mode: "mock",
    async communicate(_environment, _creds, doc) {
      const errors = validateStockMovement(doc);
      if (errors.length) return { ok: false, code: "VALIDATION", message: errors.join("; ") };
      buildStockMovementXml(doc);
      return {
        ok: true,
        atDocCode: String(100_000_000 + Math.floor(Math.random() * 899_999_999)),
        message: "OK (simulado — AT_MODE=mock)",
      };
    },
    async communicateInvoice(_environment, _creds, doc) {
      const errors = validateInvoice(doc);
      if (errors.length) return { ok: false, code: "VALIDATION", message: errors.join("; ") };
      buildInvoiceXml(doc);
      return { ok: true, atDocCode: doc.atcud, message: "Fatura registada (simulado — AT_MODE=mock)" };
    },
  };
}

export function createAtClient(): AtClient {
  return env.AT_MODE === "live" ? createLiveAtClient() : createMockAtClient();
}

// ── Assinatura (Portaria 363/2010) ──────────────────────────────────────────

let signingKey: ReturnType<typeof createPrivateKey> | null | undefined;
const loadSigningKey = () =>
  signingKey !== undefined
    ? signingKey
    : (signingKey = env.AT_SIGNING_KEY_PATH ? createPrivateKey(readFileSync(env.AT_SIGNING_KEY_PATH)) : null);

export const signingConfigured = () => !!loadSigningKey();

/**
 * Hash RSA-SHA1 encadeado: "Data;DataHoraSistema;NºDocumento;Total;HashAnterior".
 * Documentos de transporte não têm total — usa-se 0.00. Faturas usam o total
 * com IVA (`grossTotal`).
 * Sem chave configurada devolve null (documento marcado como não certificado).
 */
export function signDocument(input: {
  movementDate: string;
  systemEntryDate: Date;
  documentNumber: string;
  previousHash: string | null;
  /** Total bruto (faturas); "0.00" para documentos de transporte */
  grossTotal?: string;
}): { hash: string; hashControl: string } | null {
  const key = loadSigningKey();
  if (!key) return null;
  const message = [
    input.movementDate,
    lisbonDateTime(input.systemEntryDate),
    input.documentNumber,
    input.grossTotal ?? "0.00",
    input.previousHash ?? "",
  ].join(";");
  const hash = createSign("RSA-SHA1").update(message, "utf8").sign(key, "base64");
  return { hash, hashControl: env.AT_SIGNING_KEY_VERSION };
}

/** 4 caracteres de controlo do hash (posições 1, 11, 21, 31) impressos no documento. */
export const hashChars = (hash: string | null) =>
  hash ? [0, 10, 20, 30].map((i) => hash[i] ?? "").join("") : "0";

/** Conteúdo do código QR (Portaria 195/2020) — transporte e faturas. */
export function buildAtQr(input: {
  issuerTaxId: string;
  customerTaxId: string;
  customerCountry: string;
  docType: string;
  date: string; // YYYY-MM-DD
  documentNumber: string;
  atcud: string;
  hash: string | null;
  /** Base tributável PT-continente (I1), total de IVA (N) e total bruto (O) */
  taxableBase?: string;
  taxAmount?: string;
  grossTotal?: string;
}): string {
  return [
    `A:${input.issuerTaxId}`,
    `B:${input.customerTaxId}`,
    `C:${input.customerCountry}`,
    `D:${input.docType}`,
    "E:N",
    `F:${input.date.replace(/-/g, "")}`,
    `G:${input.documentNumber}`,
    `H:${input.atcud}`,
    `I1:${input.taxableBase ?? "0"}`,
    `N:${input.taxAmount ?? "0.00"}`,
    `O:${input.grossTotal ?? "0.00"}`,
    `Q:${hashChars(input.hash)}`,
    `R:${env.AT_SOFTWARE_CERT_NUMBER}`,
  ].join("*");
}

// ── Faturas (comunicação de elementos à AT — webservice fews/faturas) ────────

export interface InvoiceLineTax {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Taxa de IVA em % */
  taxRate: number;
  /** Valor do IVA da linha */
  taxAmount: number;
  lineTotal: number;
}

export interface AtInvoice {
  taxId: string;
  companyName: string;
  companyAddress: AtAddress;
  documentNumber: string; // ex.: "FT-00012" (série FT, seq 12)
  atcud: string;
  invoiceDate: string; // YYYY-MM-DD
  customerTaxId: string;
  customerName: string;
  customerAddress: AtAddress;
  customerCountry: string;
  lines: InvoiceLineTax[];
  taxPayable: number;
  netTotal: number;
  grossTotal: number;
}

/** Endpoint do serviço de faturas — sobreponível via AT_INVOICES_URL. */
const AT_INVOICES = {
  test: { host: "servicos.portaldasfinancas.gov.pt", port: 701 },
  production: { host: "servicos.portaldasfinancas.gov.pt", port: 700 },
} as const;
const AT_INVOICES_PATH = "/fews/faturas";
const AT_INVOICES_NS = "https://servicos.portaldasfinancas.gov.pt/fews/faturas/";

/** Endpoint alternativo para faturas via `AT_INVOICES_URL` (proxy/testes). */
function invoiceEndpoint() {
  if (!env.AT_INVOICES_URL) return null;
  try {
    const u = new URL(env.AT_INVOICES_URL);
    return {
      host: u.hostname,
      port: Number(u.port) || 443,
      path: u.pathname || AT_INVOICES_PATH,
    };
  } catch {
    return null;
  }
}

/** Código de imposto por taxa (IVA continental). */
const taxCode = (rate: number) =>
  rate === 0 ? "ISE" : rate <= 6 ? "RED" : rate <= 13 ? "INT" : "NOR";

export function validateInvoice(doc: AtInvoice): string[] {
  const errors: string[] = [];
  if (!/^\d{9}$/.test(doc.taxId)) {
    errors.push("NIF do emitente inválido (definir em Definições → Dados fiscais)");
  }
  if (!doc.lines.length) errors.push("A fatura precisa de pelo menos uma linha");
  if (doc.grossTotal <= 0) errors.push("Total da fatura tem de ser positivo");
  return errors;
}

/** Corpo SOAP do registo de fatura (elementos essenciais do InvoiceType). */
export function buildInvoiceXml(doc: AtInvoice): string {
  const line = (l: InvoiceLineTax) =>
    `<Line><DebitAmount>${l.lineTotal.toFixed(2)}</DebitAmount><Tax><TaxType>IVA</TaxType><TaxCountryRegion>PT</TaxCountryRegion><TaxCode>${taxCode(l.taxRate)}</TaxCode><TaxPercentage>${l.taxRate}</TaxPercentage></Tax></Line>`;
  return [
    `<ns2:envioFaturasRequestElem xmlns:ns2="${AT_INVOICES_NS}">`,
    `<TaxRegistrationNumber>${xml(doc.taxId)}</TaxRegistrationNumber>`,
    `<CompanyName>${xml(doc.companyName.slice(0, 100))}</CompanyName>`,
    addrXml("CompanyAddress", doc.companyAddress),
    `<InvoiceNo>${xml(doc.documentNumber)}</InvoiceNo>`,
    `<ATCUD>${xml(doc.atcud)}</ATCUD>`,
    `<InvoiceDate>${doc.invoiceDate}</InvoiceDate>`,
    `<InvoiceType>FT</InvoiceType>`,
    `<InvoiceStatus>N</InvoiceStatus>`,
    `<CustomerTaxID>${xml(doc.customerTaxId)}</CustomerTaxID>`,
    `<CustomerName>${xml(doc.customerName.slice(0, 100))}</CustomerName>`,
    addrXml("CustomerAddress", doc.customerAddress),
    ...doc.lines.map(line),
    `<DocumentTotals><TaxPayable>${doc.taxPayable.toFixed(2)}</TaxPayable><NetTotal>${doc.netTotal.toFixed(2)}</NetTotal><GrossTotal>${doc.grossTotal.toFixed(2)}</GrossTotal></DocumentTotals>`,
    `</ns2:envioFaturasRequestElem>`,
  ].join("");
}

export function parseInvoiceResponse(body: string): AtResult {
  const fault = tag(body, "faultstring");
  if (fault) return { ok: false, code: "FAULT", message: fault.slice(0, 480) };
  const code = tag(body, "ReturnCode");
  const message = tag(body, "ReturnMessage") ?? "";
  const docRef = tag(body, "ATCUD") ?? tag(body, "DocumentNumber") ?? "";
  if (code === "0") return { ok: true, atDocCode: docRef || "registada", message };
  return { ok: false, code: code ?? "UNKNOWN", message: (message || body).slice(0, 480) };
}
