import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { TenantDto } from "@blujay/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const { t } = useTranslation();
  const { user, tenant, can, refreshUser } = useAuth();
  const [companyName, setCompanyName] = useState(tenant?.name ?? "");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  async function saveTenant(e: FormEvent) {
    e.preventDefault();
    setSavingTenant(true);
    try {
      await api<{ tenant: TenantDto }>("/api/tenant", {
        method: "PATCH",
        body: { name: companyName },
      });
      await refreshUser();
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSavingTenant(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: pw });
      setPw({ currentPassword: "", newPassword: "" });
      toast.success(t("settings.passwordChanged"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.company")}</CardTitle>
          <CardDescription>{t("settings.companyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveTenant} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("auth.companyName")}</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={!can("tenant:update")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("settings.slug")}</Label>
                <Input value={tenant?.slug ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.plan")}</Label>
                <div className="flex h-9 items-center">
                  <Badge variant="secondary">{tenant?.plan}</Badge>
                </div>
              </div>
            </div>
            {can("tenant:update") && (
              <Button type="submit" disabled={savingTenant || companyName === tenant?.name}>
                {savingTenant ? t("common.loading") : t("settings.save")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.profile")}</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("settings.currentPassword")}</Label>
              <Input
                type="password"
                autoComplete="current-password"
                value={pw.currentPassword}
                onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("auth.newPassword")}</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={pw.newPassword}
                onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
              />
            </div>
            <Button
              type="submit"
              disabled={savingPw || !pw.currentPassword || !pw.newPassword}
            >
              {savingPw ? t("common.loading") : t("settings.changePassword")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
