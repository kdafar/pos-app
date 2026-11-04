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
import HelpPage from './help/HelpPage';

function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  // The answer is stored WITH the permission it answers. React reuses this
  // component when one guarded route replaces another, so a bare `allowed`
  // carried the previous screen's "yes" into the next one: going from Updates
  // to Permissions as a manager mounted the Permissions page for a moment, its
  // load was refused by the main process ("Could not load this page"), and only
  // then did the redirect happen. An answer for another permission is no answer.
  const [answer, setAnswer] = useState<{ permission: string; allowed: boolean; fallback: string } | null>(null);
  useEffect(() => {
    let live = true;
    window.api.invoke('auth:whoami').then((user) => {
      const permissions: string[] = user?.permissions || [];
      const fallback = permissions.includes('orders.create') ? '/' : permissions.includes('orders.kitchen_view') ? '/kitchen' : permissions.includes('reports.view') ? '/reports/closing' : '/login';
      // `permissions` is already the effective role defaults plus per-user
      // overrides. Adding `is_admin` here made every explicit denial a no-op.
      if (live) setAnswer({ permission, allowed: permissions.includes(permission), fallback });
    }).catch(() => {
      if (live) setAnswer({ permission, allowed: false, fallback: '/' });
    });
    return () => {
      live = false;
    };
  }, [permission]);
  if (!answer || answer.permission !== permission) return null;
  return answer.allowed ? <>{children}</> : <Navigate to={answer.fallback} replace />;
}

function App() {
  return (
    <Routes>
      {/* Public routes (no session required) */}
      <Route path="/pair" element={<PairScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/logout" element={<LogoutRoute />} />
      {/* The guide before sign-in (from the "?" on the sign-in and pair
          screens): no sidebar, and only the steps that need no screen. */}
      <Route path="/start-help" element={<div className='min-h-screen bg-background'><HelpPage /></div>} />

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

          {/* Help: everyone. The page itself shows only the steps for the
              screens this user has in the sidebar. */}
          <Route path="help" element={<HelpPage />} />

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
