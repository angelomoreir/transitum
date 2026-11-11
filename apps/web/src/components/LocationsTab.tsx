import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Plus } from "lucide-react";
import { toast } from "sonner";
import type { ItemDto, WarehouseDto, WarehouseLocationDto } from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PickLocationRow = {
  itemId: string;
  sku: string;
  itemName: string;
  locationId: string;
  locationCode: string;
  zone: string | null;
};

/**
 * Separador «Localizações»: bins/zonas de um armazém e a localização
 * preferencial de picking por artigo (usada na guia de picking).
 */
export function LocationsTab() {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<WarehouseLocationDto[] | null>(null);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [pickLocations, setPickLocations] = useState<PickLocationRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadWarehouses = useCallback(async () => {
    const res = await api<{ items: WarehouseDto[] }>("/api/warehouses", {
      params: { pageSize: "100", active: "true" },
    });
    setWarehouses(res.items);
    setWarehouseId((cur) => cur || res.items[0]?.id || "");
  }, []);

  const loadLocations = useCallback(async () => {
    if (!warehouseId) return;
    const [locRes, pickRes, itemRes] = await Promise.all([
      api<{ items: WarehouseLocationDto[] }>(`/api/warehouses/${warehouseId}/locations`),
      api<{ items: PickLocationRow[] }>(`/api/warehouses/${warehouseId}/pick-locations`),
      api<{ items: ItemDto[] }>("/api/items", { params: { pageSize: "100", active: "true" } }),
    ]);
    setLocations(locRes.items);
    setPickLocations(pickRes.items);
    setItems(itemRes.items);
  }, [warehouseId]);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);
  useEffect(() => {
    if (warehouseId) void loadLocations();
  }, [warehouseId, loadLocations]);

  const locByItem = useMemo(
    () => new Map(pickLocations.map((p) => [p.itemId, p.locationId])),
    [pickLocations],
  );

  const setPickLocation = async (itemId: string, locationId: string) => {
    try {
      await api(`/api/warehouses/${warehouseId}/pick-locations`, {
        method: "PUT",
        body: { itemId, locationId: locationId || null },
      });
      await loadLocations();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  const toggleActive = async (loc: WarehouseLocationDto) => {
    try {
      await api(`/api/locations/${loc.id}`, {
        method: "PATCH",
        body: { active: !loc.active },
      });
      await loadLocations();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  if (warehouses.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("inventory.locations.noWarehouse")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="w-64 space-y-1.5">
          <Label>{t("inventory.locations.warehouse")}</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger data-testid="locations-warehouse">
              <SelectValue />
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileUp className="h-4 w-4" />
            {t("common.importCsv")}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} data-testid="location-new">
            <Plus className="h-4 w-4" />
            {t("inventory.locations.new")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">{t("inventory.locations.code")}</TableHead>
              <TableHead>{t("inventory.locations.zone")}</TableHead>
              <TableHead className="text-right">{t("inventory.locations.items")}</TableHead>
              <TableHead>{t("inventory.locations.active")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!locations ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            ) : locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("inventory.locations.empty")}
                </TableCell>
              </TableRow>
            ) : (
              locations.map((l) => (
                <TableRow key={l.id} data-testid={`location-${l.code}`}>
                  <TableCell className="font-mono text-xs font-medium">{l.code}</TableCell>
                  <TableCell>{l.zone ?? "—"}</TableCell>
                  <TableCell className="text-right">{l.itemCount}</TableCell>
                  <TableCell>
                    <Badge variant={l.active ? "success" : "secondary"}>
                      {l.active ? t("common.yes") : t("common.no")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void toggleActive(l)}>
                      {l.active ? t("common.deactivate") : t("common.activate")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("inventory.locations.pickTitle")}</h3>
        <p className="mb-3 text-sm text-muted-foreground">{t("inventory.locations.pickHint")}</p>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">SKU</TableHead>
                <TableHead>{t("inventory.items.name")}</TableHead>
                <TableHead className="w-56">{t("orders.location")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {t("inventory.items.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>
                      <Select
                        value={locByItem.get(it.id) ?? "none"}
                        onValueChange={(v) => void setPickLocation(it.id, v === "none" ? "" : v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {(locations ?? [])
                            .filter((l) => l.active)
                            .map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.zone ? `${l.zone}-${l.code}` : l.code}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CreateLocationDialog
        open={creating}
        onOpenChange={setCreating}
        warehouseId={warehouseId}
        onDone={loadLocations}
      />
      <CsvImportDialog
        open={importing}
        onOpenChange={setImporting}
        endpoint={`/api/warehouses/${warehouseId}/locations/import`}
        template={t("inventory.locations.template")}
        onDone={loadLocations}
      />
    </div>
  );
}

function CreateLocationDialog({
  open,
  onOpenChange,
  warehouseId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  warehouseId: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [zone, setZone] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api(`/api/warehouses/${warehouseId}/locations`, {
        method: "POST",
        body: { code, zone: zone || undefined },
      });
      toast.success(t("inventory.locations.created"));
      setCode("");
      setZone("");
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
          <DialogTitle>{t("inventory.locations.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loc-code">{t("inventory.locations.code")}</Label>
            <Input
              id="loc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="A-01-02"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-zone">{t("inventory.locations.zone")}</Label>
            <Input
              id="loc-zone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="A"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !code.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
