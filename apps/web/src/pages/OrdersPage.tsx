import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  ORDER_STATUSES,
  type OrderDto,
  type OrderStatus,
  type PickWaveDto,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CsvImportDialog } from "@/components/CsvImportDialog";
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
  const [importOpen, setImportOpen] = useState(false);
  const [waveOpen, setWaveOpen] = useState(false);

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
        <div className="flex gap-2">
          {can("orders:read") && (
            <Button variant="outline" onClick={() => setWaveOpen(true)}>
              <Layers className="h-4 w-4" />
              {t("orders.wave")}
            </Button>
          )}
          {can("orders:write") && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                {t("orders.importCsv")}
              </Button>
              <Button asChild>
                <Link to="/orders/new">
                  <Plus className="h-4 w-4" />
                  {t("orders.new")}
                </Link>
              </Button>
            </>
          )}
        </div>
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

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        endpoint="/api/orders/import"
        template="encomenda;cliente;sku;quantidade;data;cidade;pais"
        onDone={load}
      />
      <PickWaveDialog open={waveOpen} onOpenChange={setWaveOpen} />
    </div>
  );
}

/** Wave picking — seleciona encomendas e agrega as linhas por artigo/armazém. */
function PickWaveDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<OrderDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wave, setWave] = useState<PickWaveDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setWave(null);
    api<{ items: OrderDto[] }>("/api/orders", {
      params: { status: "confirmed", pageSize: 100 },
    })
      .then((r) => setCandidates(r.items))
      .catch(() => setCandidates([]));
  }, [open]);

  async function generate() {
    setBusy(true);
    try {
      const res = await api<{ wave: PickWaveDto }>("/api/orders/pick-wave", {
        method: "POST",
        body: { orderIds: [...selected] },
      });
      setWave(res.wave);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  // Persiste a wave (cria em /pick-waves com linhas por expedir)
  async function saveWave() {
    setBusy(true);
    try {
      await api("/api/pick-waves", {
        method: "POST",
        body: { orderIds: [...selected] },
      });
      toast.success(t("orders.waveSaved"));
      onOpenChange(false);
      navigate("/pick-waves");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("orders.wave")}</DialogTitle>
        </DialogHeader>
        {!wave ? (
          <>
            <p className="text-sm text-muted-foreground">{t("orders.waveHint")}</p>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {candidates.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t("orders.waveEmpty")}
                </p>
              )}
              {candidates.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="font-mono text-xs">{o.number}</span>
                  <span className="flex-1 truncate text-sm">{o.customerName}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.requestedDate ?? ""}
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void generate()}
                disabled={busy || selected.size === 0}
                data-testid="wave-generate"
              >
                {t("orders.waveGenerate")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("orders.waveSummary", {
                orders: wave.orders.length,
                warehouse: wave.warehouseName ?? "—",
              })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("orders.location")}</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>{t("orders.item")}</TableHead>
                  <TableHead className="text-right">{t("orders.toPick")}</TableHead>
                  <TableHead className="text-right">{t("orders.available")}</TableHead>
                  <TableHead>{t("orders.waveOrders")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wave.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{l.location ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.sku ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.itemName}</TableCell>
                    <TableCell className="text-right font-medium">{l.toPick}</TableCell>
                    <TableCell className="text-right">
                      {l.available != null ? l.available : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.orders.map((o) => `${o.orderNumber}×${o.qty}`).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
                {wave.lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      {t("orders.waveNoLines")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWave(null)}>
                {t("common.back")}
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                {t("orders.wavePrint")}
              </Button>
              <Button onClick={() => void saveWave()} disabled={busy}>
                {t("orders.waveSave")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
