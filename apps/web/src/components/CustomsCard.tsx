import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown, Globe2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOMS_TRANSITIONS,
  INCOTERMS,
  type CustomsStatus,
  type Incoterm,
  type ShipmentDetailDto,
} from "@transitum/shared";
import { api, ApiRequestError, apiDownload, saveBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const EMPTY_ITEM = { description: "", hsCode: "", originCountry: "", quantity: "1", weightKg: "", value: "", currency: "EUR" };

export function CustomsCard({
  shipment,
  onChange,
}: {
  shipment: ShipmentDetailDto;
  onChange: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [item, setItem] = useState(EMPTY_ITEM);

  const canWrite = can("trade:write");
  const nextStatuses = CUSTOMS_TRANSITIONS[shipment.customsStatus] ?? [];

  async function setIncoterm(incoterm: Incoterm) {
    setBusy(true);
    try {
      await api(`/api/shipments/${shipment.id}/customs`, {
        method: "PATCH",
        body: { incoterm },
      });
      await onChange();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: CustomsStatus) {
    setBusy(true);
    try {
      await api(`/api/shipments/${shipment.id}/customs`, {
        method: "PATCH",
        body: { customsStatus: status },
      });
      toast.success(t("customs.updated"));
      await onChange();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    setBusy(true);
    try {
      await api(`/api/shipments/${shipment.id}/customs-items`, {
        method: "POST",
        body: {
          description: item.description,
          hsCode: item.hsCode || undefined,
          originCountry: item.originCountry || undefined,
          quantity: Number(item.quantity) || 1,
          weightKg: item.weightKg ? Number(item.weightKg) : undefined,
          value: item.value ? Number(item.value) : undefined,
          currency: item.currency || "EUR",
        },
      });
      toast.success(t("customs.itemAdded"));
      setItem(EMPTY_ITEM);
      setAdding(false);
      await onChange();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    try {
      await api(`/api/shipments/${shipment.id}/customs-items/${id}`, { method: "DELETE" });
      toast.success(t("customs.itemDeleted"));
      await onChange();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  async function downloadInvoice() {
    try {
      saveBlob(
        await apiDownload(`/api/shipments/${shipment.id}/commercial-invoice.csv`),
        `${shipment.number}-invoice.csv`,
      );
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="h-4 w-4" />
          {t("customs.title")}
        </CardTitle>
        {can("trade:read") && (
          <Button variant="outline" size="sm" onClick={() => void downloadInvoice()} data-testid="customs-invoice">
            <FileDown className="h-4 w-4" />
            {t("customs.invoice")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {canWrite ? (
            <Select
              value={shipment.incoterm ?? ""}
              onValueChange={(v) => void setIncoterm(v as Incoterm)}
              disabled={busy}
            >
              <SelectTrigger className="w-32" data-testid="customs-incoterm">
                <SelectValue placeholder={t("customs.incoterm")} />
              </SelectTrigger>
              <SelectContent>
                {INCOTERMS.map((i) => (
                  <SelectItem key={i} value={i}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm">{t("customs.incoterm")}: {shipment.incoterm ?? "—"}</span>
          )}
          <Badge variant="outline" data-testid="customs-status">
            {t(`customs.statuses.${shipment.customsStatus}`)}
          </Badge>
          {canWrite &&
            nextStatuses.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void setStatus(s)}
                data-testid={`customs-${s}`}
              >
                {t(`customs.statuses.${s}`)}
              </Button>
            ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{t("customs.items")}</p>
            {canWrite && !adding && (
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)} data-testid="customs-add">
                <Plus className="h-4 w-4" />
                {t("customs.addItem")}
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("customs.description")}</TableHead>
                <TableHead>{t("customs.hsCode")}</TableHead>
                <TableHead>{t("customs.origin")}</TableHead>
                <TableHead className="text-right">{t("customs.quantity")}</TableHead>
                <TableHead className="text-right">{t("customs.weight")}</TableHead>
                <TableHead className="text-right">{t("customs.value")}</TableHead>
                {canWrite && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipment.customsItems.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.description}</TableCell>
                  <TableCell className="font-mono text-xs">{i.hsCode ?? "—"}</TableCell>
                  <TableCell>{i.originCountry ?? "—"}</TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{i.weightKg ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {i.value != null ? `${i.value.toFixed(2)} ${i.currency}` : "—"}
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("documents.delete")}
                        onClick={() => void removeItem(i.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {shipment.customsItems.length === 0 && !adding && (
                <TableRow>
                  <TableCell colSpan={7} className="py-4 text-center text-muted-foreground">
                    {t("customs.emptyItems")}
                  </TableCell>
                </TableRow>
              )}
              {adding && (
                <TableRow data-testid="customs-new-row">
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) => setItem({ ...item, description: e.target.value })}
                      placeholder={t("customs.description")}
                      aria-label={t("customs.description")}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={item.hsCode}
                      onChange={(e) => setItem({ ...item, hsCode: e.target.value })}
                      placeholder="854239"
                      className="w-24"
                      aria-label={t("customs.hsCode")}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={item.originCountry}
                      onChange={(e) => setItem({ ...item, originCountry: e.target.value })}
                      placeholder="PT"
                      className="w-16"
                      maxLength={2}
                      aria-label={t("customs.origin")}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(e) => setItem({ ...item, quantity: e.target.value })}
                      className="w-20 text-right"
                      aria-label={t("customs.quantity")}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={item.weightKg}
                      onChange={(e) => setItem({ ...item, weightKg: e.target.value })}
                      className="w-20 text-right"
                      aria-label={t("customs.weight")}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={item.value}
                      onChange={(e) => setItem({ ...item, value: e.target.value })}
                      className="w-24 text-right"
                      aria-label={t("customs.value")}
                    />
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={busy || !item.description.trim()}
                        onClick={() => void addItem()}
                        data-testid="customs-save-item"
                      >
                        {t("common.create")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
