import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { AdminInvoiceDto, AdminTenantDto, PlanDto } from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-PT") : "—";
const fmtMoney = (v: number, c: string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: c }).format(v);

export function AdminPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tenants, setTenants] = useState<AdminTenantDto[]>([]);
  const [invoices, setInvoices] = useState<AdminInvoiceDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ts, inv, pl] = await Promise.all([
        api<{ items: AdminTenantDto[] }>("/api/admin/tenants"),
        api<{ items: AdminInvoiceDto[] }>("/api/admin/invoices"),
        api<{ items: PlanDto[] }>("/api/billing/plans"),
      ]);
      setTenants(ts.items);
      setInvoices(inv.items);
      setPlans(pl.items);
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        setDenied(true);
      } else {
        toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
      }
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

  if (!user?.isPlatformAdmin || denied) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">{t("admin.notAdmin")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.tenants")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.tenant")}</TableHead>
                <TableHead>{t("admin.plan")}</TableHead>
                <TableHead>{t("admin.subscription")}</TableHead>
                <TableHead>{t("admin.usersCol")}</TableHead>
                <TableHead>{t("admin.created")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tn) => (
                <TableRow key={tn.id}>
                  <TableCell>
                    <p className="font-medium">{tn.name}</p>
                    <p className="text-xs text-muted-foreground">{tn.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={plans.find((p) => p.code === tn.planCode)?.id ?? ""}
                      onValueChange={(planId) =>
                        run(async () => {
                          await api(`/api/admin/tenants/${tn.id}/plan`, {
                            method: "POST",
                            body: { planId },
                          });
                          toast.success(t("admin.planChanged"));
                        })
                      }
                      disabled={busy}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder={tn.planName ?? "—"} />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {tn.subscriptionStatus ? (
                        <Badge variant="outline">
                          {t(`billing.statuses.${tn.subscriptionStatus}`)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                      {tn.suspendedAt && (
                        <Badge variant="destructive">{t("admin.suspended")}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{tn.usersCount}</TableCell>
                  <TableCell>{fmtDate(tn.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {tn.suspendedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(`/api/admin/tenants/${tn.id}/activate`, {
                              method: "POST",
                            });
                            toast.success(t("admin.activatedOk"));
                          })
                        }
                      >
                        {t("admin.activate")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(`/api/admin/tenants/${tn.id}/suspend`, {
                              method: "POST",
                            });
                            toast.success(t("admin.suspendedOk"));
                          })
                        }
                      >
                        {t("admin.suspend")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("admin.emptyInvoices")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.number")}</TableHead>
                  <TableHead>{t("admin.tenant")}</TableHead>
                  <TableHead>{t("billing.amount")}</TableHead>
                  <TableHead>{t("billing.status")}</TableHead>
                  <TableHead>{t("billing.issued")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell>{inv.tenantName}</TableCell>
                    <TableCell>{fmtMoney(inv.amount, inv.currency)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`billing.invoiceStatuses.${inv.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{fmtDate(inv.issuedAt)}</TableCell>
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
