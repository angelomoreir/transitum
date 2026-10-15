import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Truck } from "lucide-react";
import { toast } from "sonner";
import type { OrderDetailDto } from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DocumentsCard } from "@/components/DocumentsCard";
import { ORDER_STATUS_VARIANT } from "@/pages/OrdersPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function OrderDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ order: OrderDetailDto }>(`/api/orders/${id}`);
      setOrder(res.order);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
      else toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (status: "confirmed" | "cancelled") => {
    try {
      await api(`/api/orders/${id}`, { method: "PATCH", body: { status } });
      toast.success(t("partners.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  if (notFound) return <p className="text-muted-foreground">{t("common.notFound")}</p>;
  if (!order) return <Skeleton className="h-64 w-full" />;

  const address = [order.deliveryLine1, order.deliveryCity, order.deliveryPostalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/orders">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-mono text-2xl font-semibold">{order.number}</h1>
            <p className="text-sm text-muted-foreground">{order.customerName}</p>
          </div>
          <Badge variant={ORDER_STATUS_VARIANT[order.status]}>
            {t(`orders.statuses.${order.status}`)}
          </Badge>
        </div>
        <div className="flex gap-2">
          {can("orders:write") && order.status === "draft" && (
            <Button onClick={() => setStatus("confirmed")}>{t("orders.confirmOrder")}</Button>
          )}
          {can("shipments:write") && order.status === "confirmed" && (
            <Button variant="outline" asChild>
              <Link to={`/shipments/new?orderId=${order.id}&customerId=${order.customerId}`}>
                <Truck className="h-4 w-4" />
                {t("orders.createShipment")}
              </Link>
            </Button>
          )}
          {can("orders:write") && order.status !== "cancelled" && (
            <Button variant="outline" onClick={() => setStatus("cancelled")}>
              {t("orders.cancelOrder")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orders.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t("orders.requestedDate")} value={order.requestedDate ?? "—"} />
            <Row label={t("orders.deliveryAddress")} value={address || "—"} />
            <Row label={t("partners.country")} value={order.deliveryCountry ?? "—"} />
            <Row
              label={t("dashboard.title")}
              value={new Date(order.createdAt).toLocaleString("pt-PT")}
            />
            {order.notes && <Row label={t("partners.notes")} value={order.notes} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orders.linkedShipments")}</CardTitle>
          </CardHeader>
          <CardContent>
            {order.shipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shipments.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {order.shipments.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/shipments/${s.id}`}
                      className="font-mono text-sm text-primary hover:underline"
                    >
                      {s.number}
                    </Link>{" "}
                    <Badge variant="secondary">{t(`shipments.statuses.${s.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("orders.lines")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t("orders.description")}</TableHead>
                <TableHead className="w-24">{t("orders.quantity")}</TableHead>
                <TableHead className="w-28">{t("orders.weightKg")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.lineNo}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell>{l.quantity}</TableCell>
                  <TableCell>{l.weightKg ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DocumentsCard entityType="order" entityId={order.id} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
