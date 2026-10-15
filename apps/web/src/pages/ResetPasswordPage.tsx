import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/auth/reset-password", { method: "POST", body: { token, password } });
      toast.success(t("auth.resetDone"));
      navigate("/login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t("auth.resetPassword")}>
      {!token ? (
        <p className="text-sm text-muted-foreground">{t("common.notFound")}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("common.loading") : t("auth.resetPassword")}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-primary hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    </AuthLayout>
  );
}
