import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";

// Páginas carregadas sob demanda — o bundle inicial fica só com shell + login.
const RegisterPage = lazy(() =>
  import("@/pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })),
);
const AcceptInvitePage = lazy(() =>
  import("@/pages/AcceptInvitePage").then((m) => ({ default: m.AcceptInvitePage })),
);
const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const PartnersPage = lazy(() =>
  import("@/pages/PartnersPage").then((m) => ({ default: m.PartnersPage })),
);
const OrdersPage = lazy(() => import("@/pages/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const OrderNewPage = lazy(() =>
  import("@/pages/OrderNewPage").then((m) => ({ default: m.OrderNewPage })),
);
const OrderDetailPage = lazy(() =>
  import("@/pages/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })),
);
const ShipmentsPage = lazy(() =>
  import("@/pages/ShipmentsPage").then((m) => ({ default: m.ShipmentsPage })),
);
const ShipmentNewPage = lazy(() =>
  import("@/pages/ShipmentNewPage").then((m) => ({ default: m.ShipmentNewPage })),
);
const ShipmentDetailPage = lazy(() =>
  import("@/pages/ShipmentDetailPage").then((m) => ({ default: m.ShipmentDetailPage })),
);
const PickWavesPage = lazy(() =>
  import("@/pages/PickWavesPage").then((m) => ({ default: m.PickWavesPage })),
);
const RoutesPage = lazy(() => import("@/pages/RoutesPage").then((m) => ({ default: m.RoutesPage })));
const RouteNewPage = lazy(() =>
  import("@/pages/RouteNewPage").then((m) => ({ default: m.RouteNewPage })),
);
const RouteDetailPage = lazy(() =>
  import("@/pages/RouteDetailPage").then((m) => ({ default: m.RouteDetailPage })),
);
const RatesPage = lazy(() => import("@/pages/RatesPage").then((m) => ({ default: m.RatesPage })));
const FreightInvoicesPage = lazy(() =>
  import("@/pages/FreightInvoicesPage").then((m) => ({ default: m.FreightInvoicesPage })),
);
const SalesInvoicesPage = lazy(() =>
  import("@/pages/SalesInvoicesPage").then((m) => ({ default: m.SalesInvoicesPage })),
);
const ReturnsPage = lazy(() =>
  import("@/pages/ReturnsPage").then((m) => ({ default: m.ReturnsPage })),
);
const VehiclesPage = lazy(() =>
  import("@/pages/VehiclesPage").then((m) => ({ default: m.VehiclesPage })),
);
const WarehousesPage = lazy(() =>
  import("@/pages/WarehousesPage").then((m) => ({ default: m.WarehousesPage })),
);
const InventoryPage = lazy(() =>
  import("@/pages/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const PurchasesPage = lazy(() =>
  import("@/pages/PurchasesPage").then((m) => ({ default: m.PurchasesPage })),
);
const PurchaseNewPage = lazy(() =>
  import("@/pages/PurchaseNewPage").then((m) => ({ default: m.PurchaseNewPage })),
);
const PurchaseDetailPage = lazy(() =>
  import("@/pages/PurchaseDetailPage").then((m) => ({ default: m.PurchaseDetailPage })),
);
const DocumentsPage = lazy(() =>
  import("@/pages/DocumentsPage").then((m) => ({ default: m.DocumentsPage })),
);
const AutomationsPage = lazy(() =>
  import("@/pages/AutomationsPage").then((m) => ({ default: m.AutomationsPage })),
);
const IntegrationsPage = lazy(() =>
  import("@/pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
);
const BillingPage = lazy(() =>
  import("@/pages/BillingPage").then((m) => ({ default: m.BillingPage })),
);
const AdminPage = lazy(() => import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TrackPage = lazy(() => import("@/pages/TrackPage").then((m) => ({ default: m.TrackPage })));
const SsoCallbackPage = lazy(() =>
  import("@/pages/SsoCallbackPage").then((m) => ({ default: m.SsoCallbackPage })),
);
const PortalPage = lazy(() => import("@/pages/PortalPage").then((m) => ({ default: m.PortalPage })));
const DriverPage = lazy(() => import("@/pages/DriverPage").then((m) => ({ default: m.DriverPage })));
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}

/** Motoristas vão diretamente para a app de motorista. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.role === "driver") return <Navigate to="/driver" replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route path="/track/:token" element={<TrackPage />} />
            <Route path="/sso/callback" element={<SsoCallbackPage />} />
            <Route path="/portal/:token" element={<PortalPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/" element={<HomeRoute />} />
              <Route path="/partners" element={<PartnersPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/new" element={<OrderNewPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/pick-waves" element={<PickWavesPage />} />
              <Route path="/shipments" element={<ShipmentsPage />} />
              <Route path="/shipments/new" element={<ShipmentNewPage />} />
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/routes" element={<RoutesPage />} />
              <Route path="/routes/new" element={<RouteNewPage />} />
              <Route path="/routes/:id" element={<RouteDetailPage />} />
              <Route path="/vehicles" element={<VehiclesPage />} />
              <Route path="/returns" element={<ReturnsPage />} />
              <Route path="/driver" element={<DriverPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/rates" element={<RatesPage />} />
              <Route path="/freight-invoices" element={<FreightInvoicesPage />} />
              <Route path="/sales-invoices" element={<SalesInvoicesPage />} />
              <Route path="/warehouses" element={<WarehousesPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/purchases" element={<PurchasesPage />} />
              <Route path="/purchases/new" element={<PurchaseNewPage />} />
              <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/automations" element={<AutomationsPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
