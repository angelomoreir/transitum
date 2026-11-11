import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { PortalDto, PortalOrderDto } from "@transitum/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SHIPMENT_STATUS_VARIANT } from "@/pages/ShipmentsPage";

const BASE = import.meta.env.VITE_API_URL || "";

/** Portal público do cliente — encomendas e expedições com links de tracking. */
export function PortalPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [portal, setPortal] = useState<PortalDto | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/portal/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((d) => setPortal(d.portal))
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-muted-foreground">{t("portal.notFound")}</p>
      </div>
    );
  }
  if (!portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-PT") : "—";

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-3xl space-y-4 p-4 py-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold">
            {t("portal.title", { name: portal.customerName })}
          </h1>
          <p className="text-sm text-muted-foreground">{t("portal.subtitle")}</p>
        </header>

        <PortalOrderForm
          token={token!}
          onCreated={(o) =>
            setPortal((p) => (p ? { ...p, orders: [o, ...p.orders] } : p))
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.orders")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("orders.number")}</TableHead>
                  <TableHead>{t("orders.status")}</TableHead>
                  <TableHead>{t("orders.requestedDate")}</TableHead>
                  <TableHead className="text-right">{t("orders.lines")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portal.orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("portal.noOrders")}
                    </TableCell>
                  </TableRow>
                ) : (
                  portal.orders.map((o) => (
                    <TableRow key={o.number}>
                      <TableCell className="font-mono text-xs font-medium">{o.number}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {t(`orders.statuses.${o.status}`, o.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmt(o.requestedDate)}</TableCell>
                      <TableCell className="text-right">{o.lines}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.shipments")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shipments.number")}</TableHead>
                  <TableHead>{t("shipments.status")}</TableHead>
                  <TableHead>{t("shipments.deliveredAt")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {portal.shipments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("portal.noShipments")}
                    </TableCell>
                  </TableRow>
                ) : (
                  portal.shipments.map((s) => (
                    <TableRow key={s.number}>
                      <TableCell className="font-mono text-xs font-medium">
                        {s.number}
                        {s.orderNumber && (
                          <span className="ml-2 text-muted-foreground">{s.orderNumber}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            SHIPMENT_STATUS_VARIANT[
                              s.status as keyof typeof SHIPMENT_STATUS_VARIANT
                            ] ?? "secondary"
                          }
                        >
                          {t(`shipments.statuses.${s.status}`, s.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmt(s.deliveredAt)}</TableCell>
                      <TableCell className="text-right">
                        {s.trackingUrl && (
                          <Link
                            to={s.trackingUrl}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {t("portal.track")}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">Powered by Transitum</p>
      </div>
    </div>
  );
}

type DraftLine = { sku: string; description: string; quantity: string };

/** Formulário público — o cliente cria uma encomenda em rascunho. */
function PortalOrderForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: (o: PortalOrderDto) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ sku: "", description: "", quantity: "1" }]);
  const [requestedDate, setRequestedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const setLine = (i: number, k: keyof DraftLine, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      requestedDate: requestedDate || undefined,
      notes: notes || undefined,
      lines: lines
        .filter((l) => l.sku.trim() || l.description.trim())
        .map((l) => ({
          sku: l.sku.trim() || undefined,
          description: l.description.trim() || undefined,
          quantity: Number(l.quantity) || 1,
        })),
    };
    if (payload.lines.length === 0) {
      setError(t("portal.orderForm.lineRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/portal/${token}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? t("common.error"));
        return;
      }
      setDone(data.order.number);
      onCreated(data.order);
      setLines([{ sku: "", description: "", quantity: "1" }]);
      setRequestedDate("");
      setNotes("");
      setOpen(false);
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("portal.orderForm.title")}</CardTitle>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("portal.orderForm.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {done && (
          <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {t("portal.orderForm.created", { number: done })}
          </p>
        )}
        {!open ? (
          <p className="text-sm text-muted-foreground">{t("portal.orderForm.hint")}</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[7rem_1fr_5rem_2rem] items-end gap-2">
                <div className="space-y-1">
                  {i === 0 && <Label className="text-xs">SKU</Label>}
                  <Input
                    value={l.sku}
                    onChange={(e) => setLine(i, "sku", e.target.value)}
                    placeholder="SKU"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  {i === 0 && (
                    <Label className="text-xs">{t("portal.orderForm.description")}</Label>
                  )}
                  <Input
                    value={l.description}
                    onChange={(e) => setLine(i, "description", e.target.value)}
                    placeholder={t("portal.orderForm.descriptionPh")}
                  />
                </div>
                <div className="space-y-1">
                  {i === 0 && (
                    <Label className="text-xs">{t("portal.orderForm.qty")}</Label>
                  )}
                  <Input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) => setLine(i, "quantity", e.target.value)}
                  />
                </div>
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
                setLines((ls) => [...ls, { sku: "", description: "", quantity: "1" }])
              }
            >
              <Plus className="h-4 w-4" />
              {t("portal.orderForm.addLine")}
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("orders.requestedDate")}</Label>
                <Input
                  type="date"
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("orders.notes")}</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("common.loading") : t("portal.orderForm.submit")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
