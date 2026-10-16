import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PartnersPage } from "@/pages/PartnersPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { OrderNewPage } from "@/pages/OrderNewPage";
import { OrderDetailPage } from "@/pages/OrderDetailPage";
import { ShipmentsPage } from "@/pages/ShipmentsPage";
import { ShipmentNewPage } from "@/pages/ShipmentNewPage";
import { ShipmentDetailPage } from "@/pages/ShipmentDetailPage";
import { RoutesPage } from "@/pages/RoutesPage";
import { RouteNewPage } from "@/pages/RouteNewPage";
import { RouteDetailPage } from "@/pages/RouteDetailPage";
import { RatesPage } from "@/pages/RatesPage";
import { WarehousesPage } from "@/pages/WarehousesPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { PurchasesPage } from "@/pages/PurchasesPage";
import { PurchaseNewPage } from "@/pages/PurchaseNewPage";
import { PurchaseDetailPage } from "@/pages/PurchaseDetailPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { BillingPage } from "@/pages/BillingPage";
import { AdminPage } from "@/pages/AdminPage";
import { UsersPage } from "@/pages/UsersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<OrderNewPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/shipments" element={<ShipmentsPage />} />
            <Route path="/shipments/new" element={<ShipmentNewPage />} />
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/routes/new" element={<RouteNewPage />} />
            <Route path="/routes/:id" element={<RouteDetailPage />} />
            <Route path="/rates" element={<RatesPage />} />
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
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
