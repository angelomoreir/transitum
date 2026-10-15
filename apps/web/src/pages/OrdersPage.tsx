import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ORDER_STATUSES, type OrderDto, type OrderStatus } from "@blujay/shared";
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

export const ORDER_STATUS_VARIANT: Record<
  OrderStatus,
  "secondary" | "success" | "destructive"
> = {
  draft: "secondary",
  confirmed: "success",
  cancelled: "destructive",
};

export function OrdersPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: OrderDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await api<{ items: OrderDto[]; total: number }>("/api/orders", {
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
          <h1 className="text-2xl font-semibold">{t("orders.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("orders.subtitle")}</p>
        </div>
        {can("orders:write") && (
          <Button asChild>
            <Link to="/orders/new">
              <Plus className="h-4 w-4" />
              {t("orders.new")}
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
            <SelectValue placeholder={t("orders.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("orders.allStatuses")}</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`orders.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("orders.number")}</TableHead>
              <TableHead>{t("orders.customer")}</TableHead>
              <TableHead>{t("orders.status")}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t("orders.requestedDate")}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("orders.deliveryAddress")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("orders.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((o) => (
                <TableRow key={o.id} data-testid={`order-${o.number}`}>
                  <TableCell>
                    <Link
                      to={`/orders/${o.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {o.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{o.customerName}</TableCell>
                  <TableCell>
                    <Badge variant={ORDER_STATUS_VARIANT[o.status]}>
                      {t(`orders.statuses.${o.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {o.requestedDate ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {[o.deliveryCity, o.deliveryCountry].filter(Boolean).join(", ") || "—"}
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
