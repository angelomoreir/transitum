import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Boxes, CheckCircle2, Clock, Package, Route as RouteIcon, ShoppingCart, Truck, UserCheck, Users } from "lucide-react";
import type { Stats } from "@blujay/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ACTION_LABELS: Record<string, string> = {
  "tenant.registered": "Empresa registada",
  "auth.login": "Início de sessão",
  "auth.password_reset_requested": "Recuperação de palavra-passe pedida",
  "auth.password_reset": "Palavra-passe redefinida",
  "auth.password_changed": "Palavra-passe alterada",
  "users.invited": "Utilizador convidado",
  "users.invite_accepted": "Convite aceite",
  "users.invite_resent": "Convite reenviado",
  "users.updated": "Utilizador atualizado",
  "users.suspended": "Utilizador suspenso",
  "tenant.updated": "Empresa atualizada",
  "partners.created": "Parceiro criado",
  "partners.updated": "Parceiro atualizado",
  "partners.deactivated": "Parceiro desativado",
  "partners.reactivated": "Parceiro reativado",
  "orders.created": "Encomenda criada",
  "orders.updated": "Encomenda atualizada",
  "orders.status_changed": "Estado da encomenda alterado",
  "shipments.created": "Expedição criada",
  "shipments.status_changed": "Estado da expedição alterado",
  "routes.created": "Rota criada",
  "routes.status_changed": "Estado da rota alterado",
  "rates.created": "Tarifa criada",
  "rates.updated": "Tarifa atualizada",
  "costs.created": "Custo registado",
  "warehouses.created": "Armazém criado",
  "items.created": "Artigo criado",
  "stock.movement": "Movimento de stock",
  "purchases.created": "Compra criada",
  "purchases.status_changed": "Estado da compra alterado",
  "purchases.received": "Receção de compra",
};

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<Stats>("/api/stats")
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  const cards = [
    { key: "partners", icon: Users, value: stats?.partners },
    { key: "orders", icon: Package, value: stats?.orders },
    { key: "openOrders", icon: Clock, value: stats?.openOrders },
    { key: "activeShipments", icon: Truck, value: stats?.activeShipments },
    { key: "deliveredShipments", icon: CheckCircle2, value: stats?.deliveredShipments },
    { key: "activeRoutes", icon: RouteIcon, value: stats?.activeRoutes },
    { key: "openPurchases", icon: ShoppingCart, value: stats?.openPurchases },
    { key: "stockItems", icon: Boxes, value: stats?.stockItems },
    { key: "activeUsers", icon: UserCheck, value: stats?.activeUsers },
    { key: "activeSessions", icon: Activity, value: stats?.activeSessions },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("dashboard.welcome", { name: user?.name })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(`dashboard.${c.key}`)}
              </CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats ? (
                <p className="text-2xl font-bold">{c.value}</p>
              ) : (
                <Skeleton className="h-8 w-12" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{t("common.error")}</p>
          ) : !stats ? (
            <Skeleton className="h-24 w-full" />
          ) : stats.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noActivity")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {stats.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{ACTION_LABELS[e.action] ?? e.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.actorName ?? "Sistema"} · {new Date(e.createdAt).toLocaleString("pt-PT")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
