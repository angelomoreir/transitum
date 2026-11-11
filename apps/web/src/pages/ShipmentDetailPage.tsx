import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CircleDot, MapPin, Plus, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  COST_TYPES,
  SHIPMENT_TRANSITIONS,
  type CostType,
  type ShipmentDetailDto,
  type ShipmentStatus,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CustomsCard } from "@/components/CustomsCard";
import { DocumentsCard } from "@/components/DocumentsCard";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";
import { ShipmentOpsCard } from "@/components/ShipmentOpsCard";
import { SHIPMENT_STATUS_VARIANT } from "@/pages/ShipmentsPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const fmtMoney = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(v);

export function ShipmentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [shipment, setShipment] = useState<ShipmentDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [noteLocation, setNoteLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState({ type: "freight" as CostType, description: "", amount: "" });

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
        body: { description: note.trim(), location: noteLocation.trim() || undefined },
      });
      setNote("");
      setNoteLocation("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const addCost = async (e: FormEvent) => {
    e.preventDefault();
    if (!cost.description.trim() || !cost.amount) return;
    setBusy(true);
    try {
      await api(`/api/shipments/${id}/costs`, {
        method: "POST",
        body: {
          type: cost.type,
          description: cost.description.trim(),
          amount: Number(cost.amount),
        },
      });
      setCost({ type: "freight", description: "", amount: "" });
      toast.success(t("shipments.costAdded"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const deleteCost = async (costId: string) => {
    try {
      await api(`/api/shipments/${id}/costs/${costId}`, { method: "DELETE" });
      toast.success(t("shipments.costDeleted"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
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

      {(shipment.pickupCoords || shipment.deliveryCoords || shipment.lastPosition) && (
        <LeafletMap
          points={(() => {
            const pts: MapPoint[] = [];
            if (shipment.pickupCoords) {
              pts.push({ coords: shipment.pickupCoords, label: t("shipments.pickup"), kind: "pickup" });
            }
            if (shipment.lastPosition) {
              pts.push({ coords: shipment.lastPosition, label: t("ops.lastPosition"), kind: "position" });
            }
            if (shipment.deliveryCoords) {
              pts.push({ coords: shipment.deliveryCoords, label: t("shipments.delivery"), kind: "delivery" });
            }
            return pts;
          })()}
        />
      )}

      {shipment.lines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orders.lines")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {shipment.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className="w-8 text-muted-foreground">{l.lineNo}.</span>
                  {l.sku && <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>}
                  <span className="flex-1">{l.description}</span>
                  <span>
                    {l.quantity} {l.unit}
                  </span>
                  {l.weightKg != null && (
                    <span className="text-xs text-muted-foreground">{l.weightKg} kg</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ShipmentOpsCard shipment={shipment} onChange={load} />

      {shipment.proofs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ops.proofs")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {shipment.proofs.map((p) => (
                <li key={p.id} className="py-2">
                  <p className="font-medium">{p.recipientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`routes.stopTypes.${p.stopType}`)} ·{" "}
                    {new Date(p.capturedAt).toLocaleString("pt-PT")}
                    {p.capturedByName ? ` · ${p.capturedByName}` : ""}
                    {p.signatureDocId ? ` · ${t("ops.signed")}` : ""}
                  </p>
                  {p.note && <p className="text-xs">{p.note}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("shipments.costs")}</CardTitle>
          <span className="font-mono text-sm font-semibold">
            {t("shipments.totalCost")}: {fmtMoney(shipment.totalCost, "EUR")}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {shipment.costs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("shipments.noCosts")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shipment.costs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                  <Badge variant="secondary">{t(`shipments.costTypes.${c.type}`)}</Badge>
                  <span className="flex-1">{c.description}</span>
                  <span className="font-mono">{fmtMoney(c.amount, c.currency)}</span>
                  {can("costs:write") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteCost(c.id)}
                      aria-label={t("shipments.confirmDeleteCost")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {can("costs:write") && shipment.status !== "cancelled" && (
            <form onSubmit={addCost} className="flex flex-wrap items-end gap-2 pt-2">
              <Select
                value={cost.type}
                onValueChange={(v) => setCost((c) => ({ ...c, type: v as CostType }))}
              >
                <SelectTrigger className="w-36" aria-label={t("shipments.costType")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`shipments.costTypes.${ct}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="min-w-40 flex-1"
                placeholder={t("orders.description")}
                aria-label={t("orders.description")}
                value={cost.description}
                onChange={(e) => setCost((c) => ({ ...c, description: e.target.value }))}
              />
              <Input
                className="w-28"
                type="number"
                min={0.01}
                step="0.01"
                placeholder="0.00"
                aria-label={t("shipments.amount")}
                value={cost.amount}
                onChange={(e) => setCost((c) => ({ ...c, amount: e.target.value }))}
              />
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                <Plus className="h-4 w-4" />
                {t("shipments.addCost")}
              </Button>
            </form>
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
              <form onSubmit={addNote} className="flex flex-wrap gap-2">
                <Input
                  id="shipment-note"
                  className="min-w-40 flex-1"
                  placeholder={t("shipments.notePlaceholder")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Input
                  id="shipment-note-location"
                  className="w-44"
                  placeholder={t("shipments.location")}
                  value={noteLocation}
                  onChange={(e) => setNoteLocation(e.target.value)}
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
                  {e.type === "checkpoint" && (
                    <Badge variant="outline">{t("shipments.eventTypes.checkpoint")}</Badge>
                  )}
                  <span className="text-sm">{e.description}</span>
                  {e.location && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {e.location}
                    </span>
                  )}
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

      <DocumentsCard entityType="shipment" entityId={shipment.id} />

      <CustomsCard shipment={shipment} onChange={load} />
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
