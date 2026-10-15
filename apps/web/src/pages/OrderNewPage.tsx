import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  orderCreateSchema,
  type OrderDetailDto,
  type PartnerDto,
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

interface Line {
  description: string;
  quantity: string;
  weightKg: string;
}

export function OrderNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<PartnerDto[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [delivery, setDelivery] = useState({
    deliveryLine1: "",
    deliveryCity: "",
    deliveryPostalCode: "",
    deliveryCountry: "PT",
  });
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", weightKg: "" }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "customer", active: "true", pageSize: 100 },
    })
      .then((r) => setCustomers(r.items))
      .catch((e) => toast.error(e.message));
  }, []);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      customerId,
      requestedDate: requestedDate || undefined,
      notes: notes || undefined,
      deliveryLine1: delivery.deliveryLine1 || undefined,
      deliveryCity: delivery.deliveryCity || undefined,
      deliveryPostalCode: delivery.deliveryPostalCode || undefined,
      deliveryCountry: delivery.deliveryCountry || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity) || 1,
        weightKg: l.weightKg ? Number(l.weightKg) : undefined,
      })),
    };
    const parsed = orderCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ order: OrderDetailDto }>("/api/orders", {
        method: "POST",
        body: parsed.data,
      });
      toast.success(t("orders.created", { number: res.order.number }));
      navigate(`/orders/${res.order.id}`);
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
          <Link to="/orders">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("orders.new")}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orders.customer")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("orders.customer")}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger data-testid="order-customer">
                  <SelectValue placeholder={t("orders.selectCustomer")} />
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="o-date">{t("orders.requestedDate")}</Label>
                <Input
                  id="o-date"
                  type="date"
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orders.deliveryAddress")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="o-addr">{t("partners.address")}</Label>
              <Input
                id="o-addr"
                value={delivery.deliveryLine1}
                onChange={(e) =>
                  setDelivery((d) => ({ ...d, deliveryLine1: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-city">{t("partners.city")}</Label>
              <Input
                id="o-city"
                value={delivery.deliveryCity}
                onChange={(e) =>
                  setDelivery((d) => ({ ...d, deliveryCity: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-postal">{t("partners.postalCode")}</Label>
              <Input
                id="o-postal"
                value={delivery.deliveryPostalCode}
                onChange={(e) =>
                  setDelivery((d) => ({ ...d, deliveryPostalCode: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-country">{t("partners.country")}</Label>
              <Input
                id="o-country"
                maxLength={2}
                value={delivery.deliveryCountry}
                onChange={(e) =>
                  setDelivery((d) => ({
                    ...d,
                    deliveryCountry: e.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("orders.lines")}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((ls) => [...ls, { description: "", quantity: "1", weightKg: "" }])
              }
            >
              <Plus className="h-4 w-4" />
              {t("orders.addLine")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2" data-testid={`order-line-${i}`}>
                <div className="min-w-48 flex-1 space-y-1.5">
                  <Label htmlFor={`line-desc-${i}`}>{t("orders.description")}</Label>
                  <Input
                    id={`line-desc-${i}`}
                    required
                    value={line.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                </div>
                <div className="w-24 space-y-1.5">
                  <Label htmlFor={`line-qty-${i}`}>{t("orders.quantity")}</Label>
                  <Input
                    id={`line-qty-${i}`}
                    type="number"
                    min={1}
                    required
                    value={line.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </div>
                <div className="w-28 space-y-1.5">
                  <Label htmlFor={`line-w-${i}`}>{t("orders.weightKg")}</Label>
                  <Input
                    id={`line-w-${i}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.weightKg}
                    onChange={(e) => setLine(i, { weightKg: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 pt-6">
            <Label htmlFor="o-notes">{t("partners.notes")}</Label>
            <Textarea id="o-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link to="/orders">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
