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
import { UsersPage } from "@/pages/UsersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ComingSoonPage } from "@/pages/ComingSoonPage";
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
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/m/:module" element={<ComingSoonPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
