import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { TenantDto, UserDto } from "@transitum/shared";
import { api, setAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthLayout } from "@/components/AuthLayout";

/**
 * Destino do redirect OIDC (`/sso/callback#access_token=…`).
 * O cookie de refresh já foi definido pela API; aqui fica o access token
 * em memória e carrega-se o utilizador antes de entrar na app.
 */
export function SsoCallbackPage() {
  const { t } = useTranslation();
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("access_token");
      if (!token) {
        navigate("/login?sso_error=token", { replace: true });
        return;
      }
      try {
        setAccessToken(token);
        const me = await api<{ user: UserDto; tenant: TenantDto }>("/api/auth/me");
        setAuth({ accessToken: token, user: me.user, tenant: me.tenant });
        navigate("/", { replace: true });
      } catch {
        setAccessToken(null);
        navigate("/login?sso_error=session", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = t("auth.ssoSigningIn");
  }, [t]);

  return (
    <AuthLayout title={t("auth.ssoSigningIn")} subtitle="">
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    </AuthLayout>
  );
}
