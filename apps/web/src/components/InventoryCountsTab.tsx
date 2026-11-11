import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ClipboardList, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type {
  CountLineDto,
  CountStatus,
  InventoryCountDetailDto,
  InventoryCountDto,
  ItemDto,
  WarehouseDto,
} from "@transitum/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const STATUS_VARIANT: Record<CountStatus, "secondary" | "success" | "destructive" | "warning"> = {
  open: "warning",
  applied: "success",
  cancelled: "destructive",
};

/** Separador de contagens físicas: criar, registar quantidades e aplicar ajustes. */
export function InventoryCountsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: InventoryCountDto[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<ItemDto[]>([]);
  const [detail, setDetail] = useState<InventoryCountDetailDto | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const write = can("inventory:write");

  const load = useCallback(async () => {
    setData(
      await api<{ items: InventoryCountDto[]; total: number }>("/api/inventory-counts", {
        params: { page, pageSize: PAGE_SIZE },
      }),
    );
  }, [page]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  useEffect(() => {
    api<{ items: WarehouseDto[] }>("/api/warehouses", { params: { pageSize: 100, active: "true" } })
      .then((r) => setWarehouses(r.items))
      .catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    const res = await api<{ count: InventoryCountDetailDto }>(`/api/inventory-counts/${id}`);
    setDetail(res.count);
    setCounts(
      Object.fromEntries(
        res.count.lines.map((l) => [l.itemId, l.countedQty != null ? String(l.countedQty) : ""]),
      ),
    );
    setSerials(
      Object.fromEntries(
        res.count.lines.map((l) => [l.itemId, (l.countedSerials ?? []).join("\n")]),
      ),
    );
  };

  const createCount = async () => {
    setBusy(true);
    try {
      const res = await api<{ count: InventoryCountDetailDto }>("/api/inventory-counts", {
        method: "POST",
        body: {
          warehouseId,
          itemIds: scope === "selected" ? [...selectedIds] : undefined,
        },
      });
      setNewOpen(false);
      setWarehouseId("");
      setScope("all");
      setSelectedIds(new Set());
      await load();
      setDetail(res.count);
      setCounts(Object.fromEntries(res.count.lines.map((l) => [l.itemId, ""])));
      setSerials(Object.fromEntries(res.count.lines.map((l) => [l.itemId, ""])));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const parseSerials = (v: string) =>
    [...new Set(v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];

  /** Guarda as quantidades introduzidas; devolve false em erro. */
  const persistLines = async (): Promise<boolean> => {
    if (!detail) return false;
    const lines = detail.lines.flatMap((l) => {
      if (l.serialized) {
        const list = parseSerials(serials[l.itemId] ?? "");
        if (l.countedSerials == null && list.length === 0) return [];
        return [{ itemId: l.itemId, countedQty: list.length, serials: list }];
      }
      const v = counts[l.itemId];
      return v === "" || v === undefined ? [] : [{ itemId: l.itemId, countedQty: Number(v) }];
    });
    if (lines.length === 0) return true;
    const res = await api<{ count: InventoryCountDetailDto }>(
      `/api/inventory-counts/${detail.id}/lines`,
      { method: "PATCH", body: { lines } },
    );
    setDetail(res.count);
    return true;
  };

  const saveLines = async () => {
    setBusy(true);
    try {
      if (await persistLines()) {
        toast.success(t("counts.saved"));
        await load();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      if (!(await persistLines())) return;
      const res = await api<{ count: InventoryCountDetailDto }>(
        `/api/inventory-counts/${detail.id}/apply`,
        { method: "POST" },
      );
      setDetail(res.count);
      toast.success(t("counts.applied"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api(`/api/inventory-counts/${detail.id}/cancel`, { method: "POST" });
      setDetail(null);
      toast.success(t("counts.cancelled"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const open = detail?.status === "open";
  const allCounted = detail?.lines.every((l) =>
    l.serialized
      ? parseSerials(serials[l.itemId] ?? "").length > 0 || l.countedSerials != null
      : counts[l.itemId] !== "" || l.countedQty != null,
  );

  const lineVariance = (l: CountLineDto) => {
    if (l.serialized) {
      const list = parseSerials(serials[l.itemId] ?? "");
      if (list.length > 0) return list.length - l.expectedQty;
      return l.variance;
    }
    const v = counts[l.itemId];
    if (v !== "" && v !== undefined) return Number(v) - l.expectedQty;
    return l.variance;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("counts.subtitle")}</p>
        {write && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("counts.new")}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("counts.number")}</TableHead>
              <TableHead>{t("counts.warehouse")}</TableHead>
              <TableHead>{t("counts.progress")}</TableHead>
              <TableHead>{t("counts.status")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("counts.createdAt")}</TableHead>
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
                  {t("counts.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetail(c.id)}>
                  <TableCell className="font-mono text-xs font-medium text-primary">
                    {c.number}
                  </TableCell>
                  <TableCell>{c.warehouseName}</TableCell>
                  <TableCell>
                    {c.countedLines}/{c.lineCount}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{t(`counts.statuses.${c.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {c.createdAt.slice(0, 10)}
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

      {/* Nova contagem */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("counts.new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={t("counts.selectWarehouse")} />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v as "all" | "selected");
                if (v === "selected" && catalog.length === 0) {
                  api<{ items: ItemDto[] }>("/api/items", {
                    params: { pageSize: 200, active: "true" },
                  })
                    .then((r) => setCatalog(r.items))
                    .catch(() => {});
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("counts.scopeAll")}</SelectItem>
                <SelectItem value="selected">{t("counts.scopeSelected")}</SelectItem>
              </SelectContent>
            </Select>
            {scope === "selected" && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {catalog.length === 0 ? (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    {t("common.loading")}
                  </p>
                ) : (
                  catalog.map((it) => (
                    <label
                      key={it.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={selectedIds.has(it.id)}
                        onChange={(e) =>
                          setSelectedIds((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(it.id);
                            else next.delete(it.id);
                            return next;
                          })
                        }
                      />
                      <span className="font-mono text-xs">{it.sku}</span>
                      <span className="truncate">{it.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t(scope === "all" ? "counts.newHint" : "counts.selectedHint", {
                count: selectedIds.size,
              })}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={createCount}
              disabled={busy || !warehouseId || (scope === "selected" && selectedIds.size === 0)}
            >
              {busy ? t("common.loading") : t("counts.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhe / registo da contagem */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {detail?.number} — {detail?.warehouseName}
              {detail && (
                <Badge variant={STATUS_VARIANT[detail.status]}>
                  {t(`counts.statuses.${detail.status}`)}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("counts.sku")}</TableHead>
                  <TableHead>{t("counts.item")}</TableHead>
                  <TableHead className="text-right">{t("counts.expected")}</TableHead>
                  <TableHead className="w-28 text-right">{t("counts.counted")}</TableHead>
                  <TableHead className="text-right">{t("counts.variance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail?.lines.map((l) => {
                  const variance = lineVariance(l);
                  return (
                    <TableRow key={l.itemId}>
                      <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                      <TableCell>{l.itemName}</TableCell>
                      <TableCell className="text-right">{l.expectedQty}</TableCell>
                      <TableCell className="text-right">
                        {l.serialized ? (
                          open && write ? (
                            <div className="space-y-1 text-left">
                              <textarea
                                className="h-16 w-48 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
                                placeholder={t("counts.serialsHint")}
                                value={serials[l.itemId] ?? ""}
                                onChange={(e) =>
                                  setSerials((s) => ({ ...s, [l.itemId]: e.target.value }))
                                }
                              />
                              {l.expectedSerials && l.expectedSerials.length > 0 && (
                                <p className="text-[10px] text-muted-foreground">
                                  {t("counts.expectedSerials", {
                                    list: l.expectedSerials.join(", "),
                                  })}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="text-left font-mono text-xs">
                              {(l.countedSerials ?? []).join(", ") || (l.countedQty ?? "—")}
                            </div>
                          )
                        ) : open && write ? (
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-24 text-right"
                            value={counts[l.itemId] ?? ""}
                            onChange={(e) =>
                              setCounts((c) => ({ ...c, [l.itemId]: e.target.value }))
                            }
                          />
                        ) : (
                          (l.countedQty ?? "—")
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${variance != null && variance !== 0 ? "text-destructive" : ""}`}
                      >
                        {variance == null ? "—" : variance > 0 ? `+${variance}` : variance}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {open && write && (
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={cancel} disabled={busy}>
                <X className="h-4 w-4" />
                {t("counts.cancel")}
              </Button>
              <Button variant="outline" onClick={saveLines} disabled={busy}>
                {t("counts.save")}
              </Button>
              <Button onClick={apply} disabled={busy || !allCounted} title={!allCounted ? t("counts.allCountedHint") : undefined}>
                <Check className="h-4 w-4" />
                {t("counts.apply")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
