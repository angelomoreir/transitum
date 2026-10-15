import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  poCreateSchema,
  type ItemDto,
  type PartnerDto,
  type PurchaseOrderDetailDto,
  type WarehouseDto,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface LineForm {
  itemId: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: LineForm = { itemId: "", quantity: "1", unitPrice: "" };

export function PurchaseNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<PartnerDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [itemsList, setItemsList] = useState<ItemDto[]>([]);
  const [form, setForm] = useState({
    supplierId: "",
    warehouseId: "",
    expectedDate: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "supplier", active: "true", pageSize: 100 },
    }).then((r) => setSuppliers(r.items)).catch(() => {});
    api<{ items: WarehouseDto[] }>("/api/warehouses", {
      params: { active: "true", pageSize: 100 },
    }).then((r) => setWarehouses(r.items)).catch(() => {});
    api<{ items: ItemDto[] }>("/api/items", {
      params: { active: "true", pageSize: 100 },
    }).then((r) => setItemsList(r.items)).catch(() => {});
  }, []);

  const setLine = (i: number, patch: Partial<LineForm>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      supplierId: form.supplierId,
      warehouseId: form.warehouseId,
      expectedDate: form.expectedDate || undefined,
      notes: form.notes || undefined,
      lines: lines
        .filter((l) => l.itemId)
        .map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice ? Number(l.unitPrice) : undefined,
        })),
    };
    const parsed = poCreateSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ purchaseOrder: PurchaseOrderDetailDto }>(
        "/api/purchase-orders",
        { method: "POST", body: parsed.data },
      );
      toast.success(t("purchases.created", { number: res.purchaseOrder.number }));
      navigate(`/purchases/${res.purchaseOrder.id}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/purchases">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("purchases.new")}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("purchases.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("purchases.supplier")}</Label>
              <Select
                value={form.supplierId}
                onValueChange={(v) => setForm((f) => ({ ...f, supplierId: v }))}
              >
                <SelectTrigger data-testid="po-supplier">
                  <SelectValue placeholder={t("purchases.selectSupplier")} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("purchases.warehouse")}</Label>
              <Select
                value={form.warehouseId}
                onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))}
              >
                <SelectTrigger data-testid="po-warehouse">
                  <SelectValue placeholder={t("purchases.selectWarehouse")} />
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
            <div className="space-y-1.5">
              <Label htmlFor="po-date">{t("purchases.expectedDate")}</Label>
              <Input
                id="po-date"
                type="date"
                value={form.expectedDate}
                onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="po-notes">{t("purchases.notes")}</Label>
              <Textarea
                id="po-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("purchases.lines")}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
            >
              <Plus className="h-4 w-4" />
              {t("purchases.addLine")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2" data-testid={`po-line-${i}`}>
                <Select
                  value={l.itemId}
                  onValueChange={(v) => setLine(i, { itemId: v })}
                >
                  <SelectTrigger className="min-w-52 flex-1">
                    <SelectValue placeholder={t("purchases.selectItem")} />
                  </SelectTrigger>
                  <SelectContent>
                    {itemsList.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.sku} — {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-24"
                  type="number"
                  min={1}
                  required
                  aria-label={t("purchases.quantity")}
                  placeholder={t("purchases.quantity")}
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <Input
                  className="w-28"
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={t("purchases.unitPrice")}
                  placeholder={t("purchases.unitPrice")}
                  value={l.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  aria-label={t("purchases.removeLine")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link to="/purchases">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
