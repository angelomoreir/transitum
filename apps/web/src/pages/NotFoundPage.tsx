import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("common.notFound")}</p>
    </div>
  );
}
