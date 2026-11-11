import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, MapPin, Route as RouteOptIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ROUTE_TRANSITIONS,
  STOP_TRANSITIONS,
  STOP_TYPES,
  type PartnerDto,
  type RouteDetailDto,
  type RouteStatus,
  type ShipmentDto,
  type StopStatus,
  type StopType,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DocumentsCard } from "@/components/DocumentsCard";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";
import { ROUTE_STATUS_VARIANT } from "@/pages/RoutesPage";
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

const STOP_VARIANT: Record<StopStatus, "secondary" | "warning" | "success" | "outline"> = {
  pending: "secondary",
  arrived: "warning",
  done: "success",
  skipped: "outline",
};

export function RouteDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [route, setRoute] = useState<RouteDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [shipments, setShipments] = useState<ShipmentDto[]>([]);
  const [newStop, setNewStop] = useState({
    type: "delivery" as StopType,
    shipmentId: "",
    line1: "",
    city: "",
    postalCode: "",
    country: "PT",
  });

  const load = useCallback(async () => {
    try {
      const res = await api<{ route: RouteDetailDto }>(`/api/routes/${id}`);
      setRoute(res.route);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
      else toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ items: ShipmentDto[] }>("/api/shipments", { params: { pageSize: 100 } })
      .then((r) => setShipments(r.items.filter((s) => s.status !== "cancelled")))
      .catch(() => setShipments([]));
  }, []);

  const transition = async (status: RouteStatus) => {
    setBusy(true);
    try {
      await api(`/api/routes/${id}/status`, { method: "POST", body: { status } });
      toast.success(t("partners.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const stopTransition = async (stopId: string, status: StopStatus) => {
    setBusy(true);
    try {
      await api(`/api/routes/${id}/stops/${stopId}/status`, {
        method: "POST",
        body: { status },
      });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const optimize = async () => {
    setBusy(true);
    try {
      const res = await api<{ route: RouteDetailDto; moved: number }>(
        `/api/routes/${id}/optimize`,
        { method: "POST", body: {} },
      );
      setRoute(res.route);
      if (res.moved > 0) toast.success(t("routes.optimized", { count: res.moved }));
      else toast.info(t("routes.optimizeNoCoords"));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const removeStop = async (stopId: string) => {
    try {
      await api(`/api/routes/${id}/stops/${stopId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  const addStop = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/routes/${id}/stops`, {
        method: "POST",
        body: {
          type: newStop.type,
          shipmentId: newStop.shipmentId || undefined,
          address: {
            line1: newStop.line1,
            city: newStop.city,
            postalCode: newStop.postalCode,
            country: newStop.country,
          },
        },
      });
      setAddOpen(false);
      setNewStop({ type: "delivery", shipmentId: "", line1: "", city: "", postalCode: "", country: "PT" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (notFound) return <p className="text-muted-foreground">{t("common.notFound")}</p>;
  if (!route) return <Skeleton className="h-64 w-full" />;

  const nextStatuses = ROUTE_TRANSITIONS[route.status];
  const canEditStops = can("routes:write") && !["completed", "cancelled"].includes(route.status);
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("pt-PT") : "—";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/routes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-mono text-2xl font-semibold">{route.number}</h1>
            <p className="text-sm text-muted-foreground">{route.name}</p>
          </div>
          <Badge variant={ROUTE_STATUS_VARIANT[route.status]}>
            {t(`routes.statuses.${route.status}`)}
          </Badge>
        </div>
        {can("routes:status") && nextStatuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <Button
                key={s}
                variant={s === "cancelled" ? "outline" : "default"}
                disabled={busy}
                onClick={() => transition(s)}
                data-testid={`route-${s}`}
              >
                {t(`routes.actions.${s}`)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("routes.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t("routes.carrier")} value={route.carrierName ?? "—"} />
          <Row
            label={t("routes.driver")}
            value={[route.driverName, route.vehicleRef].filter(Boolean).join(" · ") || "—"}
          />
          <Row label={t("routes.plannedStart")} value={fmt(route.plannedStartAt)} />
          <Row label={t("routes.plannedEnd")} value={fmt(route.plannedEndAt)} />
          <Row
            label={t("routes.stops")}
            value={t("routes.stopCount", { done: route.doneStops, total: route.stopCount })}
          />
          {route.notes && <Row label={t("shipments.notes")} value={route.notes} />}
        </CardContent>
      </Card>

      {(() => {
        const pts: MapPoint[] = route.stops
          .filter((s) => s.coords)
          .map((s) => ({
            coords: s.coords!,
            label: `${s.seq}. ${s.address.city}`,
            kind: s.type === "pickup" ? ("pickup" as const) : ("delivery" as const),
          }));
        const last = route.positions[0];
        if (last) pts.push({ coords: last, label: t("ops.lastPosition"), kind: "position" });
        return pts.length > 0 ? <LeafletMap points={pts} /> : null;
      })()}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("routes.stops")}</CardTitle>
          {canEditStops && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || route.stops.filter((s) => s.status === "pending").length < 2}
                onClick={optimize}
                data-testid="optimize-stops"
              >
                <RouteOptIcon className="mr-1 h-4 w-4" />
                {t("routes.optimize")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddOpen((o) => !o)}>
                {t("routes.addStop")}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {addOpen && (
            <form
              onSubmit={addStop}
              className="space-y-3 rounded-md border border-border p-3"
              data-testid="add-stop-form"
            >
              <div className="flex flex-wrap gap-2">
                <Select
                  value={newStop.type}
                  onValueChange={(v) => setNewStop((s) => ({ ...s, type: v as StopType }))}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOP_TYPES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {t(`routes.stopTypes.${st}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={newStop.shipmentId}
                  onValueChange={(v) =>
                    setNewStop((s) => ({ ...s, shipmentId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={t("routes.linkShipment")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("routes.noShipment")}</SelectItem>
                    {shipments.map((sh) => (
                      <SelectItem key={sh.id} value={sh.id}>
                        {sh.number} — {sh.customerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  placeholder={t("partners.address")}
                  required
                  value={newStop.line1}
                  onChange={(e) => setNewStop((s) => ({ ...s, line1: e.target.value }))}
                  className="sm:col-span-3"
                />
                <Input
                  placeholder={t("partners.city")}
                  required
                  value={newStop.city}
                  onChange={(e) => setNewStop((s) => ({ ...s, city: e.target.value }))}
                />
                <Input
                  placeholder={t("partners.postalCode")}
                  required
                  value={newStop.postalCode}
                  onChange={(e) =>
                    setNewStop((s) => ({ ...s, postalCode: e.target.value }))
                  }
                />
                <Input
                  placeholder={t("partners.country")}
                  required
                  maxLength={2}
                  value={newStop.country}
                  onChange={(e) =>
                    setNewStop((s) => ({ ...s, country: e.target.value.toUpperCase() }))
                  }
                />
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                {t("common.create")}
              </Button>
            </form>
          )}

          <ol className="space-y-3">
            {route.stops.map((stop) => (
              <li
                key={stop.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                data-testid={`stop-item-${stop.seq}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {stop.seq}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t(`routes.stopTypes.${stop.type}`)}</Badge>
                    <Badge variant={STOP_VARIANT[stop.status]}>
                      {t(`routes.stopStatuses.${stop.status}`)}
                    </Badge>
                    {stop.shipmentId && (
                      <Link
                        to={`/shipments/${stop.shipmentId}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {stop.shipmentNumber}
                      </Link>
                    )}
                    {stop.hasProof && (
                      <Badge variant="success">{t("ops.pod")}</Badge>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {stop.address.line1}, {stop.address.city} ({stop.address.country})
                  </p>
                  {(stop.arrivedAt || stop.doneAt) && (
                    <p className="text-xs text-muted-foreground">
                      {stop.arrivedAt &&
                        `${t("routes.arrivedAt")}: ${fmt(stop.arrivedAt)}`}
                      {stop.doneAt && ` · ${t("routes.doneAt")}: ${fmt(stop.doneAt)}`}
                    </p>
                  )}
                </div>
                {can("routes:status") && STOP_TRANSITIONS[stop.status].length > 0 && (
                  <div className="flex gap-1">
                    {STOP_TRANSITIONS[stop.status].map((s) => (
                      <Button
                        key={s}
                        variant={s === "skipped" ? "ghost" : "outline"}
                        size="sm"
                        disabled={busy}
                        onClick={() => stopTransition(stop.id, s)}
                        data-testid={`stop-${stop.seq}-${s}`}
                      >
                        {t(`routes.stopActions.${s}`)}
                      </Button>
                    ))}
                  </div>
                )}
                {route.status === "draft" && can("routes:write") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeStop(stop.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
            {route.stops.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("routes.empty")}</p>
            )}
          </ol>
        </CardContent>
      </Card>

      <DocumentsCard entityType="route" entityId={route.id} />
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
