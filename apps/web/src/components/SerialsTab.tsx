import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ItemSerialDto } from "@transitum/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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

/** Números de série — estado e armazém de cada unidade física. */
export function SerialsTab() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [serials, setSerials] = useState<ItemSerialDto[] | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ items: ItemSerialDto[] }>("/api/stock/serials", {
      params: { q: q || undefined, status: status || undefined },
    });
    setSerials(r.items);
  }, [q, status]);

  useEffect(() => {
    const id = setTimeout(() => load().catch((e) => toast.error(e.message)), 200);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-64"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={status} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("inventory.serials.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inventory.serials.allStatuses")}</SelectItem>
            <SelectItem value="in_stock">{t("inventory.serials.in_stock")}</SelectItem>
            <SelectItem value="issued">{t("inventory.serials.issued")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.serials.serial")}</TableHead>
              <TableHead>{t("inventory.items.sku")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("inventory.stock.item")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("inventory.stock.warehouse")}</TableHead>
              <TableHead>{t("inventory.serials.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!serials ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : serials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("inventory.serials.empty")}
                </TableCell>
              </TableRow>
            ) : (
              serials.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs font-medium">{s.serial}</TableCell>
                  <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.itemName}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {s.warehouseCode}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "in_stock" ? "success" : "secondary"}>
                      {t(`inventory.serials.${s.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
