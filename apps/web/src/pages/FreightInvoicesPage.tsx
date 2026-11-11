import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  CARRIER_INVOICE_STATUSES,
  type CarrierInvoiceDto,
  type CarrierInvoiceStatus,
  type PartnerDto,
  type ShipmentDto,
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
  items: CarrierInvoiceDto[];
  total: number;
  summary: { pending: number; matched: number; discrepancy: number; totalVariance: number };
}

const STATUS_VARIANT: Record<CarrierInvoiceStatus, "secondary" | "success" | "destructive"> = {
  pending: "secondary",
  matched: "success",
  discrepancy: "destructive",
};

const fmt = (v: number | null, currency = "EUR") =>
  v == null ? "—" : `${v.toFixed(2)} ${currency}`;

export function FreightInvoicesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [carriers, setCarriers] = useState<PartnerDto[]>([]);
  const [shipments, setShipments] = useState<ShipmentDto[]>([]);
  const [form, setForm] = useState({
    carrierId: "",
    shipmentId: "",
    invoiceNumber: "",
    amount: "",
    issuedAt: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setData(
      await api<ListResponse>("/api/freight-invoices", {
        params: { page, pageSize: PAGE_SIZE, status: status || undefined },
      }),
    );
  }, [page, status]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    api<{ items: PartnerDto[] }>("/api/partners", { params: { type: "carrier", pageSize: 100 } })
      .then((r) => setCarriers(r.items))
      .catch(() => {});
    api<{ items: ShipmentDto[] }>("/api/shipments", { params: { pageSize: 100 } })
      .then((r) => setShipments(r.items))
      .catch(() => {});
  }, [createOpen]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/freight-invoices", {
        method: "POST",
        body: {
          carrierId: form.carrierId,
          shipmentId: form.shipmentId || undefined,
          invoiceNumber: form.invoiceNumber,
          amount: Number(form.amount),
          issuedAt: form.issuedAt || undefined,
          note: form.note || undefined,
        },
      });
      toast.success(t("invoices.created"));
      setCreateOpen(false);
      setForm({ carrierId: "", shipmentId: "", invoiceNumber: "", amount: "", issuedAt: "", note: "" });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("invoices.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("invoices.subtitle")}</p>
        </div>
        {can("costs:write") && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("invoices.new")}
          </Button>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">
            {t("invoices.summary.pending")}: {data.summary.pending}
          </Badge>
          <Badge variant="success">
            {t("invoices.summary.matched")}: {data.summary.matched}
          </Badge>
          <Badge variant="destructive">
            {t("invoices.summary.discrepancy")}: {data.summary.discrepancy}
          </Badge>
          {data.summary.discrepancy > 0 && (
            <Badge variant="outline">
              {t("invoices.summary.totalVariance")}: {fmt(data.summary.totalVariance)}
            </Badge>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("invoices.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("invoices.allStatuses")}</SelectItem>
            {CARRIER_INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`invoices.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoices.number")}</TableHead>
              <TableHead>{t("invoices.carrier")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("invoices.shipment")}</TableHead>
              <TableHead className="text-right">{t("invoices.amount")}</TableHead>
              <TableHead className="hidden text-right md:table-cell">{t("invoices.expected")}</TableHead>
              <TableHead className="text-right">{t("invoices.variance")}</TableHead>
              <TableHead>{t("invoices.status")}</TableHead>
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
                  {t("invoices.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell>{inv.carrierName}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {inv.shipmentNumber ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{fmt(inv.amount, inv.currency)}</TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {fmt(inv.expectedAmount, inv.currency)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${inv.variance != null && Math.abs(inv.variance) > 0.01 ? "text-destructive" : ""}`}
                  >
                    {inv.variance == null ? "—" : `${inv.variance > 0 ? "+" : ""}${inv.variance.toFixed(2)}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[inv.status]}>
                      {t(`invoices.statuses.${inv.status}`)}
                    </Badge>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("invoices.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("invoices.carrier")}</Label>
              <Select value={form.carrierId} onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t("invoices.selectCarrier")} />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("invoices.shipmentOptional")}</Label>
              <Select
                value={form.shipmentId || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, shipmentId: v === "none" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("invoices.noShipment")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("invoices.noShipment")}</SelectItem>
                  {shipments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("invoices.number")}</Label>
                <Input
                  required
                  value={form.invoiceNumber}
                  onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("invoices.amount")} (EUR)</Label>
                <Input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("invoices.issuedAt")}</Label>
                <Input
                  type="date"
                  value={form.issuedAt}
                  onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("invoices.note")}</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving || !form.carrierId || !form.invoiceNumber || !form.amount}>
                {saving ? t("common.loading") : t("invoices.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
