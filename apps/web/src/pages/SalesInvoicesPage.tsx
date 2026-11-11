import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  SALES_INVOICE_STATUSES,
  type OrderDto,
  type PartnerDto,
  type SalesInvoiceDto,
  type SalesInvoiceStatus,
} from "@transitum/shared";
import { api, apiDownload, saveBlob } from "@/lib/api";
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
  items: SalesInvoiceDto[];
  total: number;
}

const STATUS_VARIANT: Record<SalesInvoiceStatus, "secondary" | "success" | "outline" | "destructive"> =
  {
    draft: "secondary",
    issued: "outline",
    paid: "success",
    void: "destructive",
  };

const fmt = (v: number) => `${v.toFixed(2)} €`;

interface LineForm {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

export function SalesInvoicesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<SalesInvoiceDto | null>(null);
  const [customers, setCustomers] = useState<PartnerDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [form, setForm] = useState({ customerId: "", orderId: "", dueDate: "", notes: "" });
  const [lines, setLines] = useState<LineForm[]>([{ description: "", quantity: "1", unitPrice: "", taxRate: "23" }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setData(
      await api<ListResponse>("/api/sales-invoices", {
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
    api<{ items: OrderDto[] }>("/api/orders", { params: { pageSize: 100 } })
      .then((r) => setOrders(r.items))
      .catch(() => {});
  }, [createOpen]);

  async function openDetail(id: string) {
    try {
      const r = await api<{ invoice: SalesInvoiceDto }>(`/api/sales-invoices/${id}`);
      setDetail(r.invoice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    }
  }

  async function setInvoiceStatus(id: string, next: "issued" | "paid" | "void") {
    try {
      const r = await api<{ invoice: SalesInvoiceDto }>(`/api/sales-invoices/${id}/status`, {
        method: "POST",
        body: { status: next },
      });
      setDetail(r.invoice);
      toast.success(t("salesInvoices.updated"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const validLines = lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice) || 0,
          taxRate: l.taxRate === "" ? 0 : Number(l.taxRate),
        }));
      await api("/api/sales-invoices", {
        method: "POST",
        body: {
          customerId: form.customerId,
          orderId: form.orderId || undefined,
          dueDate: form.dueDate || undefined,
          notes: form.notes || undefined,
          lines: validLines.length ? validLines : undefined,
        },
      });
      toast.success(t("salesInvoices.created"));
      setCreateOpen(false);
      setForm({ customerId: "", orderId: "", dueDate: "", notes: "" });
      setLines([{ description: "", quantity: "1", unitPrice: "", taxRate: "23" }]);
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
          <h1 className="text-2xl font-semibold">{t("salesInvoices.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("salesInvoices.subtitle")}</p>
        </div>
        {can("billing:write") && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("salesInvoices.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("salesInvoices.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("salesInvoices.allStatuses")}</SelectItem>
            {SALES_INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`salesInvoices.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("salesInvoices.number")}</TableHead>
              <TableHead>{t("salesInvoices.customer")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("salesInvoices.order")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("salesInvoices.issueDate")}</TableHead>
              <TableHead className="text-right">{t("salesInvoices.total")}</TableHead>
              <TableHead>{t("salesInvoices.status")}</TableHead>
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
                  {t("salesInvoices.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => void openDetail(inv.id)}
                >
                  <TableCell className="font-mono text-xs font-medium">{inv.number}</TableCell>
                  <TableCell>{inv.customerName}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {inv.orderNumber ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{inv.issueDate}</TableCell>
                  <TableCell className="text-right">{fmt(inv.total)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[inv.status]}>
                      {t(`salesInvoices.statuses.${inv.status}`)}
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

      {/* Nova fatura */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("salesInvoices.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("salesInvoices.customer")}</Label>
                <Select
                  value={form.customerId}
                  onValueChange={(v) => setForm((f) => ({ ...f, customerId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("salesInvoices.selectCustomer")} />
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
                <Label>{t("salesInvoices.orderOptional")}</Label>
                <Select
                  value={form.orderId || "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, orderId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("salesInvoices.noOrder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("salesInvoices.noOrder")}</SelectItem>
                    {orders.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("salesInvoices.dueDate")}</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("salesInvoices.notes")}</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("salesInvoices.lines")}</Label>
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    placeholder={t("salesInvoices.lineDescription")}
                    value={l.description}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="w-20"
                    type="number"
                    min="1"
                    placeholder={t("salesInvoices.qty")}
                    value={l.quantity}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="w-28"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("salesInvoices.unitPrice")}
                    value={l.unitPrice}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="w-20"
                    type="number"
                    min="0"
                    max="100"
                    placeholder={t("salesInvoices.vat")}
                    title={t("salesInvoices.vat")}
                    value={l.taxRate}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, taxRate: e.target.value } : x)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length === 1}
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
                onClick={() =>
                  setLines((ls) => [...ls, { description: "", quantity: "1", unitPrice: "", taxRate: "23" }])
                }
              >
                <Plus className="h-4 w-4" />
                {t("salesInvoices.addLine")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("salesInvoices.linesHint")}</p>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={saving || !form.customerId}>
                {saving ? t("common.loading") : t("salesInvoices.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detalhe */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detail.number} — {detail.customerName}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[detail.status]}>
                    {t(`salesInvoices.statuses.${detail.status}`)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t("salesInvoices.issueDate")}: {detail.issueDate}
                  </span>
                  {detail.dueDate && (
                    <span className="text-sm text-muted-foreground">
                      {t("salesInvoices.dueDate")}: {detail.dueDate}
                    </span>
                  )}
                  {detail.orderNumber && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {t("salesInvoices.order")}: {detail.orderNumber}
                    </span>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("salesInvoices.lineDescription")}</TableHead>
                      <TableHead className="text-right">{t("salesInvoices.qty")}</TableHead>
                      <TableHead className="text-right">{t("salesInvoices.unitPrice")}</TableHead>
                      <TableHead className="text-right">{t("salesInvoices.vat")}</TableHead>
                      <TableHead className="text-right">{t("salesInvoices.lineTotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.lines ?? []).map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.description}</TableCell>
                        <TableCell className="text-right">{l.quantity}</TableCell>
                        <TableCell className="text-right">{fmt(l.unitPrice)}</TableCell>
                        <TableCell className="text-right">{l.taxRate}%</TableCell>
                        <TableCell className="text-right">{fmt(l.lineTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("salesInvoices.subtotal")}</span>
                    <span>{fmt(detail.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("salesInvoices.taxTotal")}</span>
                    <span>{fmt(detail.taxTotal)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>{t("salesInvoices.total")}</span>
                    <span className="text-lg">{fmt(detail.total)}</span>
                  </div>
                </div>
                {detail.atcud && (
                  <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    ATCUD <span className="font-mono">{detail.atcud}</span>
                    {detail.hashControl && (
                      <>
                        {" "}· {t("salesInvoices.hashControl")}{" "}
                        <span className="font-mono">{detail.hashControl}</span>
                      </>
                    )}
                    {detail.atStatus && (
                      <> · {t(`salesInvoices.atStatuses.${detail.atStatus}`, detail.atStatus)}</>
                    )}
                  </div>
                )}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const blob = await apiDownload(`/api/sales-invoices/${detail.id}/pdf`);
                        saveBlob(blob, `fatura-${detail.number}.pdf`);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t("common.error"));
                      }
                    }}
                  >
                    {t("salesInvoices.downloadPdf")}
                  </Button>
                </div>
                {can("billing:write") && (
                  <div className="flex flex-wrap gap-2">
                    {detail.status === "draft" && (
                      <Button size="sm" onClick={() => void setInvoiceStatus(detail.id, "issued")}>
                        {t("salesInvoices.issue")}
                      </Button>
                    )}
                    {detail.status === "issued" && (
                      <Button size="sm" onClick={() => void setInvoiceStatus(detail.id, "paid")}>
                        {t("salesInvoices.markPaid")}
                      </Button>
                    )}
                    {["draft", "issued"].includes(detail.status) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void setInvoiceStatus(detail.id, "void")}
                      >
                        {t("salesInvoices.void")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
