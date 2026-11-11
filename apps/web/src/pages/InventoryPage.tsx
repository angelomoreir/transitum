import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileUp, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  itemCreateSchema,
  MOVEMENT_TYPES,
  movementCreateSchema,
  type ItemDto,
  type MovementType,
  type StockAlertDto,
  type StockLevelDto,
  type StockMovementDto,
  type WarehouseDto,
  type WarehouseLocationDto,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BinsTab } from "@/components/BinsTab";
import { CsvImportDialog } from "@/components/CsvImportDialog";
import { InventoryCountsTab } from "@/components/InventoryCountsTab";
import { LocationsTab } from "@/components/LocationsTab";
import { LotsTab } from "@/components/LotsTab";
import { SerialsTab } from "@/components/SerialsTab";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const PAGE_SIZE = 20;
type Tab =
  | "items"
  | "stock"
  | "movements"
  | "lots"
  | "bins"
  | "serials"
  | "counts"
  | "locations";

const MOVEMENT_VARIANT: Record<MovementType, "success" | "destructive" | "warning" | "secondary"> = {
  in: "success",
  out: "destructive",
  adjust: "warning",
  transfer: "secondary",
};

export function InventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("items");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("inventory.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("inventory.subtitle")}</p>
      </div>
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {(["items", "stock", "movements", "lots", "bins", "serials", "counts", "locations"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            data-testid={`tab-${tb}`}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === tb
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t(`inventory.tabs.${tb}`)}
          </button>
        ))}
      </div>
      {tab === "items" && <ItemsTab />}
      {tab === "stock" && <StockTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "lots" && <LotsTab />}
      {tab === "bins" && <BinsTab />}
      {tab === "serials" && <SerialsTab />}
      {tab === "counts" && <InventoryCountsTab />}
      {tab === "locations" && <LocationsTab />}
    </div>
  );
}

function useList<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  deps: unknown[],
) {
  const [data, setData] = useState<{ items: T[]; total: number } | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    const res = await api<{ items: T[]; total: number }>(path, { params });
    setData(res);
  }, deps);
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);
  return { data, reload: load };
}

function Pagination({ page, setPage, total }: { page: number; setPage: (f: (p: number) => number) => void; total: number }) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>{t("common.results", { count: total })}</span>
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
  );
}

// ── Artigos ─────────────────────────────────────────────────────────────────

function ItemsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<ItemDto | null>(null);
  const { data, reload } = useList<ItemDto>(
    "/api/items",
    { page, pageSize: PAGE_SIZE, q },
    [page, q],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          className="max-w-64"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {can("inventory:write") && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <FileUp className="h-4 w-4" />
              {t("import.title")}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t("inventory.items.new")}
            </Button>
          </div>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.items.sku")}</TableHead>
              <TableHead>{t("inventory.items.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("inventory.items.unit")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                {t("inventory.items.weightKg")}
              </TableHead>
              <TableHead className="text-right">{t("inventory.items.totalStock")}</TableHead>
              <TableHead>{t("inventory.items.active")}</TableHead>
              <TableHead className="w-10" />
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
                  {t("inventory.items.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((it) => (
                <TableRow key={it.id} data-testid={`item-${it.sku}`}>
                  <TableCell className="font-mono text-xs font-medium">{it.sku}</TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{it.unit}</TableCell>
                  <TableCell className="hidden md:table-cell text-right">
                    {it.weightKg ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{it.totalStock}</TableCell>
                  <TableCell>
                    <Badge variant={it.active ? "success" : "secondary"}>
                      {it.active ? t("warehouses.active") : t("warehouses.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {can("inventory:write") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(it)}>
                            <Pencil className="h-4 w-4" />
                            {t("inventory.items.edit")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} setPage={setPage} total={data?.total ?? 0} />
      {creating && <ItemForm open onOpenChange={setCreating} onDone={reload} />}
      {importing && (
        <CsvImportDialog
          open
          onOpenChange={setImporting}
          endpoint="/api/items/import"
          template={t("import.templates.items")}
          onDone={reload}
        />
      )}
      {editing && (
        <ItemForm open onOpenChange={(o) => !o && setEditing(null)} item={editing} onDone={reload} />
      )}
    </div>
  );
}

function ItemForm({
  open,
  onOpenChange,
  item,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ItemDto;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    sku: item?.sku ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    unit: item?.unit ?? "un",
    weightKg: item?.weightKg != null ? String(item.weightKg) : "",
    serialized: item?.serialized ?? false,
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      sku: form.sku,
      name: form.name,
      description: form.description || undefined,
      unit: form.unit,
      weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      serialized: form.serialized,
    };
    const parsed = itemCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      if (item) {
        await api(`/api/items/${item.id}`, { method: "PATCH", body: parsed.data });
        toast.success(t("inventory.items.updated"));
      } else {
        await api("/api/items", { method: "POST", body: parsed.data });
        toast.success(t("inventory.items.created", { sku: parsed.data.sku }));
      }
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
          <DialogTitle>{item ? t("inventory.items.edit") : t("inventory.items.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="it-sku">{t("inventory.items.sku")}</Label>
              <Input
                id="it-sku"
                required
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="it-unit">{t("inventory.items.unit")}</Label>
              <Input
                id="it-unit"
                required
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="it-name">{t("inventory.items.name")}</Label>
            <Input
              id="it-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="it-desc">{t("inventory.items.description")}</Label>
            <Input
              id="it-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="it-weight">{t("inventory.items.weightKg")}</Label>
            <Input
              id="it-weight"
              type="number"
              min={0}
              step="0.01"
              value={form.weightKg}
              onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.serialized}
              onChange={(e) => setForm((f) => ({ ...f, serialized: e.target.checked }))}
            />
            {t("inventory.items.serialized")}
          </label>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────

function StockTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [alerts, setAlerts] = useState<StockAlertDto[]>([]);
  const [reorderTarget, setReorderTarget] = useState<StockLevelDto | null>(null);
  const { data, reload } = useList<StockLevelDto>(
    "/api/stock",
    { page, pageSize: PAGE_SIZE, warehouseId: warehouseId || undefined, q },
    [page, warehouseId, q],
  );

  const loadAlerts = useCallback(() => {
    api<{ items: StockAlertDto[] }>("/api/stock/alerts")
      .then((r) => setAlerts(r.items))
      .catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    api<{ items: WarehouseDto[] }>("/api/warehouses", { params: { pageSize: 100 } })
      .then((r) => setWarehouses(r.items))
      .catch(() => setWarehouses([]));
    loadAlerts();
  }, [loadAlerts]);

  const onReorderDone = async () => {
    await reload();
    loadAlerts();
  };

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("inventory.stock.lowStock")}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="stock-alerts">
            {alerts.map((a) => (
              <li
                key={`${a.warehouseId}-${a.itemId}`}
                className="rounded-md border border-amber-200 bg-card px-2 py-1 text-xs"
              >
                <span className="font-mono font-medium">{a.sku}</span> — {a.warehouseCode}:{" "}
                {a.available}/{a.reorderPoint} {a.unit}
                <span className="ml-1 text-destructive">
                  ({t("inventory.stock.deficit", { count: a.deficit })})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Select
          value={warehouseId}
          onValueChange={(v) => {
            setWarehouseId(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("inventory.stock.allWarehouses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inventory.stock.allWarehouses")}</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="max-w-64"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.items.sku")}</TableHead>
              <TableHead>{t("inventory.stock.item")}</TableHead>
              <TableHead>{t("inventory.stock.warehouse")}</TableHead>
              <TableHead className="text-right">{t("inventory.stock.onHand")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                {t("inventory.stock.reserved")}
              </TableHead>
              <TableHead className="text-right">{t("inventory.stock.available")}</TableHead>
              <TableHead className="text-right">{t("inventory.stock.reorderPoint")}</TableHead>
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
                  {t("inventory.stock.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((s) => (
                <TableRow key={`${s.warehouseId}-${s.itemId}`}>
                  <TableCell className="font-mono text-xs font-medium">{s.sku}</TableCell>
                  <TableCell>{s.itemName}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{s.warehouseCode}</span> {s.warehouseName}
                  </TableCell>
                  <TableCell className="text-right font-medium" data-testid={`onhand-${s.warehouseCode}-${s.sku}`}>
                    {s.onHand} {s.unit}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">{s.reserved}</TableCell>
                  <TableCell className="text-right">{s.onHand - s.reserved}</TableCell>
                  <TableCell className="text-right">
                    {can("inventory:write") ? (
                      <button
                        className="rounded px-1 hover:bg-accent"
                        title={t("inventory.stock.setReorder")}
                        onClick={() => setReorderTarget(s)}
                      >
                        {s.reorderPoint ?? "—"}
                      </button>
                    ) : (
                      (s.reorderPoint ?? "—")
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} setPage={setPage} total={data?.total ?? 0} />
      {reorderTarget && (
        <ReorderDialog
          open
          onOpenChange={(o) => !o && setReorderTarget(null)}
          level={reorderTarget}
          onDone={onReorderDone}
        />
      )}
    </div>
  );
}

function ReorderDialog({
  open,
  onOpenChange,
  level,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: StockLevelDto;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(level.reorderPoint != null ? String(level.reorderPoint) : "");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/stock/reorder-point", {
        method: "PUT",
        body: {
          itemId: level.itemId,
          warehouseId: level.warehouseId,
          reorderPoint: value === "" ? null : Number(value),
        },
      });
      toast.success(t("inventory.stock.reorderSaved"));
      onOpenChange(false);
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("inventory.stock.setReorder")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {level.sku} · {level.warehouseName}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="rp">{t("inventory.stock.reorderPoint")}</Label>
            <Input
              id="rp"
              type="number"
              min={0}
              step={1}
              value={value}
              placeholder="—"
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Movimentos ──────────────────────────────────────────────────────────────

function MovementsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, reload } = useList<StockMovementDto>(
    "/api/movements",
    { page, pageSize: PAGE_SIZE, type: type || undefined },
    [page, type],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("inventory.movements.allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inventory.movements.allTypes")}</SelectItem>
            {MOVEMENT_TYPES.map((mt) => (
              <SelectItem key={mt} value={mt}>
                {t(`inventory.movements.types.${mt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {can("inventory:write") && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t("inventory.movements.new")}
          </Button>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.movements.date")}</TableHead>
              <TableHead>{t("inventory.movements.type")}</TableHead>
              <TableHead>{t("inventory.movements.item")}</TableHead>
              <TableHead className="text-right">{t("inventory.movements.quantity")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("inventory.movements.warehouse")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("inventory.movements.reference")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("inventory.lots.code")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("inventory.movements.by")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {t("inventory.movements.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString("pt-PT")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={MOVEMENT_VARIANT[m.type]}>
                      {t(`inventory.movements.types.${m.type}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{m.sku}</span> {m.itemName}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {m.type === "out" || (m.type === "adjust" && m.quantity < 0) ? "−" : "+"}
                    {Math.abs(m.quantity)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-xs">
                    {m.warehouseCode ?? "—"}
                    {m.locationCode && ` · ${m.locationCode}`}
                    {m.toWarehouseCode && ` → ${m.toWarehouseCode}`}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {m.reference ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell font-mono text-xs">
                    {m.lotCode ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {m.createdByName ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} setPage={setPage} total={data?.total ?? 0} />
      {creating && <MovementForm open onOpenChange={setCreating} onDone={reload} />}
    </div>
  );
}

function MovementForm({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [itemsList, setItemsList] = useState<ItemDto[]>([]);
  const [locations, setLocations] = useState<WarehouseLocationDto[]>([]);
  const [form, setForm] = useState({
    type: "in" as MovementType,
    itemId: "",
    quantity: "",
    warehouseId: "",
    toWarehouseId: "",
    locationId: "",
    reference: "",
    note: "",
    lotCode: "",
    lotExpiresAt: "",
    serials: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ items: WarehouseDto[] }>("/api/warehouses", {
      params: { active: "true", pageSize: 100 },
    }).then((r) => setWarehouses(r.items)).catch(() => {});
    api<{ items: ItemDto[] }>("/api/items", {
      params: { active: "true", pageSize: 100 },
    }).then((r) => setItemsList(r.items)).catch(() => {});
  }, [open]);

  // Bins do armazém selecionado (putaway / consumo dirigido)
  useEffect(() => {
    if (!form.warehouseId) {
      setLocations([]);
      return;
    }
    api<{ items: WarehouseLocationDto[] }>(`/api/warehouses/${form.warehouseId}/locations`)
      .then((r) => setLocations(r.items.filter((l) => l.active)))
      .catch(() => setLocations([]));
  }, [form.warehouseId]);

  const selectedItem = itemsList.find((it) => it.id === form.itemId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      type: form.type,
      itemId: form.itemId,
      quantity: Number(form.quantity),
      warehouseId: form.warehouseId || undefined,
      toWarehouseId: form.type === "transfer" ? form.toWarehouseId : undefined,
      locationId: form.type !== "transfer" && form.locationId ? form.locationId : undefined,
      reference: form.reference || undefined,
      note: form.note || undefined,
      lotCode: form.type === "in" && form.lotCode ? form.lotCode : undefined,
      lotExpiresAt:
        form.type === "in" && form.lotCode && form.lotExpiresAt
          ? form.lotExpiresAt
          : undefined,
      serials:
        selectedItem?.serialized && form.serials.trim()
          ? form.serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
          : undefined,
    };
    const parsed = movementCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      await api("/api/movements", { method: "POST", body: parsed.data });
      toast.success(t("inventory.movements.created"));
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
          <DialogTitle>{t("inventory.movements.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("inventory.movements.type")}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as MovementType }))}
              >
                <SelectTrigger data-testid="mov-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPES.map((mt) => (
                    <SelectItem key={mt} value={mt}>
                      {t(`inventory.movements.types.${mt}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-qty">{t("inventory.movements.quantity")}</Label>
              <Input
                id="mv-qty"
                type="number"
                required
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("inventory.movements.item")}</Label>
            <Select
              value={form.itemId}
              onValueChange={(v) => setForm((f) => ({ ...f, itemId: v }))}
            >
              <SelectTrigger data-testid="mov-item">
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
              <Label>{t("inventory.movements.warehouse")}</Label>
              <Select
                value={form.warehouseId}
                onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))}
              >
                <SelectTrigger data-testid="mov-warehouse">
                  <SelectValue placeholder={t("inventory.movements.selectWarehouse")} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.type === "transfer" && (
              <div className="space-y-1.5">
                <Label>{t("inventory.movements.toWarehouse")}</Label>
                <Select
                  value={form.toWarehouseId}
                  onValueChange={(v) => setForm((f) => ({ ...f, toWarehouseId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("inventory.movements.selectWarehouse")} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {form.type !== "transfer" && locations.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("inventory.bins.location")}</Label>
              <Select
                value={form.locationId || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, locationId: v === "none" ? "" : v }))}
              >
                <SelectTrigger data-testid="mov-location">
                  <SelectValue placeholder={t("inventory.bins.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("inventory.bins.none")}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code}
                      {l.zone ? ` (${l.zone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.type === "in" ? t("inventory.bins.putawayHint") : t("inventory.bins.pickHint")}
              </p>
            </div>
          )}
          {form.type === "in" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mv-lot">{t("inventory.lots.code")}</Label>
                <Input
                  id="mv-lot"
                  value={form.lotCode}
                  onChange={(e) => setForm((f) => ({ ...f, lotCode: e.target.value }))}
                  placeholder={t("inventory.lots.codeHint")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-lot-exp">{t("inventory.lots.expiresAt")}</Label>
                <Input
                  id="mv-lot-exp"
                  type="date"
                  value={form.lotExpiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, lotExpiresAt: e.target.value }))}
                />
              </div>
            </div>
          )}
          {selectedItem?.serialized && form.type !== "adjust" && (
            <div className="space-y-1.5">
              <Label htmlFor="mv-serials">{t("inventory.serials.list")}</Label>
              <textarea
                id="mv-serials"
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                placeholder={t("inventory.serials.hint", { count: Number(form.quantity) || 0 })}
                value={form.serials}
                onChange={(e) => setForm((f) => ({ ...f, serials: e.target.value }))}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mv-ref">{t("inventory.movements.reference")}</Label>
              <Input
                id="mv-ref"
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-note">{t("inventory.movements.note")}</Label>
              <Input
                id="mv-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
