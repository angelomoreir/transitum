import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Building2 className="h-7 w-7 text-primary" />
          <span className="text-2xl font-semibold">{t("app.name")}</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
