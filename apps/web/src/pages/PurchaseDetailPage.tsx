import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import {
  PO_TRANSITIONS,
  type PoStatus,
  type PurchaseOrderDetailDto,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DocumentsCard } from "@/components/DocumentsCard";
import { PO_STATUS_VARIANT } from "@/pages/PurchasesPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtMoney = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

export function PurchaseDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [po, setPo] = useState<PurchaseOrderDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await api<{ purchaseOrder: PurchaseOrderDetailDto }>(
        `/api/purchase-orders/${id}`,
      );
      setPo(res.purchaseOrder);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
      else toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const transition = async (status: PoStatus) => {
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${id}/status`, { method: "POST", body: { status } });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    const lines = po!.lines
      .map((l) => ({ lineId: l.id, quantity: Number(qtys[l.id] ?? 0) }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${id}/receive`, { method: "POST", body: { lines } });
      toast.success(t("purchases.receiveDone"));
      setReceiveOpen(false);
      setQtys({});
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (notFound) return <p className="text-muted-foreground">{t("common.notFound")}</p>;
  if (!po) return <Skeleton className="h-64 w-full" />;

  const nextStatuses = PO_TRANSITIONS[po.status];
  const canReceive =
    can("purchases:write") && ["sent", "partially_received"].includes(po.status);
  const hasPending = po.lines.some((l) => l.receivedQty < l.quantity);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/purchases">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-mono text-2xl font-semibold">{po.number}</h1>
            <p className="text-sm text-muted-foreground">{po.supplierName}</p>
          </div>
          <Badge variant={PO_STATUS_VARIANT[po.status]}>
            {t(`purchases.statuses.${po.status}`)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReceive && hasPending && (
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setReceiveOpen((o) => !o);
                if (!receiveOpen) {
                  setQtys(
                    Object.fromEntries(
                      po.lines.map((l) => [l.id, String(l.quantity - l.receivedQty)]),
                    ),
                  );
                }
              }}
              data-testid="po-receive"
            >
              <PackageCheck className="h-4 w-4" />
              {t("purchases.receive")}
            </Button>
          )}
          {can("purchases:write") &&
            nextStatuses.map((s) => (
              <Button
                key={s}
                variant={s === "cancelled" ? "outline" : "default"}
                disabled={busy}
                onClick={() => transition(s)}
                data-testid={`po-${s}`}
              >
                {t(`purchases.actions.${s}`)}
              </Button>
            ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("purchases.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t("purchases.supplier")} value={po.supplierName} />
          <Row label={t("purchases.warehouse")} value={po.warehouseName} />
          <Row label={t("purchases.expectedDate")} value={po.expectedDate ?? "—"} />
          <Row
            label={t("purchases.quantity")}
            value={t("purchases.progress", { received: po.receivedQty, total: po.totalQty })}
          />
          {po.notes && <Row label={t("purchases.notes")} value={po.notes} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("purchases.lines")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("purchases.item")}</TableHead>
                <TableHead className="text-right">{t("purchases.quantity")}</TableHead>
                <TableHead className="text-right">{t("purchases.receivedQty")}</TableHead>
                <TableHead className="text-right">{t("purchases.pending")}</TableHead>
                <TableHead className="hidden md:table-cell text-right">
                  {t("purchases.unitPrice")}
                </TableHead>
                {receiveOpen && <TableHead className="w-28 text-right">{t("purchases.receive")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((l) => (
                <TableRow key={l.id} data-testid={`po-line-${l.lineNo}`}>
                  <TableCell className="text-muted-foreground">{l.lineNo}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{l.sku}</span> {l.itemName}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.quantity} {l.unit}
                  </TableCell>
                  <TableCell className="text-right">{l.receivedQty}</TableCell>
                  <TableCell className="text-right">
                    {l.quantity - l.receivedQty > 0 ? (
                      <Badge variant="warning">{l.quantity - l.receivedQty}</Badge>
                    ) : (
                      <Badge variant="success">0</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right font-mono">
                    {l.unitPrice != null ? fmtMoney(l.unitPrice) : "—"}
                  </TableCell>
                  {receiveOpen && (
                    <TableCell className="text-right">
                      <Input
                        className="ml-auto w-20 text-right"
                        type="number"
                        min={0}
                        max={l.quantity - l.receivedQty}
                        disabled={l.quantity - l.receivedQty === 0}
                        aria-label={`${t("purchases.receive")} ${l.lineNo}`}
                        value={qtys[l.id] ?? ""}
                        onChange={(e) =>
                          setQtys((q) => ({ ...q, [l.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {receiveOpen && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("purchases.receiveHint")}</p>
              <Button onClick={receive} disabled={busy} data-testid="po-receive-confirm">
                {t("common.confirm")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <DocumentsCard entityType="purchase_order" entityId={po.id} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
