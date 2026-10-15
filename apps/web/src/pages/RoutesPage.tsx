import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ROUTE_STATUSES, type RouteDto, type RouteStatus } from "@blujay/shared";
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

export const ROUTE_STATUS_VARIANT: Record<
  RouteStatus,
  "secondary" | "warning" | "success" | "destructive"
> = {
  draft: "secondary",
  dispatched: "warning",
  completed: "success",
  cancelled: "destructive",
};

export function RoutesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: RouteDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await api<{ items: RouteDto[]; total: number }>("/api/routes", {
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
          <h1 className="text-2xl font-semibold">{t("routes.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("routes.subtitle")}</p>
        </div>
        {can("routes:write") && (
          <Button asChild>
            <Link to="/routes/new">
              <Plus className="h-4 w-4" />
              {t("routes.new")}
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
            <SelectValue placeholder={t("routes.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("routes.allStatuses")}</SelectItem>
            {ROUTE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`routes.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("routes.number")}</TableHead>
              <TableHead>{t("routes.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("routes.carrier")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("routes.driver")}</TableHead>
              <TableHead>{t("orders.status")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("routes.stops")}</TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("routes.plannedStart")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {t("routes.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((r) => (
                <TableRow key={r.id} data-testid={`route-${r.number}`}>
                  <TableCell>
                    <Link
                      to={`/routes/${r.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.carrierName ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {[r.driverName, r.vehicleRef].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ROUTE_STATUS_VARIANT[r.status]}>
                      {t(`routes.statuses.${r.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {t("routes.stopCount", { done: r.doneStops, total: r.stopCount })}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {r.plannedStartAt
                      ? new Date(r.plannedStartAt).toLocaleString("pt-PT")
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
