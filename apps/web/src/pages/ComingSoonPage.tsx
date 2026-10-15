import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const MODULE_KEYS: Record<string, string> = {
  orders: "nav.sections.orders",
  transport: "nav.sections.transport",
  routes: "nav.sections.operations",
  warehouse: "nav.sections.warehouse",
  procurement: "nav.sections.procurement",
  docs: "nav.sections.docs",
  trade: "nav.sections.trade",
  billing: "nav.sections.billing",
  integrations: "nav.sections.integrations",
};

export function ComingSoonPage() {
  const { t } = useTranslation();
  const { module } = useParams();
  const key = module ? MODULE_KEYS[module] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{key ? t(key) : "—"}</h1>
        <Badge variant="warning">{t("nav.soon")}</Badge>
      </div>
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("nav.soon")} — {key ? t(key) : module}
        </CardContent>
      </Card>
    </div>
  );
}
