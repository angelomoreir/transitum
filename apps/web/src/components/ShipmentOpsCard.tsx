import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  FileCheck,
  FileText,
  Link2,
  RefreshCw,
  Send,
  Tag,
  TruckIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  RateQuoteDto,
  ShipmentDetailDto,
  TransportDocumentDto,
} from "@transitum/shared";
import { api, apiDownload, ApiRequestError, saveBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const eur = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

const DOC_STATUS_VARIANT: Record<TransportDocumentDto["status"], "default" | "secondary" | "destructive"> = {
  issued: "secondary",
  communicated: "default",
  failed: "destructive",
};

/** Operações da expedição: cotação de frete, documentos AT e transportadora. */
export function ShipmentOpsCard({
  shipment,
  onChange,
}: {
  shipment: ShipmentDetailDto;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [quotes, setQuotes] = useState<RateQuoteDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!can("costs:read")) return;
    api<{ quotes: RateQuoteDto[] }>(`/api/shipments/${shipment.id}/quotes`)
      .then((r) => setQuotes(r.quotes))
      .catch(() => setQuotes([]));
  }, [shipment.id, shipment.status, can]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChange();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const applyRate = (rateId?: string) =>
    run(async () => {
      const res = await api<{ cost: { amount: number } }>(
        `/api/shipments/${shipment.id}/apply-rate`,
        { method: "POST", body: rateId ? { rateId } : {} },
      );
      toast.success(t("ops.rateApplied", { amount: eur(res.cost.amount) }));
    });

  const issueDoc = () =>
    run(async () => {
      const res = await api<{ document: TransportDocumentDto }>(
        `/api/shipments/${shipment.id}/transport-documents`,
        { method: "POST", body: {} },
      );
      toast.success(t("ops.docIssued", { number: res.document.number }));
    });

  const download = async (kind: "guide" | "cmr" | "labels", name: string) => {
    try {
      const blob = await apiDownload(`/api/shipments/${shipment.id}/documents/${kind}.pdf`);
      saveBlob(blob, `${name}-${shipment.number}.pdf`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  const book = () =>
    run(async () => {
      const res = await api<{ shipment: ShipmentDetailDto }>(`/api/shipments/${shipment.id}/book`, {
        method: "POST",
      });
      toast.success(t("ops.booked", { tracking: res.shipment.trackingNumber }));
    });

  const sync = () =>
    run(async () => {
      const res = await api<{ newEvents: number }>(`/api/shipments/${shipment.id}/sync-tracking`, {
        method: "POST",
      });
      toast.success(t("ops.synced", { count: res.newEvents }));
    });

  const copyTrackingLink = async () => {
    const url = `${window.location.origin}/track/${shipment.trackingToken}`;
    await navigator.clipboard.writeText(url);
    toast.success(t("ops.linkCopied"));
  };

  const canWrite = can("shipments:write") && shipment.status !== "cancelled";

  return (
    <>
      {/* Tracking público + transportadora */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("ops.tracking")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {shipment.trackingNumber ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{shipment.carrierProvider}</Badge>
              <span className="font-mono">{shipment.trackingNumber}</span>
              {canWrite && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={sync}>
                  <RefreshCw className="h-4 w-4" />
                  {t("ops.syncTracking")}
                </Button>
              )}
            </div>
          ) : (
            canWrite &&
            ["draft", "planned"].includes(shipment.status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={book}>
                <TruckIcon className="h-4 w-4" />
                {t("ops.bookCarrier")}
              </Button>
            )
          )}
          {shipment.trackingToken && (
            <Button variant="outline" size="sm" onClick={copyTrackingLink}>
              <Link2 className="h-4 w-4" />
              {t("ops.copyTrackingLink")}
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          {shipment.distanceKm != null && (
            <p className="text-muted-foreground">
              {t("ops.distance", { km: shipment.distanceKm })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cotação automática */}
      {can("costs:read") && quotes !== null && quotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ops.quotes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {quotes.map((q) => (
                <li key={q.rateId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    {q.carrierName} — {q.rateName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t(`rates.bases.${q.basis}`)}
                    </span>
                  </span>
                  {q.amount != null ? (
                    <>
                      <span className="font-mono font-medium">
                        {eur(q.amount)}
                        {q.minChargeApplied && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t("ops.minCharge")})
                          </span>
                        )}
                      </span>
                      {can("costs:write") && shipment.status !== "cancelled" && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => applyRate(q.rateId)}>
                          {t("ops.apply")}
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t(`ops.missing.${q.missing}`)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Documentos de transporte */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("ops.documents")}</CardTitle>
          {canWrite && (
            <Button variant="outline" size="sm" disabled={busy} onClick={issueDoc}>
              <FileCheck className="h-4 w-4" />
              {t("ops.issueDoc")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {shipment.transportDocuments.length === 0 ? (
            <p className="text-muted-foreground">{t("ops.noDocs")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shipment.transportDocuments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-mono">{d.number}</span>
                  <Badge variant={DOC_STATUS_VARIANT[d.status]}>
                    {t(`ops.docStatuses.${d.status}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">ATCUD {d.atcud}</span>
                  {d.atMessage && d.status === "failed" && (
                    <span className="text-xs text-destructive">{d.atMessage}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => download("guide", "guia")}>
              <FileText className="h-4 w-4" />
              {t("ops.guide")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => download("cmr", "cmr")}>
              <Send className="h-4 w-4" />
              CMR
            </Button>
            <Button variant="ghost" size="sm" onClick={() => download("labels", "etiquetas")}>
              <Tag className="h-4 w-4" />
              {t("ops.labels")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
