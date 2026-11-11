import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Setup = { secret: string; otpauth: string };

/** Configuração de MFA/TOTP do utilizador: gerar segredo, confirmar código, desativar. */
export function MfaCard() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);

  const enabled = !!user?.totpEnabled;

  async function startSetup() {
    setBusy(true);
    try {
      setSetup(await api<Setup>("/api/auth/mfa/setup", { method: "POST" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    setBusy(true);
    try {
      await api("/api/auth/mfa/enable", { method: "POST", body: { code } });
      toast.success(t("mfa.enabled"));
      setSetup(null);
      setCode("");
      await refreshUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api("/api/auth/mfa/disable", { method: "POST", body: { code: disableCode } });
      toast.success(t("mfa.disabled"));
      setDisableCode("");
      await refreshUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t("mfa.title")}</CardTitle>
          <Badge variant={enabled ? "default" : "secondary"}>
            {enabled ? t("mfa.statusOn") : t("mfa.statusOff")}
          </Badge>
        </div>
        <CardDescription>{t("mfa.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("mfa.disableCodeLabel")}</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button
              variant="destructive"
              onClick={disable}
              disabled={busy || disableCode.length !== 6}
            >
              {t("mfa.disable")}
            </Button>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("mfa.scanHint")}</p>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="font-mono text-sm break-all select-all">{setup.secret}</p>
              <a href={setup.otpauth} className="mt-1 block text-xs text-primary break-all hover:underline">
                {setup.otpauth}
              </a>
            </div>
            <div className="space-y-1.5">
              <Label>{t("mfa.codeLabel")}</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={enable} disabled={busy || code.length !== 6}>
                {t("mfa.enable")}
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={startSetup} disabled={busy}>
            {t("mfa.startSetup")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
