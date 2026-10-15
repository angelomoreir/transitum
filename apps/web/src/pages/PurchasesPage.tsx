import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  PO_STATUSES,
  type PoStatus,
  type PurchaseOrderDto,
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

export const PO_STATUS_VARIANT: Record<
  PoStatus,
  "secondary" | "warning" | "success" | "destructive"
> = {
  draft: "secondary",
  sent: "warning",
  partially_received: "warning",
  received: "success",
  cancelled: "destructive",
};

export function PurchasesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: PurchaseOrderDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await api<{ items: PurchaseOrderDto[]; total: number }>(
      "/api/purchase-orders",
      { params: { page, pageSize: PAGE_SIZE, q, status: status || undefined } },
    );
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
          <h1 className="text-2xl font-semibold">{t("purchases.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("purchases.subtitle")}</p>
        </div>
        {can("purchases:write") && (
          <Button asChild>
            <Link to="/purchases/new">
              <Plus className="h-4 w-4" />
              {t("purchases.new")}
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
          <SelectTrigger className="w-52">
            <SelectValue placeholder={t("purchases.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("purchases.allStatuses")}</SelectItem>
            {PO_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`purchases.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("purchases.number")}</TableHead>
              <TableHead>{t("purchases.supplier")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("purchases.warehouse")}</TableHead>
              <TableHead>{t("orders.status")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                {t("purchases.quantity")}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("purchases.expectedDate")}
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
                  {t("purchases.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((p) => (
                <TableRow key={p.id} data-testid={`po-${p.number}`}>
                  <TableCell>
                    <Link
                      to={`/purchases/${p.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {p.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{p.supplierName}</TableCell>
                  <TableCell className="hidden md:table-cell">{p.warehouseName}</TableCell>
                  <TableCell>
                    <Badge variant={PO_STATUS_VARIANT[p.status]}>
                      {t(`purchases.statuses.${p.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">
                    {t("purchases.progress", { received: p.receivedQty, total: p.totalQty })}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {p.expectedDate ?? "—"}
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.previous")}
          </Button>
          <span>{t("common.page", { page })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
