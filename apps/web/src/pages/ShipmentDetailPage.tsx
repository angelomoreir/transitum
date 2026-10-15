import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CircleDot, StickyNote } from "lucide-react";
import { toast } from "sonner";
import {
  SHIPMENT_TRANSITIONS,
  type ShipmentDetailDto,
  type ShipmentStatus,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SHIPMENT_STATUS_VARIANT } from "@/pages/ShipmentsPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function ShipmentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [shipment, setShipment] = useState<ShipmentDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ shipment: ShipmentDetailDto }>(`/api/shipments/${id}`);
      setShipment(res.shipment);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
      else toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const transition = async (status: ShipmentStatus) => {
    setBusy(true);
    try {
      await api(`/api/shipments/${id}/status`, { method: "POST", body: { status } });
      toast.success(t("partners.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/shipments/${id}/events`, {
        method: "POST",
        body: { description: note.trim() },
      });
      setNote("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (notFound) return <p className="text-muted-foreground">{t("common.notFound")}</p>;
  if (!shipment) return <Skeleton className="h-64 w-full" />;

  const nextStatuses = SHIPMENT_TRANSITIONS[shipment.status];
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("pt-PT") : "—";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/shipments">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-mono text-2xl font-semibold">{shipment.number}</h1>
            <p className="text-sm text-muted-foreground">{shipment.customerName}</p>
          </div>
          <Badge variant={SHIPMENT_STATUS_VARIANT[shipment.status]}>
            {t(`shipments.statuses.${shipment.status}`)}
          </Badge>
        </div>
        {can("shipments:status") && nextStatuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <Button
                key={s}
                variant={s === "cancelled" ? "outline" : "default"}
                disabled={busy}
                onClick={() => transition(s)}
                data-testid={`transition-${s}`}
              >
                {t(`shipments.actions.${s}`)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.pickup")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {shipment.pickupAddress.line1}
              <br />
              {shipment.pickupAddress.postalCode} {shipment.pickupAddress.city},{" "}
              {shipment.pickupAddress.country}
            </p>
            <p className="text-muted-foreground">
              {t("shipments.plannedPickup")}: {fmt(shipment.plannedPickupAt)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.delivery")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {shipment.deliveryAddress.line1}
              <br />
              {shipment.deliveryAddress.postalCode} {shipment.deliveryAddress.city},{" "}
              {shipment.deliveryAddress.country}
            </p>
            <p className="text-muted-foreground">
              {t("shipments.plannedDelivery")}: {fmt(shipment.plannedDeliveryAt)}
            </p>
            {shipment.deliveredAt && (
              <p className="text-muted-foreground">
                {t("shipments.deliveredAt")}: {fmt(shipment.deliveredAt)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("shipments.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t("shipments.carrier")} value={shipment.carrierName ?? "—"} />
          <Row
            label={t("shipments.order")}
            value={
              shipment.orderNumber ? (
                <Link
                  to={`/orders/${shipment.orderId}`}
                  className="font-mono text-primary hover:underline"
                >
                  {shipment.orderNumber}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Row
            label={t("shipments.weightKg")}
            value={shipment.totalWeightKg != null ? String(shipment.totalWeightKg) : "—"}
          />
          <Row
            label={t("shipments.packages")}
            value={shipment.packages != null ? String(shipment.packages) : "—"}
          />
          {shipment.notes && (
            <div className="sm:col-span-2">
              <Row label={t("shipments.notes")} value={shipment.notes} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("shipments.timeline")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {can("shipments:write") &&
            !["delivered", "cancelled"].includes(shipment.status) && (
              <form onSubmit={addNote} className="flex gap-2">
                <Input
                  id="shipment-note"
                  placeholder={t("shipments.notePlaceholder")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button type="submit" variant="outline" disabled={busy}>
                  {t("shipments.addNote")}
                </Button>
              </form>
            )}
          <ol className="relative space-y-4 border-l border-border pl-5">
            {[...shipment.events].reverse().map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] top-0.5 rounded-full bg-card">
                  {e.type === "note" ? (
                    <StickyNote className="h-4 w-4 text-amber-500" />
                  ) : (
                    <CircleDot className="h-4 w-4 text-primary" />
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {e.status && (
                    <Badge variant={SHIPMENT_STATUS_VARIANT[e.status as ShipmentStatus] ?? "secondary"}>
                      {t(`shipments.statuses.${e.status}`)}
                    </Badge>
                  )}
                  <span className="text-sm">{e.description}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleString("pt-PT")}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
