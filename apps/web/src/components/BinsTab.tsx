import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import {
  type ItemDto,
  type StockBinLevelDto,
  type StockReconciliationDto,
  type WarehouseDto,
  type WarehouseLocationDto,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** Stock físico por bin + transferência bin-to-bin no mesmo armazém. */
export function BinsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [levels, setLevels] = useState<StockBinLevelDto[] | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [recon, setRecon] = useState<StockReconciliationDto[] | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) {
      setLevels([]);
      return;
    }
    const r = await api<{ items: StockBinLevelDto[] }>("/api/stock/bin-levels", {
      params: { warehouseId },
    });
    setLevels(r.items);
  }, [warehouseId]);

  useEffect(() => {
    api<{ items: WarehouseDto[] }>("/api/warehouses", { params: { pageSize: 100 } })
      .then((r) => {
        setWarehouses(r.items);
        if (r.items[0]) setWarehouseId(r.items[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("inventory.stock.selectWarehouse")} />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!warehouseId}
            onClick={async () => {
              try {
                const r = await api<{ items: StockReconciliationDto[] }>(
                  "/api/stock/reconciliation",
                  { params: { warehouseId, discrepantOnly: "true" } },
                );
                setRecon(r.items);
                if (r.items.length === 0) toast.success(t("inventory.bins.reconOk"));
              } catch (err) {
                toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
              }
            }}
          >
            {t("inventory.bins.reconcile")}
          </Button>
          {can("inventory:write") && (
            <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)} disabled={!warehouseId}>
              <ArrowRightLeft className="h-4 w-4" />
              {t("inventory.bins.transfer")}
            </Button>
          )}
        </div>
      </div>
      {recon && recon.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5">
          <p className="px-4 pt-3 text-sm font-medium text-destructive">
            {t("inventory.bins.reconTitle", { count: recon.length })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("inventory.items.sku")}</TableHead>
                <TableHead>{t("inventory.stock.item")}</TableHead>
                <TableHead className="text-right">{t("inventory.stock.onHand")}</TableHead>
                <TableHead className="text-right">{t("inventory.bins.reconBins")}</TableHead>
                <TableHead className="text-right">{t("inventory.bins.reconLots")}</TableHead>
                <TableHead className="text-right">{t("inventory.bins.reconSerials")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recon.map((r) => (
                <TableRow key={r.itemId}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.itemName}</TableCell>
                  <TableCell className="text-right">{r.onHand}</TableCell>
                  <TableCell className="text-right">
                    {r.binsOnHand ?? "—"}
                    {r.binDiff ? (
                      <span className="text-destructive"> ({r.binDiff > 0 ? "+" : ""}{r.binDiff})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.lotsOnHand ?? "—"}
                    {r.lotDiff ? (
                      <span className="text-destructive"> ({r.lotDiff > 0 ? "+" : ""}{r.lotDiff})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.serialsInStock ?? "—"}
                    {r.serialDiff ? (
                      <span className="text-destructive"> ({r.serialDiff > 0 ? "+" : ""}{r.serialDiff})</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.bins.location")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("inventory.locations.zone")}</TableHead>
              <TableHead>{t("inventory.items.sku")}</TableHead>
              <TableHead>{t("inventory.stock.item")}</TableHead>
              <TableHead className="text-right">{t("inventory.stock.onHand")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!levels ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : levels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("inventory.bins.empty")}
                </TableCell>
              </TableRow>
            ) : (
              levels.map((b) => (
                <TableRow key={`${b.locationId}-${b.itemId}`}>
                  <TableCell className="font-mono text-xs font-medium">{b.locationCode}</TableCell>
                  <TableCell className="hidden md:table-cell">{b.zone ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                  <TableCell>{b.itemName}</TableCell>
                  <TableCell className="text-right font-medium">{b.onHand}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {transferOpen && (
        <BinTransferDialog
          open
          onOpenChange={setTransferOpen}
          warehouseId={warehouseId}
          onDone={load}
        />
      )}
    </div>
  );
}

function BinTransferDialog({
  open,
  onOpenChange,
  warehouseId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [itemsList, setItemsList] = useState<ItemDto[]>([]);
  const [locations, setLocations] = useState<WarehouseLocationDto[]>([]);
  const [form, setForm] = useState({
    itemId: "",
    fromLocationId: "",
    toLocationId: "",
    quantity: "1",
    serials: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: ItemDto[] }>("/api/items", { params: { active: "true", pageSize: 100 } })
      .then((r) => setItemsList(r.items))
      .catch(() => {});
    api<{ items: WarehouseLocationDto[] }>(`/api/warehouses/${warehouseId}/locations`)
      .then((r) => setLocations(r.items.filter((l) => l.active)))
      .catch(() => {});
  }, [warehouseId]);

  const selectedItem = itemsList.find((it) => it.id === form.itemId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/stock/bin-transfer", {
        method: "POST",
        body: {
          itemId: form.itemId,
          warehouseId,
          fromLocationId: form.fromLocationId,
          toLocationId: form.toLocationId,
          quantity: Number(form.quantity),
          serials:
            selectedItem?.serialized && form.serials.trim()
              ? form.serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
              : undefined,
        },
      });
      toast.success(t("inventory.bins.moved"));
      onOpenChange(false);
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inventory.bins.transfer")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("inventory.movements.item")}</Label>
            <Select value={form.itemId} onValueChange={(v) => setForm((f) => ({ ...f, itemId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder={t("inventory.movements.selectItem")} />
              </SelectTrigger>
              <SelectContent>
                {itemsList.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.sku} — {it.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("inventory.bins.from")}</Label>
              <Select
                value={form.fromLocationId}
                onValueChange={(v) => setForm((f) => ({ ...f, fromLocationId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("inventory.bins.to")}</Label>
              <Select
                value={form.toLocationId}
                onValueChange={(v) => setForm((f) => ({ ...f, toLocationId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("inventory.movements.quantity")}</Label>
            <Input
              type="number"
              min="1"
              required
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </div>
          {selectedItem?.serialized && (
            <div className="space-y-1.5">
              <Label>{t("inventory.serials.list")}</Label>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                placeholder={t("inventory.serials.hint", { count: Number(form.quantity) || 0 })}
                value={form.serials}
                onChange={(e) => setForm((f) => ({ ...f, serials: e.target.value }))}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                loading ||
                !form.itemId ||
                !form.fromLocationId ||
                !form.toLocationId ||
                form.fromLocationId === form.toLocationId
              }
            >
              {loading ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
