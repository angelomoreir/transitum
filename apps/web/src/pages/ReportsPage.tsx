import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { ExceptionsReport, ReportOverviewDto } from "@transitum/shared";
import { api, apiDownload, saveBlob } from "@/lib/api";
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

const eur = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function ReportsPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ReportOverviewDto | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsReport | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ report: ReportOverviewDto }>("/api/reports/overview", {
        params: { from, to },
      });
      setReport(res.report);
      api<{ report: ExceptionsReport }>("/api/reports/exceptions")
        .then((r) => setExceptions(r.report))
        .catch(() => setExceptions(null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    }
  }, [from, to, t]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const blob = await apiDownload(`/api/reports/shipments.csv?from=${from}&to=${to}`);
      saveBlob(blob, `expedicoes-${from}-${to}.csv`);
    } catch {
      toast.error(t("common.error"));
    }
  };

  if (!report) return <Skeleton className="h-96 w-full" />;

  const kpis = [
    { label: t("reports.totalShipments"), value: String(report.shipments.total) },
    { label: t("reports.delivered"), value: String(report.shipments.delivered) },
    { label: t("reports.onTime"), value: pct(report.shipments.onTimeRate) },
    {
      label: t("reports.avgTransit"),
      value: report.shipments.avgTransitHours != null ? `${report.shipments.avgTransitHours}h` : "—",
    },
    { label: t("reports.totalCost"), value: eur(report.costs.total) },
    {
      label: t("reports.costPerShipment"),
      value: report.costs.perShipment != null ? eur(report.costs.perShipment) : "—",
    },
    {
      label: t("reports.co2"),
      value: report.shipments.estimatedCo2Kg > 0 ? `${report.shipments.estimatedCo2Kg} kg` : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("reports.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("reports.subtitle")}</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="rep-from">{t("reports.from")}</Label>
            <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-to">{t("reports.to")}</Label>
            <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-semibold">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {exceptions && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {t("reports.exceptions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="destructive">
                {t("reports.excLate")}: {exceptions.late}
              </Badge>
              <Badge variant="secondary">
                {t("reports.excMissingPod")}: {exceptions.missingPod}
              </Badge>
              <Badge variant="secondary">
                {t("reports.excNoCarrier")}: {exceptions.noCarrier}
              </Badge>
            </div>
            {exceptions.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.noExceptions")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reports.excShipment")}</TableHead>
                    <TableHead>{t("shipments.customer")}</TableHead>
                    <TableHead>{t("reports.excType")}</TableHead>
                    <TableHead>{t("reports.excDetail")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.items.slice(0, 15).map((x, i) => (
                    <TableRow key={`${x.shipmentId}-${x.type}-${i}`}>
                      <TableCell>
                        <Link
                          to={`/shipments/${x.shipmentId}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {x.shipmentNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{x.customerName}</TableCell>
                      <TableCell>
                        <Badge variant={x.severity === "high" ? "destructive" : "secondary"}>
                          {t(`reports.excTypes.${x.type}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{x.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              {t("reports.carriers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.carriers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("shipments.carrier")}</TableHead>
                    <TableHead className="text-right">{t("nav.shipments")}</TableHead>
                    <TableHead className="text-right">{t("reports.onTime")}</TableHead>
                    <TableHead className="text-right">{t("reports.pod")}</TableHead>
                    <TableHead className="text-right">{t("reports.totalCost")}</TableHead>
                    <TableHead className="text-right">{t("reports.invoiceCheck")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.carriers.map((c) => (
                    <TableRow key={c.carrierId}>
                      <TableCell className="font-medium">{c.carrierName}</TableCell>
                      <TableCell className="text-right">
                        {c.delivered}/{c.shipments}
                      </TableCell>
                      <TableCell className="text-right">{pct(c.onTimeRate)}</TableCell>
                      <TableCell className="text-right">{pct(c.podRate)}</TableCell>
                      <TableCell className="text-right font-mono">{eur(c.totalCost)}</TableCell>
                      <TableCell className="text-right">
                        {c.invoices === 0 ? (
                          "—"
                        ) : c.invoiceDiscrepancies > 0 ? (
                          <Badge variant="destructive">
                            {c.invoiceDiscrepancies}/{c.invoices}
                          </Badge>
                        ) : (
                          <Badge variant="success">{c.invoices}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reports.customers")}</CardTitle>
          </CardHeader>
          <CardContent>
            {report.customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("shipments.customer")}</TableHead>
                    <TableHead className="text-right">{t("nav.shipments")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.customers.map((c) => (
                    <TableRow key={c.customerId}>
                      <TableCell className="font-medium">{c.customerName}</TableCell>
                      <TableCell className="text-right">{c.shipments}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reports.weekly")}</CardTitle>
        </CardHeader>
        <CardContent>
          {report.weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.week")}</TableHead>
                  <TableHead className="text-right">{t("reports.created")}</TableHead>
                  <TableHead className="text-right">{t("reports.delivered")}</TableHead>
                  <TableHead className="text-right">{t("reports.totalCost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.weekly.map((w) => (
                  <TableRow key={w.week}>
                    <TableCell className="font-mono">{w.week}</TableCell>
                    <TableCell className="text-right">{w.created}</TableCell>
                    <TableCell className="text-right">{w.delivered}</TableCell>
                    <TableCell className="text-right font-mono">{eur(w.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t("reports.routes")}</Badge>
        {t("reports.routesSummary", {
          completed: report.routes.completed,
          stopsDone: report.routes.stopsDone,
          proofs: report.routes.proofs,
        })}
      </div>
    </div>
  );
}
