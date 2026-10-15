import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t("auth.forgotPassword")}>
      {sent ? (
        <p className="text-sm text-muted-foreground">{t("auth.forgotSent")}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("common.loading") : t("auth.sendReset")}
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
