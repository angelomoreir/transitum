import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  SHIPMENT_STATUSES,
  type ShipmentDto,
  type ShipmentStatus,
} from "@blujay/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 20;

export const SHIPMENT_STATUS_VARIANT: Record<
  ShipmentStatus,
  "secondary" | "default" | "warning" | "success" | "destructive"
> = {
  draft: "secondary",
  planned: "default",
  in_transit: "warning",
  delivered: "success",
  cancelled: "destructive",
};

export function ShipmentsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: ShipmentDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await api<{ items: ShipmentDto[]; total: number }>("/api/shipments", {
      params: { page, pageSize: PAGE_SIZE, q, status: status || undefined },
    });
    setData(res);
  }, [page, q, status]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("shipments.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("shipments.subtitle")}</p>
        </div>
        {can("shipments:write") && (
          <Button asChild>
            <Link to="/shipments/new">
              <Plus className="h-4 w-4" />
              {t("shipments.new")}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-64"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("shipments.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("shipments.allStatuses")}</SelectItem>
            {SHIPMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`shipments.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("shipments.number")}</TableHead>
              <TableHead>{t("shipments.customer")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("shipments.carrier")}</TableHead>
              <TableHead>{t("shipments.status")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("shipments.delivery")}</TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("shipments.plannedDelivery")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {t("shipments.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((s) => (
                <TableRow key={s.id} data-testid={`shipment-${s.number}`}>
                  <TableCell>
                    <Link
                      to={`/shipments/${s.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {s.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{s.customerName}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.carrierName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={SHIPMENT_STATUS_VARIANT[s.status]}>
                      {t(`shipments.statuses.${s.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {s.deliveryAddress.city}, {s.deliveryAddress.country}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {s.plannedDeliveryAt
                      ? new Date(s.plannedDeliveryAt).toLocaleDateString("pt-PT")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("common.results", { count: data?.total ?? 0 })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <span>{t("common.page", { page })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
