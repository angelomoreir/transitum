import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  shipmentCreateSchema,
  type OrderDto,
  type PartnerDto,
  type ShipmentDetailDto,
} from "@transitum/shared";
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

interface Address {
  line1: string;
  city: string;
  postalCode: string;
  country: string;
}

const EMPTY_ADDR: Address = { line1: "", city: "", postalCode: "", country: "PT" };

export function ShipmentNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [customers, setCustomers] = useState<PartnerDto[]>([]);
  const [carriers, setCarriers] = useState<PartnerDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);

  const [customerId, setCustomerId] = useState(params.get("customerId") ?? "");
  const [carrierId, setCarrierId] = useState("");
  const [orderId, setOrderId] = useState(params.get("orderId") ?? "");
  const [pickup, setPickup] = useState<Address>(EMPTY_ADDR);
  const [delivery, setDelivery] = useState<Address>(EMPTY_ADDR);
  const [plannedPickupAt, setPlannedPickupAt] = useState("");
  const [plannedDeliveryAt, setPlannedDeliveryAt] = useState("");
  const [totalWeightKg, setTotalWeightKg] = useState("");
  const [packages, setPackages] = useState("");
  const [notes, setNotes] = useState("");
  const [recipient, setRecipient] = useState({ name: "", email: "", phone: "", notify: true });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "customer", active: "true", pageSize: 100 },
    })
      .then((r) => setCustomers(r.items))
      .catch((e) => toast.error(e.message));
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "carrier", active: "true", pageSize: 100 },
    })
      .then((r) => setCarriers(r.items))
      .catch((e) => toast.error(e.message));
  }, []);

  // Encomendas do cliente selecionado (para associação opcional)
  useEffect(() => {
    if (!customerId) {
      setOrders([]);
      return;
    }
    api<{ items: OrderDto[] }>("/api/orders", {
      params: { customerId, status: "confirmed", pageSize: 100 },
    })
      .then((r) => setOrders(r.items))
      .catch(() => setOrders([]));
  }, [customerId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      customerId,
      carrierId: carrierId || undefined,
      orderId: orderId || undefined,
      pickupAddress: pickup,
      deliveryAddress: delivery,
      plannedPickupAt: plannedPickupAt ? new Date(plannedPickupAt).toISOString() : undefined,
      plannedDeliveryAt: plannedDeliveryAt
        ? new Date(plannedDeliveryAt).toISOString()
        : undefined,
      totalWeightKg: totalWeightKg ? Number(totalWeightKg) : undefined,
      packages: packages ? Number(packages) : undefined,
      notes: notes || undefined,
      recipientName: recipient.name || undefined,
      recipientEmail: recipient.email || undefined,
      recipientPhone: recipient.phone || undefined,
      notifyRecipient: recipient.notify,
    };
    const parsed = shipmentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ shipment: ShipmentDetailDto }>("/api/shipments", {
        method: "POST",
        body: parsed.data,
      });
      toast.success(t("shipments.created", { number: res.shipment.number }));
      navigate(`/shipments/${res.shipment.id}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  const addressFields = (
    prefix: string,
    value: Address,
    setter: (a: Address) => void,
    title: string,
  ) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${prefix}-line1`}>{t("partners.address")}</Label>
          <Input
            id={`${prefix}-line1`}
            required
            value={value.line1}
            onChange={(e) => setter({ ...value, line1: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-city`}>{t("partners.city")}</Label>
          <Input
            id={`${prefix}-city`}
            required
            value={value.city}
            onChange={(e) => setter({ ...value, city: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-postal`}>{t("partners.postalCode")}</Label>
          <Input
            id={`${prefix}-postal`}
            required
            value={value.postalCode}
            onChange={(e) => setter({ ...value, postalCode: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-country`}>{t("partners.country")}</Label>
          <Input
            id={`${prefix}-country`}
            required
            maxLength={2}
            value={value.country}
            onChange={(e) => setter({ ...value, country: e.target.value.toUpperCase() })}
          />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/shipments">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("shipments.new")}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("shipments.customer")}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger data-testid="shipment-customer">
                  <SelectValue placeholder={t("shipments.selectCustomer")} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("shipments.carrier")}</Label>
              <Select value={carrierId} onValueChange={setCarrierId}>
                <SelectTrigger data-testid="shipment-carrier">
                  <SelectValue placeholder={t("shipments.selectCarrier")} />
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("shipments.order")}</Label>
              <Select
                value={orderId}
                onValueChange={(v) => setOrderId(v === "none" ? "" : v)}
                disabled={!customerId}
              >
                <SelectTrigger data-testid="shipment-order">
                  <SelectValue placeholder={t("shipments.selectOrder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("shipments.noOrder")}</SelectItem>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {addressFields("pickup", pickup, setPickup, t("shipments.pickup"))}
        {addressFields("delivery", delivery, setDelivery, t("shipments.delivery"))}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.recipient")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-rname">{t("shipments.recipientName")}</Label>
              <Input
                id="s-rname"
                value={recipient.name}
                onChange={(e) => setRecipient((r) => ({ ...r, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-rphone">{t("shipments.recipientPhone")}</Label>
              <Input
                id="s-rphone"
                value={recipient.phone}
                onChange={(e) => setRecipient((r) => ({ ...r, phone: e.target.value }))}
                placeholder="+351…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-remail">{t("shipments.recipientEmail")}</Label>
              <Input
                id="s-remail"
                type="email"
                value={recipient.email}
                onChange={(e) => setRecipient((r) => ({ ...r, email: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input
                id="s-rnotify"
                type="checkbox"
                className="h-4 w-4"
                checked={recipient.notify}
                onChange={(e) => setRecipient((r) => ({ ...r, notify: e.target.checked }))}
              />
              <Label htmlFor="s-rnotify">{t("shipments.notifyRecipient")}</Label>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("shipments.notifyHint")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipments.status")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-pp">{t("shipments.plannedPickup")}</Label>
              <Input
                id="s-pp"
                type="datetime-local"
                value={plannedPickupAt}
                onChange={(e) => setPlannedPickupAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pd">{t("shipments.plannedDelivery")}</Label>
              <Input
                id="s-pd"
                type="datetime-local"
                value={plannedDeliveryAt}
                onChange={(e) => setPlannedDeliveryAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-weight">{t("shipments.weightKg")}</Label>
              <Input
                id="s-weight"
                type="number"
                min={0}
                step="0.01"
                value={totalWeightKg}
                onChange={(e) => setTotalWeightKg(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pkgs">{t("shipments.packages")}</Label>
              <Input
                id="s-pkgs"
                type="number"
                min={1}
                value={packages}
                onChange={(e) => setPackages(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-notes">{t("shipments.notes")}</Label>
              <Textarea id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link to="/shipments">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
