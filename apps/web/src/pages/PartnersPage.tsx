import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  partnerCreateSchema,
  PARTNER_TYPES,
  type PartnerDto,
  type PartnerType,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";

const PAGE_SIZE = 20;

const TYPE_VARIANT: Record<PartnerType, "default" | "success" | "warning"> = {
  customer: "default",
  supplier: "success",
  carrier: "warning",
};

export function PartnersPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: PartnerDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PartnerDto | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ items: PartnerDto[]; total: number }>("/api/partners", {
      params: { page, pageSize: PAGE_SIZE, q, type: type || undefined },
    });
    setData(res);
  }, [page, q, type]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const toggleActive = async (p: PartnerDto) => {
    try {
      await api(`/api/partners/${p.id}`, { method: "DELETE" });
      toast.success(t("partners.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("partners.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("partners.subtitle")}</p>
        </div>
        {can("partners:write") && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t("partners.new")}
          </Button>
        )}
        {creating && (
          <PartnerForm open onOpenChange={setCreating} onDone={load} />
        )}
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
          value={type}
          onValueChange={(v) => {
            setType(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("partners.filterAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("partners.filterAll")}</SelectItem>
            {PARTNER_TYPES.map((pt) => (
              <SelectItem key={pt} value={pt}>
                {t(`partners.types.${pt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("partners.code")}</TableHead>
              <TableHead>{t("partners.name")}</TableHead>
              <TableHead>{t("partners.type")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("partners.city")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("auth.email")}</TableHead>
              <TableHead>{t("partners.active")}</TableHead>
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
                  {t("partners.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((p) => (
                <TableRow key={p.id} data-testid={`partner-${p.code}`}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.types.map((pt) => (
                        <Badge key={pt} variant={TYPE_VARIANT[pt]}>
                          {t(`partners.types.${pt}`)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{p.city ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{p.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={p.active ? "success" : "secondary"}>
                      {p.active ? t("partners.active") : t("partners.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {can("partners:write") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(p)}>
                            <Pencil className="h-4 w-4" />
                            {t("partners.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={p.active ? "text-destructive" : undefined}
                            onClick={() => toggleActive(p)}
                          >
                            {p.active ? t("partners.deactivate") : t("partners.activate")}
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

      {editing && (
        <PartnerForm
          open
          onOpenChange={(o) => !o && setEditing(null)}
          partner={editing}
          onDone={load}
        />
      )}
    </div>
  );
}

function PartnerForm({
  open,
  onOpenChange,
  partner,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner?: PartnerDto;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    types: (partner?.types ?? []) as PartnerType[],
    name: partner?.name ?? "",
    taxId: partner?.taxId ?? "",
    email: partner?.email ?? "",
    phone: partner?.phone ?? "",
    addressLine1: partner?.addressLine1 ?? "",
    city: partner?.city ?? "",
    postalCode: partner?.postalCode ?? "",
    country: partner?.country ?? "PT",
    notes: partner?.notes ?? "",
  });
  const [loading, setLoading] = useState(false);

  const toggleType = (pt: PartnerType) =>
    setForm((f) => ({
      ...f,
      types: f.types.includes(pt) ? f.types.filter((x) => x !== pt) : [...f.types, pt],
    }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = partnerCreateSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      if (partner) {
        await api(`/api/partners/${partner.id}`, { method: "PATCH", body: parsed.data });
        toast.success(t("partners.updated"));
      } else {
        await api("/api/partners", { method: "POST", body: parsed.data });
        toast.success(t("partners.created"));
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {partner ? t("partners.edit") : t("partners.new")}
          </DialogTitle>
          <DialogDescription>{t("partners.subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("partners.type")}</Label>
            <div className="flex flex-wrap gap-2">
              {PARTNER_TYPES.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  data-testid={`type-${pt}`}
                  onClick={() => toggleType(pt)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    form.types.includes(pt)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card hover:bg-accent",
                  )}
                >
                  {t(`partners.types.${pt}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">{t("partners.name")}</Label>
              <Input
                id="p-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-taxid">{t("partners.taxId")}</Label>
              <Input
                id="p-taxid"
                value={form.taxId}
                onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-phone">{t("partners.phone")}</Label>
              <Input
                id="p-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-email">{t("auth.email")}</Label>
              <Input
                id="p-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-addr">{t("partners.address")}</Label>
              <Input
                id="p-addr"
                value={form.addressLine1}
                onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-city">{t("partners.city")}</Label>
              <Input
                id="p-city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-postal">{t("partners.postalCode")}</Label>
              <Input
                id="p-postal"
                value={form.postalCode}
                onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-country">{t("partners.country")}</Label>
              <Input
                id="p-country"
                maxLength={2}
                value={form.country}
                onChange={(e) =>
                  setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-notes">{t("partners.notes")}</Label>
              <Textarea
                id="p-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
