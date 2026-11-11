import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { StockLotDto, WarehouseDto } from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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

const EXPIRY_FILTERS = [7, 30, 90] as const;

function expiryBadge(days: number | null, t: TFunction) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days <= 0) return <Badge variant="destructive">{t("inventory.lots.expired")}</Badge>;
  if (days <= 30) {
    return <Badge variant="warning">{t("inventory.lots.daysLeft", { days })}</Badge>;
  }
  return <Badge variant="secondary">{t("inventory.lots.daysLeft", { days })}</Badge>;
}

/** Lotes com validade — vista FEFO ordenada por data de expiração. */
export function LotsTab() {
  const { t } = useTranslation();
  const [warehouseId, setWarehouseId] = useState("");
  const [expiring, setExpiring] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [lots, setLots] = useState<StockLotDto[] | null>(null);

  useEffect(() => {
    api<{ items: WarehouseDto[] }>("/api/warehouses", {
      params: { active: "true", pageSize: 100 },
    })
      .then((r) => setWarehouses(r.items))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: StockLotDto[] }>("/api/stock/lots", {
        params: {
          warehouseId: warehouseId || undefined,
          expiringDays: expiring || undefined,
        },
      });
      setLots(res.items);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [warehouseId, expiring, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={warehouseId} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("inventory.lots.allWarehouses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inventory.lots.allWarehouses")}</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={expiring} onValueChange={(v) => setExpiring(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("inventory.lots.anyExpiry")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inventory.lots.anyExpiry")}</SelectItem>
            {EXPIRY_FILTERS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {t("inventory.lots.expiringIn", { days: d })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.lots.code")}</TableHead>
              <TableHead>{t("inventory.movements.item")}</TableHead>
              <TableHead>{t("inventory.movements.warehouse")}</TableHead>
              <TableHead>{t("inventory.lots.expiresAt")}</TableHead>
              <TableHead>{t("inventory.lots.expiry")}</TableHead>
              <TableHead className="text-right">{t("inventory.lots.onHand")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!lots ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : lots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {t("inventory.lots.empty")}
                </TableCell>
              </TableRow>
            ) : (
              lots.map((l) => (
                <TableRow key={l.id} data-testid={`lot-${l.code}`}>
                  <TableCell className="font-mono text-xs font-medium">{l.code}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{l.sku}</span> {l.itemName}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.warehouseCode}</TableCell>
                  <TableCell>
                    {l.expiresAt
                      ? new Date(`${l.expiresAt}T00:00:00`).toLocaleDateString("pt-PT")
                      : "—"}
                  </TableCell>
                  <TableCell>{expiryBadge(l.daysToExpiry, t)}</TableCell>
                  <TableCell className="text-right font-medium">{l.onHand}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{t("inventory.lots.hint")}</p>
    </div>
  );
}
