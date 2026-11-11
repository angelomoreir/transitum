import PDFDocument from "pdfkit";
import bwipjs from "bwip-js/node";

/**
 * Geração de PDFs operacionais: guia de transporte/remessa (com ATCUD e QR AT),
 * declaração de expedição CMR e etiquetas de volume 100×150 mm (Code 128 + QR).
 * Usa as fontes standard do PDF (Helvetica, WinAnsi — cobre o português).
 */

type Doc = InstanceType<typeof PDFDocument>;

export interface PartyInfo {
  name: string;
  taxId: string | null;
  line1: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ShippingDocData {
  issuer: PartyInfo;
  customer: PartyInfo;
  carrierName: string | null;
  shipment: {
    number: string;
    pickup: { line1: string; city: string; postalCode: string; country: string };
    delivery: { line1: string; city: string; postalCode: string; country: string };
    plannedPickupAt: Date | null;
    totalWeightKg: number | null;
    packages: number | null;
    incoterm: string | null;
    notes: string | null;
    recipientName: string | null;
    trackingNumber: string | null;
    orderNumber: string | null;
  };
  lines: { description: string; sku: string | null; quantity: number; unit: string; weightKg: number | null }[];
  trackingUrl: string | null;
}

export interface TransportDocInfo {
  docType: "GT" | "GR";
  number: string;
  atcud: string;
  movementStartAt: Date;
  vehicleRef: string | null;
  atDocCode: string | null;
  hashChars: string;
  signed: boolean;
  qr: string;
  softwareCert: string;
  environment: string | null;
}

export function renderPdf(
  build: (doc: Doc) => void | Promise<void>,
  opts: ConstructorParameters<typeof PDFDocument>[0] = { size: "A4", margin: 40 },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...opts, info: { Producer: "Transitum", Creator: "Transitum" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Promise.resolve(build(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

export const barcodePng = (text: string, bcid: "code128" | "qrcode", opts: { height?: number; scale?: number } = {}) =>
  bwipjs.toBuffer({
    bcid,
    text,
    scale: opts.scale ?? 3,
    ...(bcid === "code128" ? { height: opts.height ?? 12, includetext: false } : { eclevel: "M" }),
  });

const fmtDateTime = (d: Date | null) =>
  d ? d.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short", timeStyle: "short" }) : "—";

const partyLines = (p: PartyInfo) =>
  [
    p.name,
    p.line1,
    [p.postalCode, p.city].filter(Boolean).join(" "),
    p.country,
    p.taxId ? `NIF: ${p.taxId}` : null,
  ].filter((v): v is string => !!v);

function box(doc: Doc, x: number, y: number, w: number, h: number, title: string, body: string[]) {
  doc.rect(x, y, w, h).lineWidth(0.6).stroke("#555");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#444").text(title, x + 5, y + 4, { width: w - 10 });
  doc.font("Helvetica").fontSize(9).fillColor("#000").text(body.join("\n"), x + 5, y + 15, {
    width: w - 10,
    height: h - 18,
    ellipsis: true,
  });
}

function linesTable(doc: Doc, data: ShippingDocData, y: number) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = [
    { label: "#", w: 22 },
    { label: "Artigo", w: 80 },
    { label: "Descrição", w: w - 22 - 80 - 55 - 40 - 60 },
    { label: "Qtd", w: 55, align: "right" as const },
    { label: "Un.", w: 40 },
    { label: "Peso kg", w: 60, align: "right" as const },
  ];
  const row = (cells: string[], yy: number, bold = false) => {
    let cx = x;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    cells.forEach((c, i) => {
      doc.text(c, cx + 3, yy + 4, { width: cols[i].w - 6, align: cols[i].align ?? "left", lineBreak: false, ellipsis: true });
      cx += cols[i].w;
    });
  };
  doc.rect(x, y, w, 18).fill("#eef2f7").fillColor("#000");
  row(cols.map((c) => c.label), y, true);
  y += 18;
  data.lines.forEach((l, i) => {
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    row([String(i + 1), l.sku ?? "", l.description, String(l.quantity), l.unit, l.weightKg != null ? l.weightKg.toFixed(2) : ""], y);
    y += 16;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.3).stroke("#ccc");
  });
  const totalQty = data.lines.reduce((a, l) => a + l.quantity, 0);
  const totalWeight = data.shipment.totalWeightKg ?? data.lines.reduce((a, l) => a + (l.weightKg ?? 0), 0);
  row(["", "", "Total", String(totalQty), "", totalWeight ? totalWeight.toFixed(2) : ""], y + 2, true);
  return y + 24;
}

const DOC_TITLES = { GT: "GUIA DE TRANSPORTE", GR: "GUIA DE REMESSA" } as const;

/** Guia de transporte / remessa (RBC — DL 147/2003), com ATCUD, código AT e QR. */
export function transportDocPdf(data: ShippingDocData, td: TransportDocInfo): Promise<Buffer> {
  return renderPdf(async (doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const half = (width - 10) / 2;

    doc.font("Helvetica-Bold").fontSize(15).text(data.issuer.name, left, 40, { width: half });
    doc.font("Helvetica").fontSize(8.5).text(partyLines({ ...data.issuer, name: "" }).join("\n"), left, 60, { width: half });

    doc.font("Helvetica-Bold").fontSize(13).text(DOC_TITLES[td.docType], left + half + 10, 40, { width: half, align: "right" });
    doc.font("Helvetica").fontSize(10).text(td.number, left + half + 10, 58, { width: half, align: "right" });
    doc.fontSize(8.5).text(`ATCUD: ${td.atcud}`, left + half + 10, 72, { width: half, align: "right" });
    doc.text(`Original`, left + half + 10, 84, { width: half, align: "right" });

    const y0 = 115;
    box(doc, left, y0, half, 78, "DESTINATÁRIO / ADQUIRENTE", partyLines(data.customer));
    box(doc, left + half + 10, y0, half, 78, "TRANSPORTE", [
      `Início: ${fmtDateTime(td.movementStartAt)}`,
      `Viatura: ${td.vehicleRef ?? "—"}`,
      `Transportador: ${data.carrierName ?? data.issuer.name}`,
      `Código AT: ${td.atDocCode ?? "não comunicado"}`,
      `Expedição: ${data.shipment.number}${data.shipment.orderNumber ? ` · Enc. ${data.shipment.orderNumber}` : ""}`,
    ]);
    const p = data.shipment.pickup;
    const d = data.shipment.delivery;
    box(doc, left, y0 + 88, half, 58, "LOCAL DE CARGA", [p.line1, `${p.postalCode} ${p.city}`, p.country]);
    box(doc, left + half + 10, y0 + 88, half, 58, "LOCAL DE DESCARGA", [d.line1, `${d.postalCode} ${d.city}`, d.country]);

    let y = linesTable(doc, data, y0 + 160);

    if (data.shipment.notes) {
      doc.font("Helvetica-Bold").fontSize(8).text("Observações", left, y);
      doc.font("Helvetica").fontSize(8.5).text(data.shipment.notes, left, y + 11, { width });
      y = doc.y + 10;
    }

    // Rodapé fiscal: QR + hash + certificado
    const footerY = doc.page.height - 130;
    const qr = await barcodePng(td.qr, "qrcode", { scale: 2 });
    doc.image(qr, left, footerY, { width: 80 });
    doc.font("Helvetica").fontSize(7.5).fillColor("#333");
    const legal = td.signed
      ? `${td.hashChars}-Processado por programa certificado n.º ${td.softwareCert}/AT`
      : "Documento não assinado — software sem chave de certificação configurada (apenas para testes).";
    doc.text(
      [
        legal,
        `Bens colocados à disposição do adquirente na data e hora de início do transporte.`,
        td.environment === "test" ? "Comunicado ao ambiente de TESTES da AT." : "",
      ]
        .filter(Boolean)
        .join("\n"),
      left + 92,
      footerY + 8,
      { width: width - 92 },
    );
    doc.fillColor("#000");
  });
}

/** Declaração de expedição internacional CMR (Convenção CMR, casas 1–24 essenciais). */
export function cmrPdf(data: ShippingDocData): Promise<Buffer> {
  return renderPdf((doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const half = (width - 8) / 2;
    const s = data.shipment;
    doc.font("Helvetica-Bold").fontSize(16).text("CMR", left, 36);
    doc.font("Helvetica").fontSize(8).text(
      "Declaração de expedição internacional — Lettre de voiture internationale — International consignment note",
      left + 50,
      40,
      { width: width - 50 },
    );
    doc.font("Helvetica-Bold").fontSize(10).text(`N.º ${s.number}`, left, 60, { width, align: "right" });

    let y = 78;
    const H = 66;
    box(doc, left, y, half, H, "1 · EXPEDIDOR (nome, morada, país)", partyLines(data.issuer));
    box(doc, left + half + 8, y, half, H, "16 · TRANSPORTADOR", [data.carrierName ?? "—"]);
    y += H + 6;
    box(doc, left, y, half, H, "2 · DESTINATÁRIO", partyLines(data.customer));
    box(doc, left + half + 8, y, half, H, "17 · TRANSPORTADORES SUCESSIVOS", [""]);
    y += H + 6;
    box(doc, left, y, half, 50, "3 · LOCAL DE ENTREGA DA MERCADORIA", [
      s.delivery.line1,
      `${s.delivery.postalCode} ${s.delivery.city}, ${s.delivery.country}`,
    ]);
    box(doc, left + half + 8, y, half, 50, "18 · RESERVAS E OBSERVAÇÕES DO TRANSPORTADOR", [""]);
    y += 56;
    box(doc, left, y, half, 50, "4 · LOCAL E DATA DO CARREGAMENTO", [
      `${s.pickup.line1}, ${s.pickup.postalCode} ${s.pickup.city}, ${s.pickup.country}`,
      fmtDateTime(s.plannedPickupAt),
    ]);
    box(doc, left + half + 8, y, half, 50, "5 · DOCUMENTOS ANEXOS", [
      s.orderNumber ? `Encomenda ${s.orderNumber}` : "—",
      s.incoterm ? `Incoterm: ${s.incoterm}` : "",
    ]);
    y += 58;

    doc.font("Helvetica-Bold").fontSize(7).text("6–12 · MARCAS · N.º VOLUMES · EMBALAGEM · NATUREZA DA MERCADORIA · PESO BRUTO", left, y);
    y = linesTable(doc, data, y + 10);
    doc.font("Helvetica").fontSize(9).text(`Volumes: ${s.packages ?? "—"}    Peso bruto total: ${s.totalWeightKg ?? "—"} kg`, left, y);
    y += 18;

    box(doc, left, y, width, 40, "13 · INSTRUÇÕES DO EXPEDIDOR", [s.notes ?? ""]);
    y += 48;
    const third = (width - 16) / 3;
    box(doc, left, y, third, 70, "22 · ASSINATURA E CARIMBO DO EXPEDIDOR", ["", "", `Estabelecido em ${s.pickup.city}`, fmtDateTime(new Date())]);
    box(doc, left + third + 8, y, third, 70, "23 · ASSINATURA E CARIMBO DO TRANSPORTADOR", [""]);
    box(doc, left + 2 * (third + 8), y, third, 70, "24 · MERCADORIA RECEBIDA (DESTINATÁRIO)", [s.recipientName ?? ""]);
  });
}

export interface PickListPdfData {
  issuer: PartyInfo;
  orderNumber: string;
  customerName: string;
  warehouseName: string | null;
  requestedDate: string | null;
  delivery: PartyInfo | null;
  lines: {
    sku: string | null;
    itemName: string;
    toPick: number;
    available: number | null;
    unit: string | null;
    /** Localização preferencial (zona-código); null quando não atribuída */
    location?: string | null;
  }[];
}

/** Guia de picking A4: artigos por expedir com stock disponível no armazém. */
export function pickListPdf(data: PickListPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const half = (width - 10) / 2;

    doc.font("Helvetica-Bold").fontSize(15).text(data.issuer.name, left, 40, { width: half });
    doc.font("Helvetica-Bold").fontSize(13).text("GUIA DE PICKING", left + half + 10, 40, { width: half, align: "right" });
    doc.font("Helvetica").fontSize(10).text(`Encomenda ${data.orderNumber}`, left + half + 10, 58, { width: half, align: "right" });
    doc.fontSize(8.5).text(`Emitida em ${fmtDateTime(new Date())}`, left + half + 10, 72, { width: half, align: "right" });

    const y0 = 105;
    box(doc, left, y0, half, 58, "CLIENTE", [data.customerName]);
    box(doc, left + half + 10, y0, half, 58, "ARMAZÉM · DATA PEDIDA", [
      data.warehouseName ?? "—",
      data.requestedDate ? `Pedida: ${new Date(`${data.requestedDate}T00:00:00`).toLocaleDateString("pt-PT")}` : "",
    ]);
    if (data.delivery) {
      box(doc, left, y0 + 66, width, 50, "DESTINO", partyLines(data.delivery));
    }
    let y = y0 + (data.delivery ? 126 : 74);

    const cols = [
      { label: "Local.", w: 62 },
      { label: "SKU", w: 90 },
      { label: "Artigo", w: width - 62 - 90 - 70 - 75 - 60 },
      { label: "A separar", w: 70, align: "right" as const },
      { label: "Disponível", w: 75, align: "right" as const },
      { label: "Apanhado", w: 60 },
    ];
    const row = (cells: string[], yy: number, bold = false) => {
      let cx = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      cells.forEach((c, i) => {
        doc.text(c, cx + 3, yy + 4, { width: cols[i].w - 6, align: cols[i].align ?? "left", lineBreak: false, ellipsis: true });
        cx += cols[i].w;
      });
    };
    doc.rect(left, y, width, 18).fill("#eef2f7").fillColor("#000");
    row(cols.map((c) => c.label), y, true);
    y += 18;
    for (const l of data.lines) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      row([l.location ?? "—", l.sku ?? "—", l.itemName, String(l.toPick), l.available != null ? String(l.available) : "—", "____"], y);
      y += 17;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.3).stroke("#ccc");
    }
    const total = data.lines.reduce((a, l) => a + l.toPick, 0);
    row(["", "", "Total", String(total), "", ""], y + 2, true);
    y += 30;

    const third = (width - 16) / 3;
    box(doc, left, y, third, 56, "SEPARADO POR / DATA", [""]);
    box(doc, left + third + 8, y, third, 56, "CONFERIDO POR / DATA", [""]);
    box(doc, left + 2 * (third + 8), y, third, 56, "EMBALADO / VOLUMES", [""]);
  });
}

