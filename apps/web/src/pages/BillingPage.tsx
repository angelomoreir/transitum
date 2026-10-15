import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, FileText, Users, KeyRound } from "lucide-react";
import { toast } from "sonner";
import type { BillingOverviewDto, PlanDto, SaasInvoiceDto } from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-PT") : "—";
const fmtMoney = (v: number, c: string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: c }).format(v);

export function BillingPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<BillingOverviewDto | null>(null);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWrite = can("billing:write");

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        api<BillingOverviewDto>("/api/billing"),
        api<{ items: PlanDto[] }>("/api/billing/plans"),
      ]);
      setData(b);
      setPlans(p.items);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const sub = data?.subscription;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("billing.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("billing.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("billing.plan")}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{sub?.plan.name ?? "—"}</span>
              {sub && (
                <Badge variant="secondary">
                  {t(`billing.statuses.${sub.status}`)}
                </Badge>
              )}
            </div>
            {sub && (
              <p className="mt-1 text-sm text-muted-foreground">
                {fmtMoney(sub.plan.priceMonthly, sub.plan.currency)}
                {t("billing.monthly")}
              </p>
            )}
            {sub?.trialEndsAt && sub.status === "trialing" && (
              <p className="mt-1 text-xs text-amber-600">
                {t("billing.trialEnds", { date: fmtDate(sub.trialEndsAt) })}
              </p>
            )}
            {sub?.status === "active" && sub.currentPeriodEnd && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("billing.periodEnds", { date: fmtDate(sub.currentPeriodEnd) })}
              </p>
            )}
            {canWrite && (
              <Dialog open={planOpen} onOpenChange={setPlanOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-3">
                    {t("billing.changePlan")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("billing.plansTitle")}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2">
                    {plans.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-md border border-border p-3"
                      >
                        <div>
                          <p className="font-medium">
                            {p.name} — {fmtMoney(p.priceMonthly, p.currency)}
                            {t("billing.monthly")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("billing.maxUsersHint", { count: p.maxUsers })} ·{" "}
                            {t("billing.maxKeysHint", { count: p.maxApiKeys })}
                          </p>
                        </div>
                        {sub?.plan.id === p.id ? (
                          <Badge>{t("billing.currentPlan")}</Badge>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api("/api/billing/plan", {
                                  method: "POST",
                                  body: { planId: p.id },
                                });
                                setPlanOpen(false);
                                toast.success(t("billing.planChanged"));
                              })
                            }
                          >
                            {t("billing.select")}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("billing.usage")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {t("billing.usageUsers")}
              </span>
              <span className="font-medium">
                {data?.usage.users ?? 0} / {sub?.plan.maxUsers ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                {t("billing.usageApiKeys")}
              </span>
              <span className="font-medium">
                {data?.usage.apiKeys ?? 0} / {sub?.plan.maxApiKeys ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("billing.invoices")}
          </CardTitle>
          {canWrite && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/api/billing/invoices", { method: "POST" });
                  toast.success(t("billing.invoiceIssued"));
                })
              }
            >
              {t("billing.issueInvoice")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {(data?.invoices.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("billing.emptyInvoices")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.number")}</TableHead>
                  <TableHead>{t("billing.amount")}</TableHead>
                  <TableHead>{t("billing.status")}</TableHead>
                  <TableHead>{t("billing.issued")}</TableHead>
                  <TableHead>{t("billing.due")}</TableHead>
                  {canWrite && <TableHead className="text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.invoices.map((inv: SaasInvoiceDto) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell>{fmtMoney(inv.amount, inv.currency)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          inv.status === "paid"
                            ? "default"
                            : inv.status === "void"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {t(`billing.invoiceStatuses.${inv.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{fmtDate(inv.issuedAt)}</TableCell>
                    <TableCell>{fmtDate(inv.dueAt)}</TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        {inv.status === "open" && (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`/api/billing/invoices/${inv.id}/pay`, {
                                    method: "POST",
                                  });
                                  toast.success(t("billing.invoicePaid"));
                                })
                              }
                            >
                              {t("billing.pay")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`/api/billing/invoices/${inv.id}/void`, {
                                    method: "POST",
                                  });
                                  toast.success(t("billing.invoiceVoided"));
                                })
                              }
                            >
                              {t("billing.void")}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
