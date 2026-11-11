import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  RATE_BASES,
  rateCreateSchema,
  type PartnerDto,
  type RateDto,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
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

const fmtMoney = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(v);

export function RatesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: RateDto[]; total: number } | null>(null);
  const [carriers, setCarriers] = useState<PartnerDto[]>([]);
  const [carrierFilter, setCarrierFilter] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RateDto | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: RateDto[]; total: number }>("/api/rates", {
      params: { page, pageSize: PAGE_SIZE, carrierId: carrierFilter || undefined },
    });
    setData(res);
  }, [page, carrierFilter]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  useEffect(() => {
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "carrier", pageSize: 100 },
    })
      .then((r) => setCarriers(r.items))
      .catch(() => setCarriers([]));
  }, []);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const toggleActive = async (r: RateDto) => {
    try {
      await api(`/api/rates/${r.id}`, { method: "DELETE" });
      toast.success(t("rates.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("rates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("rates.subtitle")}</p>
        </div>
        {can("rates:write") && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t("rates.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={carrierFilter}
          onValueChange={(v) => {
            setCarrierFilter(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("rates.allCarriers")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("rates.allCarriers")}</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} — {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rates.name")}</TableHead>
              <TableHead>{t("rates.carrier")}</TableHead>
              <TableHead>{t("rates.basis")}</TableHead>
              <TableHead className="text-right">{t("rates.price")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                {t("rates.minCharge")}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("rates.validFrom")}
              </TableHead>
              <TableHead>{t("partners.active")}</TableHead>
              <TableHead className="w-10" />
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
                  {t("rates.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.carrierName}</TableCell>
                  <TableCell>{t(`rates.bases.${r.basis}`)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {fmtMoney(r.price, r.currency)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right font-mono">
                    {r.minCharge != null ? fmtMoney(r.minCharge, r.currency) : "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {r.validFrom || r.validTo
                      ? `${r.validFrom ?? "…"} → ${r.validTo ?? "…"}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "secondary"}>
                      {r.active ? t("rates.active") : t("rates.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {can("rates:write") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(r)}>
                            <Pencil className="h-4 w-4" />
                            {t("rates.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={r.active ? "text-destructive" : undefined}
                            onClick={() => toggleActive(r)}
                          >
                            {r.active ? t("rates.deactivate") : t("rates.activate")}
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

      {creating && (
        <RateForm
          open
          onOpenChange={setCreating}
          carriers={carriers}
          onDone={load}
        />
      )}
      {editing && (
        <RateForm
          open
          onOpenChange={(o) => !o && setEditing(null)}
          rate={editing}
          carriers={carriers}
          onDone={load}
        />
      )}
    </div>
  );
}

function RateForm({
  open,
  onOpenChange,
  rate,
  carriers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate?: RateDto;
  carriers: PartnerDto[];
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    carrierId: rate?.carrierId ?? "",
    name: rate?.name ?? "",
    basis: rate?.basis ?? ("flat" as const),
    price: rate?.price != null ? String(rate.price) : "",
    currency: rate?.currency ?? "EUR",
    minCharge: rate?.minCharge != null ? String(rate.minCharge) : "",
    validFrom: rate?.validFrom ?? "",
    validTo: rate?.validTo ?? "",
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      carrierId: form.carrierId,
      name: form.name,
      basis: form.basis,
      price: Number(form.price),
      currency: form.currency,
      minCharge: form.minCharge ? Number(form.minCharge) : undefined,
      validFrom: form.validFrom || undefined,
      validTo: form.validTo || undefined,
    };
    const parsed = rateCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      if (rate) {
        await api(`/api/rates/${rate.id}`, { method: "PATCH", body: parsed.data });
        toast.success(t("rates.updated"));
      } else {
        await api("/api/rates", { method: "POST", body: parsed.data });
        toast.success(t("rates.created"));
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
          <DialogTitle>{rate ? t("rates.edit") : t("rates.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("rates.carrier")}</Label>
            <Select
              value={form.carrierId}
              onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))}
            >
              <SelectTrigger data-testid="rate-carrier">
                <SelectValue placeholder={t("routes.selectCarrier")} />
              </SelectTrigger>
              <SelectContent>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-name">{t("rates.name")}</Label>
            <Input
              id="rate-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("rates.basis")}</Label>
              <Select
                value={form.basis}
                onValueChange={(v) => setForm((f) => ({ ...f, basis: v as typeof f.basis }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_BASES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`rates.bases.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-price">{t("rates.price")}</Label>
              <Input
                id="rate-price"
                type="number"
                min={0}
                step="0.01"
                required
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-min">{t("rates.minCharge")}</Label>
              <Input
                id="rate-min"
                type="number"
                min={0}
                step="0.01"
                value={form.minCharge}
                onChange={(e) => setForm((f) => ({ ...f, minCharge: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-currency">{t("shipments.currency")}</Label>
              <Input
                id="rate-currency"
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-from">{t("rates.validFrom")}</Label>
              <Input
                id="rate-from"
                type="date"
                value={form.validFrom}
                onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-to">{t("rates.validTo")}</Label>
              <Input
                id="rate-to"
                type="date"
                value={form.validTo}
                onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))}
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
