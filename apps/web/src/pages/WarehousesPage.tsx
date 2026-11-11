import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { warehouseCreateSchema, type WarehouseDto } from "@transitum/shared";
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

export function WarehousesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<{ items: WarehouseDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WarehouseDto | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: WarehouseDto[]; total: number }>("/api/warehouses", {
      params: { page, pageSize: PAGE_SIZE, q, active: activeFilter || undefined },
    });
    setData(res);
  }, [page, q, activeFilter]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const toggleActive = async (w: WarehouseDto) => {
    try {
      await api(`/api/warehouses/${w.id}`, {
        method: "PATCH",
        body: { active: !w.active },
      });
      toast.success(t("warehouses.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("warehouses.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("warehouses.subtitle")}</p>
        </div>
        {can("warehouses:write") && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t("warehouses.new")}
          </Button>
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
          value={activeFilter}
          onValueChange={(v) => {
            setActiveFilter(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("warehouses.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("warehouses.allStatuses")}</SelectItem>
            <SelectItem value="true">{t("warehouses.active")}</SelectItem>
            <SelectItem value="false">{t("warehouses.inactive")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("warehouses.code")}</TableHead>
              <TableHead>{t("warehouses.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("warehouses.address")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                {t("warehouses.items")}
              </TableHead>
              <TableHead>{t("warehouses.active")}</TableHead>
              <TableHead className="w-10" />
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
                  {t("warehouses.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs font-medium">{w.code}</TableCell>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {w.address ? `${w.address.line1}, ${w.address.city}` : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">{w.itemCount}</TableCell>
                  <TableCell>
                    <Badge variant={w.active ? "success" : "secondary"}>
                      {w.active ? t("warehouses.active") : t("warehouses.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {can("warehouses:write") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(w)}>
                            <Pencil className="h-4 w-4" />
                            {t("warehouses.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={w.active ? "text-destructive" : undefined}
                            onClick={() => toggleActive(w)}
                          >
                            {w.active ? t("warehouses.deactivate") : t("warehouses.activate")}
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.previous")}
          </Button>
          <span>{t("common.page", { page })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      </div>

      {creating && <WarehouseForm open onOpenChange={setCreating} onDone={load} />}
      {editing && (
        <WarehouseForm
          open
          onOpenChange={(o) => !o && setEditing(null)}
          warehouse={editing}
          onDone={load}
        />
      )}
    </div>
  );
}

function WarehouseForm({
  open,
  onOpenChange,
  warehouse,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse?: WarehouseDto;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: warehouse?.name ?? "",
    line1: warehouse?.address?.line1 ?? "",
    city: warehouse?.address?.city ?? "",
    postalCode: warehouse?.address?.postalCode ?? "",
    country: warehouse?.address?.country ?? "PT",
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const hasAddress = form.line1 && form.city && form.postalCode && form.country;
    const payload = {
      name: form.name,
      ...(hasAddress
        ? {
            address: {
              line1: form.line1,
              city: form.city,
              postalCode: form.postalCode,
              country: form.country,
            },
          }
        : {}),
    };
    const parsed = warehouseCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      if (warehouse) {
        await api(`/api/warehouses/${warehouse.id}`, { method: "PATCH", body: parsed.data });
        toast.success(t("warehouses.updated"));
      } else {
        const res = await api<{ warehouse: WarehouseDto }>("/api/warehouses", {
          method: "POST",
          body: parsed.data,
        });
        toast.success(t("warehouses.created", { code: res.warehouse.code }));
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
          <DialogTitle>{warehouse ? t("warehouses.edit") : t("warehouses.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">{t("warehouses.name")}</Label>
            <Input
              id="wh-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-line1">{t("warehouses.address")}</Label>
            <Input
              id="wh-line1"
              value={form.line1}
              onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 grid-cols-3">
            <Input
              aria-label={t("partners.city")}
              placeholder={t("partners.city")}
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
            <Input
              aria-label={t("partners.postalCode")}
              placeholder={t("partners.postalCode")}
              value={form.postalCode}
              onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
            />
            <Input
              aria-label={t("partners.country")}
              placeholder={t("partners.country")}
              maxLength={2}
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))}
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
