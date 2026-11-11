import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleDot,
  Eraser,
  MapPin,
  Navigation,
  PackageCheck,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DriverRouteDetailDto,
  DriverRouteDto,
  DriverStopDto,
  ProofOfDeliveryDto,
} from "@transitum/shared";
import { api, ApiRequestError, fileToBase64 } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const STOP_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  arrived: "secondary",
  done: "default",
  skipped: "destructive",
};

/** GPS atual; null se indisponível/rejeitado. */
function currentPosition(): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

export function DriverPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [routes, setRoutes] = useState<DriverRouteDto[] | null>(null);
  const [route, setRoute] = useState<DriverRouteDetailDto | null>(null);
  const [podStop, setPodStop] = useState<DriverStopDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ routes: DriverRouteDto[] }>("/api/driver/routes");
      setRoutes(res.routes);
      if (route) {
        const detail = await api<{ route: DriverRouteDetailDto }>(`/api/driver/routes/${route.id}`);
        setRoute(detail.route);
      }
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [route, t]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Envio periódico da posição enquanto há uma rota ativa aberta
  useEffect(() => {
    if (!route || route.status !== "dispatched") return;
    const send = async () => {
      const pos = await currentPosition();
      if (pos) {
        await api("/api/driver/location", {
          method: "POST",
          body: { routeId: route.id, lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM },
        }).catch(() => {});
      }
    };
    send();
    const timer = setInterval(send, 60_000);
    return () => clearInterval(timer);
  }, [route]);

  const openRoute = async (id: string) => {
    const detail = await api<{ route: DriverRouteDetailDto }>(`/api/driver/routes/${id}`);
    setRoute(detail.route);
  };

  const setStopStatus = async (stop: DriverStopDto, status: "arrived" | "done" | "skipped") => {
    setBusy(true);
    try {
      const pos = await currentPosition();
      await api(`/api/driver/routes/${route!.id}/stops/${stop.id}/status`, {
        method: "POST",
        body: { status, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) },
      });
      await openRoute(route!.id);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  // ── Lista de rotas ──────────────────────────────────────────────────────
  if (!route) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("driver.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("driver.welcome", { name: user?.name ?? "" })}
          </p>
        </div>
        {!routes ? (
          <Skeleton className="h-40 w-full" />
        ) : routes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Truck className="h-8 w-8" />
              {t("driver.noRoutes")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {routes.map((r) => (
              <button
                key={r.id}
                onClick={() => openRoute(r.id)}
                className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-muted-foreground">{r.number}</p>
                    <p className="font-medium">{r.name}</p>
                  </div>
                  <Badge variant={r.status === "dispatched" ? "default" : "secondary"}>
                    {t(`routes.statuses.${r.status}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("routes.stopCount", { done: r.doneStops, total: r.stopCount })}
                  {r.vehicleRef ? ` · ${r.vehicleRef}` : ""}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Detalhe da rota ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setRoute(null); load(); }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{route.name}</h1>
          <p className="text-sm text-muted-foreground">
            {route.number} · {t("routes.stopCount", { done: route.doneStops, total: route.stopCount })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {route.stops.map((stop) => (
          <Card key={stop.id} data-testid={`driver-stop-${stop.seq}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-medium">
                  {stop.seq}
                </span>
                <div>
                  <CardTitle className="text-base">
                    {t(`routes.stopTypes.${stop.type}`)}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {stop.shipment ? `${stop.shipment.number} — ${stop.shipment.customerName}` : stop.address.city}
                  </p>
                </div>
              </div>
              <Badge variant={STOP_VARIANT[stop.status]}>
                {t(`routes.stopStatuses.${stop.status}`)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  {stop.address.line1}
                  <br />
                  {stop.address.postalCode} {stop.address.city}
                </span>
                {stop.coords && (
                  <a
                    className="ml-auto shrink-0 text-primary hover:underline"
                    href={`https://www.openstreetmap.org/?mlat=${stop.coords.lat}&mlon=${stop.coords.lng}#map=16/${stop.coords.lat}/${stop.coords.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("driver.navigate")}
                  </a>
                )}
              </p>
              {stop.shipment && (
                <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {stop.shipment.recipientName && <p>{stop.shipment.recipientName}</p>}
                  {stop.shipment.recipientPhone && <p>{stop.shipment.recipientPhone}</p>}
                  {stop.shipment.packages != null && (
                    <p>{t("shipments.packages")}: {stop.shipment.packages}</p>
                  )}
                </div>
              )}
              {stop.note && <p className="text-xs text-muted-foreground">{stop.note}</p>}

              {stop.status !== "done" && stop.status !== "skipped" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {stop.status === "pending" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setStopStatus(stop, "arrived")}>
                      <CircleDot className="h-4 w-4" />
                      {t("routes.stopActions.arrived")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => (stop.type === "delivery" ? setPodStop(stop) : setStopStatus(stop, "done"))}
                  >
                    <PackageCheck className="h-4 w-4" />
                    {t("routes.stopActions.done")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStopStatus(stop, "skipped")}>
                    {t("routes.stopActions.skipped")}
                  </Button>
                </div>
              )}
              {stop.hasProof && (
                <p className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("driver.proofRegistered")}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {podStop && (
        <PodDialog
          routeId={route.id}
          stop={podStop}
          onClose={() => setPodStop(null)}
          onDone={async () => {
            setPodStop(null);
            await openRoute(route.id);
          }}
        />
      )}
    </div>
  );
}

// ── Prova de entrega: nome, assinatura, foto, GPS ───────────────────────────

function PodDialog({
  routeId,
  stop,
  onClose,
  onDone,
}: {
  routeId: string;
  stop: DriverStopDto;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [recipient, setRecipient] = useState(stop.shipment?.recipientName ?? "");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      signed.current = true;
    };
    const up = () => (drawing.current = false);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
  }, []);

  const clearSignature = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    signed.current = false;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!signed.current) {
      toast.error(t("driver.signatureRequired"));
      return;
    }
    setBusy(true);
    try {
      const pos = await currentPosition();
      const signaturePngBase64 = canvasRef.current!.toDataURL("image/png").split(",")[1];
      const photoJpegBase64 = photo ? await fileToBase64(photo) : undefined;
      await api<{ proof: ProofOfDeliveryDto }>(
        `/api/driver/routes/${routeId}/stops/${stop.id}/proof`,
        {
          method: "POST",
          body: {
            recipientName: recipient.trim(),
            signaturePngBase64,
            photoJpegBase64,
            note: note.trim() || undefined,
            ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
          },
        },
      );
      toast.success(t("driver.proofSaved"));
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("driver.podTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pod-name">{t("driver.recipientName")}</Label>
            <Input
              id="pod-name"
              required
              minLength={2}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("driver.signature")}</Label>
              <Button type="button" variant="ghost" size="sm" onClick={clearSignature}>
                <Eraser className="h-3.5 w-3.5" />
                {t("driver.clearSignature")}
              </Button>
            </div>
            <canvas
              ref={canvasRef}
              className="h-40 w-full touch-none rounded-md border border-dashed border-input bg-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("driver.photo")}</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => photoRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                {photo ? photo.name : t("driver.addPhoto")}
              </Button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pod-note">{t("routes.note")}</Label>
            <Textarea id="pod-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Navigation className="h-3 w-3" />
            {t("driver.gpsHint")}
          </p>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("driver.confirmDelivery")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
