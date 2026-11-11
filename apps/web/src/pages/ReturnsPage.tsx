import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  RETURN_STATUSES,
  type ItemDto,
  type OrderDto,
  type PartnerDto,
  type ReturnDetailDto,
  type ReturnDto,
  type ReturnStatus,
  type WarehouseDto,
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

interface ListResponse {
  items: ReturnDto[];
  total: number;
}

const STATUS_VARIANT: Record<ReturnStatus, "secondary" | "success" | "destructive"> = {
  draft: "secondary",
  received: "success",
  cancelled: "destructive",
};

interface LineForm {
  itemId: string;
  description: string;
  quantity: string;
}

export function ReturnsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<ReturnDetailDto | null>(null);

  const [customers, setCustomers] = useState<PartnerDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [catalog, setCatalog] = useState<ItemDto[]>([]);
  const [form, setForm] = useState({ customerId: "", warehouseId: "", orderId: "", reason: "" });
  const [lines, setLines] = useState<LineForm[]>([{ itemId: "", description: "", quantity: "1" }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setData(
      await api<ListResponse>("/api/returns", {
        params: { page, pageSize: PAGE_SIZE, status: status || undefined },
      }),
    );
  }, [page, status]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    api<{ items: PartnerDto[] }>("/api/partners", { params: { type: "customer", pageSize: 100 } })
      .then((r) => setCustomers(r.items))
      .catch(() => {});
    api<{ items: WarehouseDto[] }>("/api/warehouses", { params: { pageSize: 100 } })
      .then((r) => setWarehouses(r.items))
      .catch(() => {});
    api<{ items: OrderDto[] }>("/api/orders", { params: { pageSize: 100 } })
      .then((r) => setOrders(r.items))
      .catch(() => {});
    api<{ items: ItemDto[] }>("/api/items", { params: { pageSize: 100 } })
      .then((r) => setCatalog(r.items))
      .catch(() => {});
  }, [createOpen]);

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { return: ret } = await api<{ return: ReturnDetailDto }>("/api/returns", {
        method: "POST",
        body: {
          customerId: form.customerId,
          warehouseId: form.warehouseId,
          orderId: form.orderId || undefined,
          reason: form.reason || undefined,
          lines: lines
            .filter((l) => l.itemId || l.description)
            .map((l) => ({
              itemId: l.itemId || undefined,
              description:
                l.description || catalog.find((i) => i.id === l.itemId)?.name || l.itemId,
              quantity: Number(l.quantity) || 1,
            })),
        },
      });
      toast.success(t("returns.created", { number: ret.number }));
      setCreateOpen(false);
      setForm({ customerId: "", warehouseId: "", orderId: "", reason: "" });
      setLines([{ itemId: "", description: "", quantity: "1" }]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    try {
      const r = await api<{ return: ReturnDetailDto }>(`/api/returns/${id}`);
      setDetail(r.return);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  async function action(kind: "receive" | "cancel") {
    if (!detail) return;
    try {
      const r = await api<{ return: ReturnDetailDto }>(`/api/returns/${detail.id}/${kind}`, {
        method: "POST",
        body: {},
      });
      setDetail(r.return);
      toast.success(t(kind === "receive" ? "returns.receivedOk" : "returns.cancelledOk"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const canWrite = can("orders:write");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("returns.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("returns.subtitle")}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("returns.new")}
          </Button>
        )}
      </div>

      <Select
        value={status}
        onValueChange={(v) => {
          setStatus(v === "all" ? "" : v);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder={t("returns.allStatuses")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("returns.allStatuses")}</SelectItem>
          {RETURN_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`returns.statuses.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("returns.number")}</TableHead>
              <TableHead>{t("returns.customer")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("returns.warehouse")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("returns.order")}</TableHead>
              <TableHead>{t("returns.status")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("returns.createdAt")}</TableHead>
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
                  <PackageOpen className="mx-auto mb-2 h-6 w-6" />
                  {t("returns.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)}>
                  <TableCell className="font-mono text-xs font-medium">{r.number}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.warehouseName}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {r.orderNumber ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {t(`returns.statuses.${r.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {new Date(r.createdAt).toLocaleDateString()}
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

      {/* Nova devolução */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("returns.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("returns.customer")}</Label>
                <Select
                  value={form.customerId}
                  onValueChange={(v) => setForm((f) => ({ ...f, customerId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("returns.selectCustomer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("returns.warehouse")}</Label>
                <Select
                  value={form.warehouseId}
                  onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("returns.selectWarehouse")} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("returns.orderOptional")}</Label>
                <Select
                  value={form.orderId || "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, orderId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("returns.noOrder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("returns.noOrder")}</SelectItem>
                    {orders
                      .filter((o) => !form.customerId || o.customerId === form.customerId)
                      .map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.number}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("returns.reason")}</Label>
                <Input
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("returns.lines")}</Label>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_80px_36px] items-center gap-2">
                  <Select value={l.itemId} onValueChange={(v) => setLine(i, { itemId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("returns.selectItem")} />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {it.sku} · {it.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={t("returns.description")}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="1"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((ls) => [...ls, { itemId: "", description: "", quantity: "1" }])}
              >
                <Plus className="h-4 w-4" />
                {t("returns.addLine")}
              </Button>
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  saving ||
                  !form.customerId ||
                  !form.warehouseId ||
                  !lines.some((l) => l.itemId || l.description)
                }
              >
                {saving ? t("common.loading") : t("returns.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detalhe */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detail?.number} · {detail ? t(`returns.statuses.${detail.status}`) : ""}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("returns.customer")}: </span>
                  {detail.customerName}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("returns.warehouse")}: </span>
                  {detail.warehouseName}
                </div>
                {detail.orderNumber && (
                  <div>
                    <span className="text-muted-foreground">{t("returns.order")}: </span>
                    {detail.orderNumber}
                  </div>
                )}
                {detail.reason && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{t("returns.reason")}: </span>
                    {detail.reason}
                  </div>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("returns.item")}</TableHead>
                    <TableHead className="text-right">{t("returns.qty")}</TableHead>
                    <TableHead className="text-right">{t("returns.receivedQty")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        {l.sku ? `${l.sku} · ` : ""}
                        {l.description}
                      </TableCell>
                      <TableCell className="text-right">{l.quantity}</TableCell>
                      <TableCell className="text-right">{l.receivedQty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {canWrite && detail.status === "draft" && (
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => action("cancel")}>
                    {t("returns.cancel")}
                  </Button>
                  <Button onClick={() => action("receive")}>{t("returns.receive")}</Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
