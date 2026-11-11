import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { VEHICLE_TYPES, type VehicleDto, type VehicleType } from "@transitum/shared";
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

interface ListResponse {
  items: VehicleDto[];
  total: number;
}

export function VehiclesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [q, setQ] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleDto | null>(null);
  const [form, setForm] = useState({ plate: "", name: "", type: "van" as VehicleType, capacityKg: "", active: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setData(await api<ListResponse>("/api/vehicles", { params: { pageSize: 100, q: q || undefined } }));
  }, [q]);

  useEffect(() => {
    const id = setTimeout(() => load().catch((e) => toast.error(e.message)), 250);
    return () => clearTimeout(id);
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ plate: "", name: "", type: "van", capacityKg: "", active: true });
    setEditOpen(true);
  }
  function openEdit(v: VehicleDto) {
    setEditing(v);
    setForm({
      plate: v.plate,
      name: v.name,
      type: v.type,
      capacityKg: v.capacityKg != null ? String(v.capacityKg) : "",
      active: v.active,
    });
    setEditOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body = {
      plate: form.plate,
      name: form.name,
      type: form.type,
      capacityKg: form.capacityKg ? Number(form.capacityKg) : undefined,
      ...(editing ? { active: form.active } : {}),
    };
    try {
      if (editing) {
        await api(`/api/vehicles/${editing.id}`, { method: "PATCH", body });
      } else {
        await api("/api/vehicles", { method: "POST", body });
      }
      toast.success(t(editing ? "vehicles.updated" : "vehicles.created"));
      setEditOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("vehicles.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("vehicles.subtitle")}</p>
        </div>
        {can("routes:write") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("vehicles.new")}
          </Button>
        )}
      </div>

      <Input
        className="max-w-sm"
        placeholder={t("vehicles.searchPlaceholder")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("vehicles.plate")}</TableHead>
              <TableHead>{t("vehicles.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("vehicles.type")}</TableHead>
              <TableHead className="hidden text-right md:table-cell">{t("vehicles.capacity")}</TableHead>
              <TableHead>{t("vehicles.status")}</TableHead>
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
                  <Truck className="mx-auto mb-2 h-6 w-6" />
                  {t("vehicles.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((v) => (
                <TableRow
                  key={v.id}
                  className="cursor-pointer"
                  onClick={() => can("routes:write") && openEdit(v)}
                >
                  <TableCell className="font-mono text-xs font-medium">{v.plate}</TableCell>
                  <TableCell>{v.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{t(`vehicles.types.${v.type}`)}</TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {v.capacityKg != null ? `${v.capacityKg} kg` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={v.active ? "success" : "secondary"}>
                      {t(v.active ? "vehicles.active" : "vehicles.inactive")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(editing ? "vehicles.edit" : "vehicles.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("vehicles.plate")}</Label>
                <Input
                  required
                  value={form.plate}
                  onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
                  placeholder="AA-00-AA"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("vehicles.type")}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as VehicleType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map((vt) => (
                      <SelectItem key={vt} value={vt}>
                        {t(`vehicles.types.${vt}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("vehicles.name")}</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("vehicles.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("vehicles.capacity")} (kg)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.capacityKg}
                onChange={(e) => setForm((f) => ({ ...f, capacityKg: e.target.value }))}
              />
            </div>
            {editing && (
              <div className="space-y-1.5">
                <Label>{t("vehicles.status")}</Label>
                <Select
                  value={form.active ? "true" : "false"}
                  onValueChange={(v) => setForm((f) => ({ ...f, active: v === "true" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t("vehicles.active")}</SelectItem>
                    <SelectItem value="false">{t("vehicles.inactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={saving || !form.plate || !form.name}>
                {saving ? t("common.loading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