// ── Fatura de venda ──────────────────────────────────────────────────────────

export interface InvoicePdfData {
  issuer: PartyInfo;
  customer: PartyInfo;
  invoice: {
    number: string;
    issueDate: string; // YYYY-MM-DD
    dueDate: string | null;
    orderNumber: string | null;
    subtotal: number;
    taxTotal: number;
    total: number;
    notes: string | null;
  };
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxAmount: number;
    lineTotal: number;
  }[];
  fiscal: {
    atcud: string | null;
    hashChars: string;
    signed: boolean;
    qr: string | null;
    softwareCert: string;
    atStatus: string | null;
  };
}

const eur = (v: number) =>
  `${v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Fatura A4: emitente/destinatário, grelha com IVA por linha, totais e rodapé fiscal. */
export function salesInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderPdf(async (doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const half = (width - 10) / 2;
    const fmtDay = (d: string) =>
      new Date(`${d}T00:00:00`).toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon" });

    doc.font("Helvetica-Bold").fontSize(15).text(data.issuer.name, left, 40, { width: half });
    doc.font("Helvetica").fontSize(8.5).text(partyLines({ ...data.issuer, name: "" }).join("\n"), left, 60, { width: half });

    doc.font("Helvetica-Bold").fontSize(13).text("FATURA", left + half + 10, 40, { width: half, align: "right" });
    doc.font("Helvetica").fontSize(10).text(data.invoice.number, left + half + 10, 58, { width: half, align: "right" });
    doc.fontSize(8.5)
      .text(`Data: ${fmtDay(data.invoice.issueDate)}`, left + half + 10, 72, { width: half, align: "right" });
    if (data.invoice.dueDate) {
      doc.text(`Vencimento: ${fmtDay(data.invoice.dueDate)}`, left + half + 10, 83, { width: half, align: "right" });
    }
    if (data.fiscal.atcud) {
      doc.text(`ATCUD: ${data.fiscal.atcud}`, left + half + 10, 94, { width: half, align: "right" });
    }

    const y0 = 118;
    box(doc, left, y0, half, 64, "DESTINATÁRIO / ADQUIRENTE", partyLines(data.customer));
    box(doc, left + half + 10, y0, half, 64, "REFERÊNCIAS", [
      data.invoice.orderNumber ? `Encomenda: ${data.invoice.orderNumber}` : "—",
      `Estado: ${data.fiscal.atStatus === "communicated" ? "Comunicada à AT" : data.fiscal.atStatus === "signed" ? "Assinada" : "Documento interno"}`,
    ]);

    // Tabela de linhas
    let y = y0 + 76;
    const cols = [
      { label: "#", w: 22 },
      { label: "Descrição", w: width - 22 - 50 - 70 - 45 - 75 },
      { label: "Qtd", w: 50, align: "right" as const },
      { label: "Preço un.", w: 70, align: "right" as const },
      { label: "IVA", w: 45, align: "right" as const },
      { label: "Total", w: 75, align: "right" as const },
    ];
    const row = (cells: string[], yy: number, bold = false) => {
      let cx = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      cells.forEach((c, i) => {
        doc.text(c, cx + 3, yy + 4, { width: cols[i].w - 6, align: cols[i].align ?? "left", lineBreak: false, ellipsis: true });
        cx += cols[i].w;
      });
    };
    doc.rect(left, y, width, 18).fill("#eef2f7").fillColor("#000");
    row(cols.map((c) => c.label), y, true);
    y += 18;
    data.lines.forEach((l, i) => {
      if (y > doc.page.height - 190) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      row(
        [String(i + 1), l.description, String(l.quantity), eur(l.unitPrice), `${l.taxRate}%`, eur(l.lineTotal)],
        y,
      );
      y += 16;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.3).stroke("#ccc");
    });

    // Totais
    y += 12;
    const tx = left + width - 220;
    doc.font("Helvetica").fontSize(9).text("Base tributável", tx, y, { width: 110 });
    doc.font("Helvetica-Bold").text(eur(data.invoice.subtotal), tx + 110, y, { width: 110, align: "right" });
    doc.font("Helvetica").text("IVA", tx, y + 14, { width: 110 });
    doc.font("Helvetica-Bold").text(eur(data.invoice.taxTotal), tx + 110, y + 14, { width: 110, align: "right" });
    doc.rect(tx, y + 28, 220, 20).fill("#eef2f7").fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(10).text("TOTAL", tx + 6, y + 33, { width: 104 });
    doc.text(eur(data.invoice.total), tx + 110, y + 33, { width: 104, align: "right" });

    if (data.invoice.notes) {
      doc.font("Helvetica-Bold").fontSize(8).text("Observações", left, y + 40);
      doc.font("Helvetica").fontSize(8.5).text(data.invoice.notes, left, y + 51, { width: width - 230 });
    }

    // Rodapé fiscal: QR + assinatura + certificação
    const footerY = doc.page.height - 118;
    let txX = left;
    if (data.fiscal.qr) {
      const qr = await barcodePng(data.fiscal.qr, "qrcode", { scale: 2 });
      doc.image(qr, left, footerY, { width: 76 });
      txX = left + 88;
    }
    doc.font("Helvetica").fontSize(7.5).fillColor("#333");
    const legal = data.fiscal.signed
      ? `${data.fiscal.hashChars}-Processado por programa certificado n.º ${data.fiscal.softwareCert}/AT`
      : "Documento não assinado — software sem chave de certificação configurada (apenas para testes).";
    doc.text(
      [legal, "Os bens/serviços foram colocados à disposição do adquirente na data da fatura."]
        .join("\n"),
      txX,
      footerY + 6,
      { width: doc.page.width - txX - doc.page.margins.right },
    );
    doc.fillColor("#000");
  });
}

/** Etiquetas de volume 100×150 mm — uma página por volume. */
export function labelsPdf(data: ShippingDocData): Promise<Buffer> {
  const mm = (v: number) => (v * 72) / 25.4;
  const total = Math.max(1, data.shipment.packages ?? 1);
  return renderPdf(
    async (doc) => {
      const W = mm(100);
      const pad = mm(4);
      const code = data.shipment.trackingNumber ?? data.shipment.number;
      const qr = data.trackingUrl ? await barcodePng(data.trackingUrl, "qrcode", { scale: 2 }) : null;
      for (let i = 1; i <= total; i++) {
        if (i > 1) doc.addPage();
        const s = data.shipment;
        doc.font("Helvetica-Bold").fontSize(9).text(data.carrierName ?? data.issuer.name, pad, pad, { width: W - 2 * pad });
        doc.font("Helvetica").fontSize(7).text("REMETENTE", pad, mm(11));
        doc.fontSize(8).text(
          [data.issuer.name, s.pickup.line1, `${s.pickup.postalCode} ${s.pickup.city} ${s.pickup.country}`].join("\n"),
          pad,
          mm(14),
          { width: W - 2 * pad },
        );
        doc.moveTo(pad, mm(30)).lineTo(W - pad, mm(30)).lineWidth(1).stroke();
        doc.font("Helvetica").fontSize(7).text("DESTINATÁRIO", pad, mm(32));
        doc.font("Helvetica-Bold").fontSize(12).text(
          [s.recipientName ?? data.customer.name, s.delivery.line1, `${s.delivery.postalCode} ${s.delivery.city}`, s.delivery.country].join("\n"),
          pad,
          mm(36),
          { width: W - 2 * pad },
        );
        doc.font("Helvetica-Bold").fontSize(26).text(s.delivery.postalCode, pad, mm(66), { width: W - 2 * pad, align: "right" });
        doc.moveTo(pad, mm(78)).lineTo(W - pad, mm(78)).stroke();
        doc.font("Helvetica").fontSize(9).text(
          `Volume ${i}/${total}    Peso: ${s.totalWeightKg != null ? `${(s.totalWeightKg / total).toFixed(2)} kg` : "—"}    ${s.number}`,
          pad,
          mm(80),
        );
        const bar = await barcodePng(`${code}${total > 1 ? String(i).padStart(3, "0") : ""}`, "code128", { height: 18 });
        doc.image(bar, pad, mm(87), { width: W - 2 * pad, height: mm(26) });
        doc.font("Helvetica-Bold").fontSize(11).text(code, pad, mm(115), { width: W - 2 * pad, align: "center" });
        if (qr) {
          doc.image(qr, W - pad - mm(26), mm(122), { width: mm(24) });
          doc.font("Helvetica").fontSize(7).text("Acompanhe a entrega:", pad, mm(126), { width: W - mm(34) });
          doc.fontSize(6.5).text(data.trackingUrl ?? "", pad, mm(130), { width: W - mm(34) });
        }
      }
    },
    { size: [mm(100), mm(150)], margin: 0 },
  );
}
