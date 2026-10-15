import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Boxes,
  Building2,
  FileText,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Route as RouteIcon,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  BarChart3,
  Plug,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchPalette } from "@/components/SearchPalette";
import { NotificationsMenu } from "@/components/NotificationsMenu";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", end: true },
  { to: "/partners", icon: Users, labelKey: "nav.partners" },
  { to: "/orders", icon: Package, labelKey: "nav.orders" },
  { to: "/shipments", icon: Truck, labelKey: "nav.shipments" },
  { to: "/routes", icon: RouteIcon, labelKey: "nav.routes" },
  { to: "/rates", icon: BarChart3, labelKey: "nav.rates" },
  { to: "/users", icon: Users, labelKey: "nav.users" },
  { to: "/settings", icon: Settings, labelKey: "nav.settings" },
] as const;

// Módulos das próximas fases — visíveis mas marcados "Brevemente"
const PLANNED_MODULES = [
  { to: "/m/warehouse", icon: Boxes, labelKey: "nav.sections.warehouse" },
  { to: "/m/procurement", icon: ShoppingCart, labelKey: "nav.sections.procurement" },
  { to: "/m/docs", icon: FileText, labelKey: "nav.sections.docs" },
  { to: "/m/trade", icon: Globe2, labelKey: "nav.sections.trade" },
  { to: "/m/billing", icon: BarChart3, labelKey: "nav.sections.billing" },
  { to: "/m/integrations", icon: Plug, labelKey: "nav.sections.integrations" },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials =
    user?.name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "?";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <Building2 className="h-6 w-6 text-sidebar-foreground" />
        <span className="text-lg font-semibold text-sidebar-foreground">{t("app.name")}</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  isActive && "bg-sidebar-accent text-sidebar-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </div>
        <div className="mt-6 space-y-1">
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-muted/70">
            {t("nav.sections.operations")}
          </p>
          {PLANNED_MODULES.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{t(item.labelKey)}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t("nav.soon")}
              </Badge>
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-medium text-sidebar-foreground">{tenant?.name}</p>
        <p className="truncate text-xs text-sidebar-muted">{user?.email}</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 bg-sidebar md:block">{sidebar}</aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-sidebar">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">{t("common.searchPlaceholder")}</span>
            <kbd className="hidden rounded border border-border bg-muted px-1.5 text-[10px] sm:inline">
              Ctrl K
            </kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <NotificationsMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="cursor-pointer rounded-full">
                  <Avatar>
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="truncate">{user?.name}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {user?.email}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <Settings className="h-4 w-4" />
                  {t("nav.settings")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    navigate("/login");
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  {t("auth.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      <SearchPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
