// src/renderer/App.tsx
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// layout
import { Layout } from './components/Layout';

// screens you added
import PairScreen  from './screens/PairScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LogoutRoute } from './screens/LogoutRoute';
import { AuthedGate } from './screens/AuthedGate';

// pages
import ClosingReport from './pages/reports/ClosingReport';
import OrderProcessPage from './pages/pos/OrderProcessPage';
import RecentOrdersPage from './pages/RecentOrdersPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ItemsPage } from './pages/ItemsPage';
import PromosPage from './pages/PromosPage';
import TablesPage from './pages/TablesPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpdatePage } from './pages/UpdatePage';
import PaymentMethodsPage from './pages/PaymentMethodsPage';
import LocationsPage from './pages/LocationsPage';
import PermissionsPage from './pages/PermissionsPage';
import KitchenDisplayPage from './pages/KitchenDisplayPage';

function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [fallback, setFallback] = useState('/');
  useEffect(() => {
    window.api.invoke('auth:whoami').then((user) => {
      const permissions: string[] = user?.permissions || [];
      setFallback(permissions.includes('orders.create') ? '/' : permissions.includes('orders.kitchen_view') ? '/kitchen' : permissions.includes('reports.view') ? '/reports/closing' : '/login');
      // `permissions` is already the effective role defaults plus per-user
      // overrides. Adding `is_admin` here made every explicit denial a no-op.
      setAllowed(permissions.includes(permission));
    }).catch(() => setAllowed(false));
  }, [permission]);
  if (allowed === null) return null;
  return allowed ? <>{children}</> : <Navigate to={fallback} replace />;
}

function App() {
  return (
    <Routes>
      {/* Public routes (no session required) */}
      <Route path="/pair" element={<PairScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/logout" element={<LogoutRoute />} />

      {/* Protected app */}
      <Route element={<AuthedGate />}>
        <Route element={<Layout />}>
          {/* Orders */}
          <Route index element={<PermissionRoute permission='orders.create'><OrderProcessPage /></PermissionRoute>} />
          <Route path="kitchen" element={<PermissionRoute permission='orders.kitchen_view'><KitchenDisplayPage /></PermissionRoute>} />
          <Route path="orders" element={<PermissionRoute permission='orders.view_own'><RecentOrdersPage /></PermissionRoute>} />
          <Route path="/reports/closing" element={<PermissionRoute permission='reports.view'><ClosingReport /></PermissionRoute>} />

          {/* Catalog */}
          <Route path="categories" element={<PermissionRoute permission='catalog.manage'><CategoriesPage /></PermissionRoute>} />
          <Route path="items" element={<PermissionRoute permission='catalog.manage'><ItemsPage /></PermissionRoute>} />
          <Route path="promos" element={<PermissionRoute permission='catalog.manage'><PromosPage /></PermissionRoute>} />

          {/* Dine-in */}
          <Route path="tables" element={<PermissionRoute permission='tables.manage'><TablesPage /></PermissionRoute>} />

          {/* System */}
          <Route path="payment-methods" element={<PermissionRoute permission='payments.manage'><PaymentMethodsPage /></PermissionRoute>} />
          <Route path="locations" element={<PermissionRoute permission='locations.manage'><LocationsPage /></PermissionRoute>} />
          <Route path="settings" element={<PermissionRoute permission='settings.manage'><SettingsPage /></PermissionRoute>} />
          <Route path="updates" element={<PermissionRoute permission='updates.manage'><UpdatePage /></PermissionRoute>} />
          <Route path="permissions" element={<PermissionRoute permission='users.permissions'><PermissionsPage /></PermissionRoute>} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
