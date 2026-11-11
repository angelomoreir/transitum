import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleDot, MapPin, PenLine } from "lucide-react";
import type { PublicTrackingDto } from "@transitum/shared";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SHIPMENT_STATUS_VARIANT } from "@/pages/ShipmentsPage";

const BASE = import.meta.env.VITE_API_URL || "";

/** Página pública de tracking — sem autenticação, link enviado ao destinatário. */
export function TrackPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [tracking, setTracking] = useState<PublicTrackingDto | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/track/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((d) => setTracking(d.tracking))
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-muted-foreground">{t("track.notFound")}</p>
      </div>
    );
  }
  if (!tracking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    );
  }

  const points: MapPoint[] = [];
  if (tracking.lastPosition) {
    points.push({ coords: tracking.lastPosition, label: t("track.currentPosition"), kind: "position" });
  }
  if (tracking.destinationCoords) {
    points.push({ coords: tracking.destinationCoords, label: tracking.destination.city, kind: "delivery" });
  }
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-PT") : "—");

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-2xl space-y-4 p-4 py-8">
        <header className="text-center">
          <p className="text-sm font-medium text-muted-foreground">{tracking.companyName}</p>
          <h1 className="font-mono text-2xl font-semibold">{tracking.number}</h1>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Badge variant={SHIPMENT_STATUS_VARIANT[tracking.status]}>
              {t(`shipments.statuses.${tracking.status}`)}
            </Badge>
            {tracking.trackingNumber && (
              <Badge variant="outline">
                {tracking.carrierName}: {tracking.trackingNumber}
              </Badge>
            )}
          </div>
        </header>

        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">{t("track.origin")}</p>
              <p className="font-medium">
                {tracking.origin.city}, {tracking.origin.country}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("track.destination")}</p>
              <p className="font-medium">
                {tracking.destination.city}, {tracking.destination.country}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("shipments.plannedDelivery")}</p>
              <p className="font-medium">{fmt(tracking.plannedDeliveryAt)}</p>
            </div>
            {tracking.estimatedArrivalAt && (
              <div>
                <p className="font-medium text-primary">
                  {t("track.eta", { time: fmt(tracking.estimatedArrivalAt) })}
                </p>
              </div>
            )}
            {tracking.deliveredAt && (
              <div>
                <p className="text-muted-foreground">{t("shipments.deliveredAt")}</p>
                <p className="font-medium">{fmt(tracking.deliveredAt)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {points.length > 0 && <LeafletMap points={points} />}

        {tracking.proof && (
          <Card>
            <CardContent className="flex items-center gap-3 pt-6 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <p className="font-medium">
                  {t("track.receivedBy", { name: tracking.proof.recipientName })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmt(tracking.proof.capturedAt)}
                  {tracking.proof.signed ? ` · ${t("track.signed")}` : ""}
                </p>
              </div>
              {tracking.proof.signed && <PenLine className="ml-auto h-4 w-4 text-muted-foreground" />}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.timeline")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l border-border pl-5">
              {[...tracking.events].reverse().map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[27px] top-0.5 rounded-full bg-card">
                    <CircleDot className="h-4 w-4 text-primary" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
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
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">Powered by Transitum</p>
      </div>
    </div>
  );
}
