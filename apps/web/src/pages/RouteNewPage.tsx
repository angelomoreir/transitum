import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  routeCreateSchema,
  STOP_TYPES,
  type PartnerDto,
  type RouteDetailDto,
  type ShipmentDto,
  type StopType,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface StopForm {
  type: StopType;
  shipmentId: string;
  line1: string;
  city: string;
  postalCode: string;
  country: string;
  plannedAt: string;
  note: string;
}

const EMPTY_STOP: StopForm = {
  type: "pickup",
  shipmentId: "",
  line1: "",
  city: "",
  postalCode: "",
  country: "PT",
  plannedAt: "",
  note: "",
};

export function RouteNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [carriers, setCarriers] = useState<PartnerDto[]>([]);
  const [shipments, setShipments] = useState<ShipmentDto[]>([]);
  const [form, setForm] = useState({
    name: "",
    carrierId: "",
    driverName: "",
    vehicleRef: "",
    plannedStartAt: "",
    plannedEndAt: "",
    notes: "",
  });
  const [stops, setStops] = useState<StopForm[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "carrier", active: "true", pageSize: 100 },
    })
      .then((r) => setCarriers(r.items))
      .catch((e) => toast.error(e.message));
    api<{ items: ShipmentDto[] }>("/api/shipments", {
      params: { status: "planned", pageSize: 100 },
    })
      .then((r) => setShipments(r.items))
      .catch(() => setShipments([]));
  }, []);

  const setStop = (i: number, patch: Partial<StopForm>) =>
    setStops((ss) => ss.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const move = (i: number, dir: -1 | 1) =>
    setStops((ss) => {
      const j = i + dir;
      if (j < 0 || j >= ss.length) return ss;
      const next = [...ss];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      carrierId: form.carrierId || undefined,
      driverName: form.driverName || undefined,
      vehicleRef: form.vehicleRef || undefined,
      plannedStartAt: form.plannedStartAt
        ? new Date(form.plannedStartAt).toISOString()
        : undefined,
      plannedEndAt: form.plannedEndAt ? new Date(form.plannedEndAt).toISOString() : undefined,
      notes: form.notes || undefined,
      stops: stops.map((s) => ({
        type: s.type,
        shipmentId: s.shipmentId || undefined,
        address: {
          line1: s.line1,
          city: s.city,
          postalCode: s.postalCode,
          country: s.country,
        },
        plannedAt: s.plannedAt ? new Date(s.plannedAt).toISOString() : undefined,
        note: s.note || undefined,
      })),
    };
    const parsed = routeCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ route: RouteDetailDto }>("/api/routes", {
        method: "POST",
        body: parsed.data,
      });
      toast.success(t("routes.created", { number: res.route.number }));
      navigate(`/routes/${res.route.id}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/routes">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("routes.new")}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("routes.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="r-name">{t("routes.name")}</Label>
              <Input
                id="r-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("routes.carrier")}</Label>
              <Select
                value={form.carrierId}
                onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))}
              >
                <SelectTrigger data-testid="route-carrier">
                  <SelectValue placeholder={t("routes.selectCarrier")} />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-driver">{t("routes.driver")}</Label>
              <Input
                id="r-driver"
                value={form.driverName}
                onChange={(e) => setForm((f) => ({ ...f, driverName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-vehicle">{t("routes.vehicle")}</Label>
              <Input
                id="r-vehicle"
                value={form.vehicleRef}
                onChange={(e) => setForm((f) => ({ ...f, vehicleRef: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-start">{t("routes.plannedStart")}</Label>
              <Input
                id="r-start"
                type="datetime-local"
                value={form.plannedStartAt}
                onChange={(e) => setForm((f) => ({ ...f, plannedStartAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-end">{t("routes.plannedEnd")}</Label>
              <Input
                id="r-end"
                type="datetime-local"
                value={form.plannedEndAt}
                onChange={(e) => setForm((f) => ({ ...f, plannedEndAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="r-notes">{t("shipments.notes")}</Label>
              <Textarea
                id="r-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("routes.stops")}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStops((ss) => [...ss, { ...EMPTY_STOP }])}
            >
              <Plus className="h-4 w-4" />
              {t("routes.addStop")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {stops.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("routes.empty")}</p>
            )}
            {stops.map((s, i) => (
              <div
                key={i}
                className="space-y-3 rounded-md border border-border p-3"
                data-testid={`stop-${i}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-center text-sm font-medium text-muted-foreground">
                    {i + 1}
                  </span>
                  <Select
                    value={s.type}
                    onValueChange={(v) => setStop(i, { type: v as StopType })}
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
                    value={s.shipmentId}
                    onValueChange={(v) => setStop(i, { shipmentId: v === "none" ? "" : v })}
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
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setStops((ss) => ss.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder={t("partners.address")}
                    required
                    value={s.line1}
                    onChange={(e) => setStop(i, { line1: e.target.value })}
                    className="sm:col-span-2"
                  />
                  <Input
                    placeholder={t("partners.city")}
                    required
                    value={s.city}
                    onChange={(e) => setStop(i, { city: e.target.value })}
                  />
                  <Input
                    placeholder={t("partners.postalCode")}
                    required
                    value={s.postalCode}
                    onChange={(e) => setStop(i, { postalCode: e.target.value })}
                  />
                  <Input
                    placeholder={t("partners.country")}
                    required
                    maxLength={2}
                    value={s.country}
                    onChange={(e) =>
                      setStop(i, { country: e.target.value.toUpperCase() })
                    }
                  />
                  <Input
                    type="datetime-local"
                    aria-label={t("routes.plannedAt")}
                    value={s.plannedAt}
                    onChange={(e) => setStop(i, { plannedAt: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link to="/routes">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
