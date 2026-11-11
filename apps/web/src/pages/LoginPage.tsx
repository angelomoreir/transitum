import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SsoLookupResponse } from "@transitum/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const demoEmail = import.meta.env.VITE_DEMO_EMAIL ?? "demo@transitum.local";
const demoPassword = import.meta.env.VITE_DEMO_PASSWORD ?? "Demo12345!";
// Em dev mostra sempre; em produção só com VITE_DEMO=1 no build
const showDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO === "1";

export function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(params.get("mfa"));
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Erros devolvidos pelo callback OIDC (sso_error=…) e MFA via SSO (?mfa=…)
  useEffect(() => {
    const err = params.get("sso_error");
    if (err) toast.error(t(`auth.ssoErrors.${err}`, t("auth.ssoErrors.generic")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Domínio do email com SSO configurado → redireciona para o IdP
  async function continueWithSso() {
    setSsoLoading(true);
    try {
      const r = await api<SsoLookupResponse>("/api/auth/sso/lookup", {
        method: "POST",
        body: { email },
      });
      if (r.sso && r.startUrl) {
        window.location.href = r.startUrl;
        return;
      }
      toast.info(t("auth.ssoNotConfigured"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSsoLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code);
      } else {
        const challenge = await login(email, password);
        if (challenge) {
          setMfaToken(challenge);
          return;
        }
      }
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t("auth.login")} subtitle={t("auth.loginSubtitle")}>
      <form onSubmit={onSubmit} className="space-y-4">
        {mfaToken ? (
          <div className="space-y-1.5">
            <Label htmlFor="code">{t("auth.mfaCode")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="\d{6}"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">{t("auth.mfaHint")}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading
            ? t("common.loading")
            : mfaToken
              ? t("auth.verifyCode")
              : t("auth.login")}
        </Button>
        {mfaToken ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMfaToken(null);
              setCode("");
            }}
          >
            {t("common.back")}
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              {t("common.or")}
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={ssoLoading || !email.includes("@")}
              onClick={() => void continueWithSso()}
            >
              {ssoLoading ? t("common.loading") : t("auth.continueWithSso")}
            </Button>
            {showDemo && (
              <div className="rounded-md border border-dashed bg-muted/50 p-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{t("auth.demoCredentials")}</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setEmail(demoEmail);
                      setPassword(demoPassword);
                    }}
                  >
                    {t("auth.demoFill")}
                  </button>
                </div>
                <div className="mt-1 font-mono">
                  {demoEmail} / {demoPassword}
                </div>
              </div>
            )}
          </>
        )}
      </form>
      {!mfaToken && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="text-primary hover:underline">
            {t("auth.registerCompany")}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}
