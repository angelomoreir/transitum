import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TRANSPORT_DOC_TYPES, type FiscalSettingsDto } from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
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

/** Dados fiscais da empresa e configuração da comunicação de documentos à AT. */
export function FiscalCard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [fiscal, setFiscal] = useState<FiscalSettingsDto | null>(null);
  const [form, setForm] = useState({
    taxId: "",
    addressLine1: "",
    city: "",
    postalCode: "",
    country: "PT",
  });
  const [at, setAt] = useState({
    enabled: false,
    environment: "test" as "test" | "production",
    username: "",
    password: "",
    docType: "GT" as "GT" | "GR",
    series: "",
    seriesValidationCode: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ fiscal: FiscalSettingsDto }>("/api/tenant/fiscal")
      .then(({ fiscal }) => {
        setFiscal(fiscal);
        setForm({
          taxId: fiscal.taxId ?? "",
          addressLine1: fiscal.addressLine1 ?? "",
          city: fiscal.city ?? "",
          postalCode: fiscal.postalCode ?? "",
          country: fiscal.country ?? "PT",
        });
        setAt((a) => ({
          ...a,
          enabled: fiscal.at.enabled,
          environment: fiscal.at.environment,
          username: fiscal.at.username ?? "",
          docType: fiscal.at.docType,
          series: fiscal.at.series,
          seriesValidationCode: fiscal.at.seriesValidationCode ?? "",
        }));
      })
      .catch((e) => toast.error(e instanceof ApiRequestError ? e.message : t("common.error")));
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ fiscal: FiscalSettingsDto }>("/api/tenant/fiscal", {
        method: "PATCH",
        body: {
          ...form,
          at: { ...at, password: at.password || undefined },
        },
      });
      setFiscal(res.fiscal);
      setAt((a) => ({ ...a, password: "" }));
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!fiscal) return null;
  const ro = !can("tenant:update");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("fiscal.title")}</CardTitle>
        <div className="flex gap-2">
          <Badge variant={fiscal.atClientMode === "live" ? "default" : "secondary"}>
            AT: {t(`fiscal.mode.${fiscal.atClientMode}`)}
          </Badge>
          <Badge variant={fiscal.signingConfigured ? "default" : "secondary"}>
            {fiscal.signingConfigured ? t("fiscal.signingOn") : t("fiscal.signingOff")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-nif">{t("partners.taxId")}</Label>
              <Input id="f-nif" disabled={ro} value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-addr">{t("partners.address")}</Label>
              <Input id="f-addr" disabled={ro} value={form.addressLine1} onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-city">{t("partners.city")}</Label>
              <Input id="f-city" disabled={ro} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-postal">{t("partners.postalCode")}</Label>
              <Input id="f-postal" disabled={ro} value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} />
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-3 flex items-center gap-2">
              <input
                id="at-enabled"
                type="checkbox"
                className="h-4 w-4"
                disabled={ro}
                checked={at.enabled}
                onChange={(e) => setAt((a) => ({ ...a, enabled: e.target.checked }))}
              />
              <Label htmlFor="at-enabled" className="font-medium">
                {t("fiscal.atEnabled")}
              </Label>
            </div>
            {at.enabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("fiscal.environment")}</Label>
                  <Select
                    value={at.environment}
                    onValueChange={(v) => setAt((a) => ({ ...a, environment: v as "test" | "production" }))}
                    disabled={ro}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="test">{t("fiscal.envTest")}</SelectItem>
                      <SelectItem value="production">{t("fiscal.envProduction")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="at-user">{t("fiscal.username")}</Label>
                  <Input id="at-user" disabled={ro} value={at.username} onChange={(e) => setAt((a) => ({ ...a, username: e.target.value }))} placeholder="599999993/37" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="at-pass">{t("fiscal.password")}</Label>
                  <Input
                    id="at-pass"
                    type="password"
                    disabled={ro}
                    value={at.password}
                    onChange={(e) => setAt((a) => ({ ...a, password: e.target.value }))}
                    placeholder={fiscal.at.hasPassword ? "••••••••" : ""}
                  />
                  {fiscal.at.hasPassword && (
                    <p className="text-xs text-muted-foreground">{t("fiscal.passwordSet")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>{t("fiscal.docType")}</Label>
                  <Select
                    value={at.docType}
                    onValueChange={(v) => setAt((a) => ({ ...a, docType: v as "GT" | "GR" }))}
                    disabled={ro}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRANSPORT_DOC_TYPES.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d} — {t(`fiscal.docTypes.${d}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="at-series">{t("fiscal.series")}</Label>
                  <Input id="at-series" disabled={ro} required={at.enabled} value={at.series} onChange={(e) => setAt((a) => ({ ...a, series: e.target.value }))} placeholder="A" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="at-svc">{t("fiscal.seriesValidationCode")}</Label>
                  <Input id="at-svc" disabled={ro} value={at.seriesValidationCode} onChange={(e) => setAt((a) => ({ ...a, seriesValidationCode: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          {!ro && (
            <Button type="submit" disabled={busy}>
              {busy ? t("common.loading") : t("settings.save")}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
